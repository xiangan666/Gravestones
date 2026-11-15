import {world, system, ItemStack} from "@minecraft/server";
import {ID_PROPERTY, TOKEN_PROPERTY, KEY_USE_HINT, KEY, STORAGE, MARKER, DROP, VAULT_ANCHOR, VERSION, dimensions, teleportReason, lore, position} from "./core.js";

const cache = new Map();
export const locks = new Set();
const sequenceHighWater = new Map();
const RECORD_PREFIX = "lanshiyi:g:";
export function log(error) { console.warn(`[墓碑 ${VERSION}] ${error?.stack ?? error}`); }
export function guard(fn) {
  return (...args) => { try { const result = fn(...args); if (result?.catch) result.catch(log); } catch (error) { log(error); } };
}
function nonNegativeInteger(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
function sequenceFloor(name) {
  let floor = Math.max(nonNegativeInteger(world.getDynamicProperty(`lanshiyi:${name}`)), nonNegativeInteger(world.getDynamicProperty(`lanshiyi:${name}_high_water`)), sequenceHighWater.get(name) ?? 0);
  const pattern = name === "grave_sequence" ? /^lanshiyi:g:(\d+)$/ : name === "key_sequence" ? /^lanshiyi:k:\d+_(\d+)$/ : undefined;
  if (pattern) for (const property of world.getDynamicPropertyIds()) {
    const match = property.match(pattern);
    if (match) floor = Math.max(floor, nonNegativeInteger(Number(match[1])));
  }
  if (name === "grave_sequence") {
    // A missing primary counter must never reuse a surviving grave or carried key ID.
    for (const dim of loadedDimensions()) for (const type of [STORAGE, MARKER, DROP]) {
      for (const entity of dim.getEntities({type})) floor = Math.max(floor, nonNegativeInteger(entity.getDynamicProperty(ID_PROPERTY)));
    }
    for (const player of world.getAllPlayers()) {
      const inv = container(player);
      if (!inv) continue;
      for (let slot = 0; slot < inv.size; slot++) floor = Math.max(floor, nonNegativeInteger(inv.getItem(slot)?.getDynamicProperty(ID_PROPERTY)));
    }
  }
  return floor;
}
export function nextNumber(name) {
  const value = sequenceFloor(name) + 1;
  if (!Number.isSafeInteger(value)) throw new Error("墓碑编号已达到安全整数上限，已停止生成以保护已有记录。");
  world.setDynamicProperty(`lanshiyi:${name}`, value);
  world.setDynamicProperty(`lanshiyi:${name}_high_water`, value);
  sequenceHighWater.set(name, value);
  return value;
}
/** @returns {import('./core.js').Grave | undefined} */
export function getGrave(id) {
  if (!Number.isSafeInteger(Number(id)) || Number(id) < 1) return undefined;
  id = Number(id);
  if (cache.has(id)) return cache.get(id);
  const value = world.getDynamicProperty(`lanshiyi:g:${id}`);
  if (typeof value !== "string") return undefined;
  const record = JSON.parse(value);
  if (record.id !== id || !record.original || !record.current || !record.storageId) throw new Error(`墓碑 #${id} 的持久化记录损坏，已停止操作以保护物品。`);
  cache.set(id, record);
  return record;
}
export function allGraves() {
  return world.getDynamicPropertyIds().filter(k => k.startsWith(RECORD_PREFIX)).map(k => getGrave(Number(k.slice(RECORD_PREFIX.length)))).filter(Boolean);
}
export function saveGrave(grave) {
  const previous = world.getDynamicProperty(`${RECORD_PREFIX}${grave.id}`);
  if (typeof previous === "string") {
    const record = JSON.parse(previous);
    if (record.ownerId !== grave.ownerId || record.createdAt !== grave.createdAt) throw new Error(`墓碑 #${grave.id} 编号冲突，已拒绝覆盖已有遗物记录。`);
  }
  world.setDynamicProperty(`lanshiyi:g:${grave.id}`, JSON.stringify(grave));
  cache.set(grave.id, grave);
}
export function dimension(id) { return world.getDimension(id); }
export function getEntity(id) {
  if (!id) return undefined;
  try {
    const entity = world.getEntity(id);
    return entity?.isValid ? entity : undefined;
  } catch { return undefined; } // Invalid/stale native IDs are recoverable via grave identity.
}
export function container(entity) { return entity?.getComponent("minecraft:inventory")?.container; }
export function itemGrave(item) {
  const id = item?.getDynamicProperty(ID_PROPERTY);
  return typeof id === "number" ? getGrave(id) : undefined;
}
export function keyUsed(item) {
  const token = item?.getDynamicProperty(TOKEN_PROPERTY);
  return typeof token !== "string" || world.getDynamicProperty(`lanshiyi:k:${token}`) !== false;
}
export function spendKey(item) {
  world.setDynamicProperty(`lanshiyi:k:${item.getDynamicProperty(TOKEN_PROPERTY)}`, true);
}
export function restoreKey(item) {
  world.setDynamicProperty(`lanshiyi:k:${item.getDynamicProperty(TOKEN_PROPERTY)}`, false);
}
export function newKey(grave) {
  const key = new ItemStack(KEY);
  key.setDynamicProperty(ID_PROPERTY, grave.id);
  const token = `${grave.id}_${nextNumber("key_sequence")}`;
  key.setDynamicProperty(TOKEN_PROPERTY, token);
  world.setDynamicProperty(`lanshiyi:k:${token}`, false);
  key.nameTag = `§r§e#${grave.id} ${grave.ownerName}的墓碑钥匙`;
  key.setLore([...lore(grave), "§r§d传送次数：1/1（成功消耗1个末影珍珠）", KEY_USE_HINT]);
  key.keepOnDeath = true;
  return key;
}
export function waitTicks(ticks) {
  return new Promise(resolve => system.runTimeout(() => resolve(undefined), ticks));
}
/**
 * @param {import('@minecraft/server').Dimension} dim
 * @param {import('@minecraft/server').Vector3} location
 * @returns {import('@minecraft/server').Block | undefined}
 */
export function safeBlock(dim, location) {
  try { return dim.getBlock(location); } catch { return undefined; }
}
function vaultPosition() {
  let p = world.getDynamicProperty("lanshiyi:vault");
  if (!p || typeof p !== "object") {
    const dim = dimension("minecraft:overworld");
    const spawn = world.getDefaultSpawnLocation();
    p = {x: Math.floor(spawn.x / 16) * 16 + 8, y: dim.heightRange.min + 4, z: Math.floor(spawn.z / 16) * 16 + 8};
    world.setDynamicProperty("lanshiyi:vault", p);
  }
  return p;
}
/** Share one native ticking anchor; re-check actual loaded state rather than caching readiness forever. */
export function ensureVault() {
  const dim = dimension("minecraft:overworld");
  const p = vaultPosition();
  if (!safeBlock(dim, p)) {
    // Existing named areas may have been removed, or not yet preloaded after restart.
    try { dim.runCommand("tickingarea preload lanshiyi_grave_vault true"); } catch { /* Recreate below. */ }
    if (!safeBlock(dim, p)) {
      const x = Math.floor(p.x / 16) * 16;
      const z = Math.floor(p.z / 16) * 16;
      try { dim.runCommand(`tickingarea add ${x} ${p.y} ${z} ${x + 15} ${p.y} ${z + 15} lanshiyi_grave_vault true`); }
      catch { /* Keep items on the player if the vault cannot be loaded. */ }
    }
  }
  if (!safeBlock(dim, p)) return false;
  try {
    let anchor = getEntity(world.getDynamicProperty("lanshiyi:vault_anchor"));
    if (anchor?.typeId !== VAULT_ANCHOR) anchor = undefined;
    const anchors = dim.getEntities({type: VAULT_ANCHOR, location: p, maxDistance: 2});
    if (!anchor) anchor = anchors[0];
    if (!anchor) anchor = dim.spawnEntity(VAULT_ANCHOR, p);
    world.setDynamicProperty("lanshiyi:vault_anchor", anchor.id);
    for (const extra of anchors) if (extra.id !== anchor.id) extra.remove();
    return true;
  } catch (error) { log(error); }
  return false;
}
export function createStorage() {
  if (!ensureVault()) throw new Error("墓碑保险库区块尚未就绪，物品和经验已留在玩家身上。请检查常加载区域配额。");
  const p = /** @type {import('@minecraft/server').Vector3} */ (world.getDynamicProperty("lanshiyi:vault"));
  return dimension("minecraft:overworld").spawnEntity(STORAGE, p);
}
export function storage(grave) {
  const direct = getEntity(grave.storageId);
  if (direct?.typeId === STORAGE && direct.getDynamicProperty(ID_PROPERTY) === grave.id && container(direct)) return direct;
  const candidates = loadedDimensions().flatMap(dim => dim.getEntities({type: STORAGE})).filter(entity => entity.getDynamicProperty(ID_PROPERTY) === grave.id && container(entity));
  if (candidates.length > 1) throw new Error(`墓碑 #${grave.id} 存在多个同编号库存，已停止领取以避免串号，请保留存档并联系管理员。`);
  const recovered = candidates[0];
  if (!recovered) return undefined;
  grave.storageId = recovered.id;
  grave.storagePosition = position(recovered.dimension, recovered.location);
  saveGrave(grave);
  return recovered;
}
/** Load the old vault without ever replacing an unavailable inventory with an empty one. */
export async function loadStorage(grave) {
  let entity = storage(grave);
  if (entity) return entity;
  ensureVault();
  const fallback = world.getDynamicProperty("lanshiyi:vault");
  const p = grave.storagePosition ?? (typeof fallback === "object" ? {dimension: "minecraft:overworld", ...fallback} : undefined);
  for (let attempt = 0; attempt < 40; attempt++) {
    await waitTicks(2);
    entity = storage(grave);
    if (entity) { ensureVault(); return entity; }
    if (attempt % 10 === 9) ensureVault();
  }
  if (!p || !safeBlock(dimension(p.dimension), p)) throw new Error("保险库区块加载超时，请检查命令权限或常加载区域配额后重试。遗物记录和经验保持不变。");
  throw new Error(`保险库区块已加载，但未找到墓碑 #${grave.id} 的库存实体。没有创建空库存或删除墓碑，请保留存档并联系管理员。`);
}
export function loadDestination(grave, radius = 0) {
  return loadDestinationAsync(grave, radius);
}
/** Blocks can become available before saved entities finish loading. Never spawn a replacement here. */
export async function loadDestinationMarker(grave, dim) {
  const p = grave.original;
  const matches = entity => entity?.isValid && entity.typeId === MARKER && entity.dimension.id === dim.id &&
    entity.getDynamicProperty(ID_PROPERTY) === grave.id &&
    Math.hypot(entity.location.x - (p.x + 0.5), entity.location.y - (p.y + 1.15), entity.location.z - (p.z + 0.5)) < 2;
  for (let attempt = 0; attempt <= 40; attempt++) {
    const direct = getEntity(grave.markerId);
    const candidates = dim.getEntities({type: MARKER, location: {x: p.x + 0.5, y: p.y + 1.15, z: p.z + 0.5}, maxDistance: 2}).filter(matches);
    if (candidates.length > 1) return undefined;
    const marker = candidates[0] ?? (matches(direct) ? direct : undefined);
    if (marker) {
      if (grave.markerId !== marker.id) { grave.markerId = marker.id; saveGrave(grave); }
      return marker;
    }
    if (attempt < 40) await waitTicks(2);
  }
  return undefined;
}
/** An unloaded destination is unknown, never 'mined' or 'missing'. */
async function loadDestinationAsync(grave, radius) {
  const dim = dimension(grave.original.dimension);
  let block = safeBlock(dim, grave.original);
  if (block && !radius) return {dim, block, release() {}};
  const areaName = `ls_tp_${grave.id}`;
  let created = false;
  try {
    const p = grave.original;
    created = dim.runCommand(`tickingarea add ${p.x - radius} ${p.y} ${p.z - radius} ${p.x + radius} ${p.y} ${p.z + radius} ${areaName} true`).successCount > 0;
    if (!created) return block ? {dim, block, release() {}} : undefined;
    for (let attempt = 0; attempt < 40; attempt++) {
      await waitTicks(2);
      block = safeBlock(dim, grave.original);
      const corners = [-radius, radius].every(dx => [-radius, radius].every(dz => safeBlock(dim, {x: p.x + dx, y: p.y, z: p.z + dz})));
      if (block && (corners || attempt === 39)) return {dim, block, release() { try { dim.runCommand(`tickingarea remove ${areaName}`); } catch (e) { log(e); } }};
    }
  } catch (e) { log(e); if (block) return {dim, block, release() {}}; }
  if (created) { try { dim.runCommand(`tickingarea remove ${areaName}`); } catch (e) { log(e); } }
  return undefined;
}
export function teleportStatus(item) { return teleportReason(itemGrave(item), keyUsed(item)); }
export function initialize() {
  ensureVault();
  for (const name of ["grave_sequence", "key_sequence"]) {
    const floor = sequenceFloor(name);
    world.setDynamicProperty(`lanshiyi:${name}`, floor);
    world.setDynamicProperty(`lanshiyi:${name}_high_water`, floor);
    sequenceHighWater.set(name, floor);
  }
  for (const grave of allGraves()) {
    try { dimension(grave.original.dimension).runCommand(`tickingarea remove ls_tp_${grave.id}`); } catch { /* Normally absent. */ }
  }
}
export function loadedDimensions() { return dimensions.map(dimension); }
