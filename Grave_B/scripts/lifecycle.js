import {world, EquipmentSlot, ItemStack} from "@minecraft/server";
import {GRAVE_IDS, GRAVE_ITEM, KEY, ADMIN_KEY, DROP, MARKER, ID_PROPERTY, center, position, statistics, isBoundTool, graveLabel, lore, refundXp} from "./core.js";
import {container, createStorage, dimension, getEntity, getGrave, guard, itemGrave, locks, log, newKey, nextNumber, safeBlock, saveGrave, storage, loadStorage, allGraves} from "./store.js";

const equipmentSlots = [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet, EquipmentSlot.Offhand];
const placeable = new Set(["minecraft:air", "minecraft:water", "minecraft:flowing_water", "minecraft:lava", "minecraft:flowing_lava", "minecraft:short_grass", "minecraft:snow_layer"]);
const lookup = new Map();
const locationKey = p => `${p.dimension}:${p.x}:${p.y}:${p.z}`;

export function rebuildLookup() {
  lookup.clear();
  for (const grave of allGraves()) if (grave.status === "placed") lookup.set(locationKey(grave.current), grave.id);
}
export function graveAt(block) {
  if (!block || !GRAVE_IDS.includes(block.typeId)) return undefined;
  const p = position(block.dimension, block.location);
  const id = lookup.get(locationKey(p));
  const cached = id ? getGrave(id) : undefined;
  if (cached?.status === "placed" && locationKey(cached.current) === locationKey(p)) return cached;
  const recovered = allGraves().find(grave => grave.status === "placed" && locationKey(grave.current) === locationKey(p));
  if (recovered) lookup.set(locationKey(p), recovered.id);
  return recovered;
}
export function makeGraveItem(grave) {
  const item = new ItemStack(GRAVE_ITEM);
  item.setDynamicProperty(ID_PROPERTY, grave.id);
  item.nameTag = `§r§b${graveLabel(grave)}`;
  item.setLore(lore(grave));
  item.keepOnDeath = true;
  return item;
}
export function mark(grave) {
  let marker = getEntity(grave.markerId);
  if (!marker) {
    marker = dimension(grave.current.dimension).spawnEntity(MARKER, center(grave.current, 1.15));
    marker.setDynamicProperty(ID_PROPERTY, grave.id);
    grave.markerId = marker.id;
  }
  marker.nameTag = `§r§e${graveLabel(grave)}`;
  return marker;
}
function removeMarker(grave) {
  getEntity(grave.markerId)?.remove();
  grave.markerId = undefined;
}
function findDeathLocation(dim, death) {
  const y = Math.max(dim.heightRange.min + 2, Math.min(dim.heightRange.max - 3, death.y));
  // A bounded search replaces the original unbounded recursive search.
  for (let radius = 0; radius <= 8; radius++) {
    for (let dy = 0; dy <= 3; dy++) {
      for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
        if (radius > 0 && Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;
        const p = {x: death.x + dx, y: y + dy, z: death.z + dz};
        const block = safeBlock(dim, p);
        if (block && placeable.has(block.typeId)) return {p: position(dim, p), block};
      }
    }
  }
  return undefined;
}
export function captureDeath(player) {
  const inv = container(player);
  const equipment = player.getComponent("minecraft:equippable");
  const xp = player.getTotalXp();
  const keep = item => isBoundTool(item) || item?.typeId === GRAVE_ITEM;
  const contents = [];
  for (let i = 0; i < inv.size; i++) { const item = inv.getItem(i); if (item && !keep(item)) contents.push(item); }
  for (const slot of equipmentSlots) { const item = equipment.getEquipment(slot); if (item && !keep(item)) contents.push(item); }
  // Every death gets its own grave, including a second death carrying only retained keys.
  const death = position(player.dimension, player.location);
  const target = findDeathLocation(player.dimension, death);
  if (!target) { player.sendMessage("§c附近没有可用的墓碑位置，物品与经验保留在身上。 "); return; }
  let entity;
  try { entity = createStorage(); }
  catch (error) { player.sendMessage(`§c${error.message}`); log(error); return; }
  const saved = container(entity);
  const oldPermutation = target.block.permutation;
  /** @type {import('./core.js').Grave} */
  const grave = {id: nextNumber("grave_sequence"), ownerId: player.id, ownerName: player.name, blockId: GRAVE_IDS[Math.max(1, Math.min(8, Math.floor(player.level / 12.5) + 1))], original: target.p, death, current: {...target.p}, status: "placed", everMoved: false, xp, statistics: statistics(contents), storageId: entity.id, storagePosition: position(entity.dimension, entity.location), createdAt: Date.now()};
  entity.setDynamicProperty(ID_PROPERTY, grave.id);
  const moved = [];
  const equipped = [];
  try {
    target.block.setType(grave.blockId);
    mark(grave);
    for (let i = 0; i < inv.size; i++) {
      const item = inv.getItem(i);
      if (!item || keep(item)) continue;
      inv.moveItem(i, i, saved);
      moved.push(i);
    }
    for (let i = 0; i < equipmentSlots.length; i++) {
      const slot = equipmentSlots[i];
      const item = equipment.getEquipment(slot);
      if (!item || keep(item)) continue;
      saved.setItem(36 + i, item);
      equipment.setEquipment(slot);
      equipped.push({slot, index: 36 + i});
    }
    saveGrave(grave);
    player.resetLevel();
    lookup.set(locationKey(grave.current), grave.id);
    const pending = JSON.parse(String(player.getDynamicProperty("lanshiyi:pending_keys") ?? "[]"));
    pending.push(grave.id);
    player.setDynamicProperty("lanshiyi:pending_keys", JSON.stringify(pending));
    player.sendMessage(`§a已生成 ${graveLabel(grave)}，保存 ${xp} 点经验。复活后领取钥匙。`);
  } catch (error) {
    for (const i of moved) saved.moveItem(i, i, inv);
    for (const {slot, index} of equipped) { equipment.setEquipment(slot, saved.getItem(index)); saved.setItem(index); }
    if (player.getTotalXp() < xp) player.addExperience(xp - player.getTotalXp());
    target.block.setPermutation(oldPermutation);
    removeMarker(grave);
    entity.remove();
    world.setDynamicProperty(`lanshiyi:g:${grave.id}`);
    grave.status = "opened";
    player.sendMessage("§c墓碑生成失败，已回退物品和经验。请检查内容日志。 ");
    throw error;
  }
}
export function givePendingKeys(player) {
  const pending = JSON.parse(String(player.getDynamicProperty("lanshiyi:pending_keys") ?? "[]"));
  if (!pending.length) return;
  const remaining = [];
  for (const id of pending) {
    const grave = getGrave(id);
    if (!grave) continue;
    if (!container(player).emptySlotsCount) { remaining.push(id); continue; }
    container(player).addItem(newKey(grave));
  }
  player.setDynamicProperty("lanshiyi:pending_keys", remaining.length ? JSON.stringify(remaining) : undefined);
  if (remaining.length) player.onScreenDisplay.setActionBar("§e请腾出物品栏空位，墓碑钥匙将自动补发。 ");
}
export function spawnDrop(grave, location, item = makeGraveItem(grave), dim = dimension(grave.current.dimension)) {
  const drop = dim.spawnEntity(DROP, location);
  try {
    container(drop).setItem(0, item);
    drop.setDynamicProperty(ID_PROPERTY, grave.id);
    drop.setDynamicProperty("lanshiyi:ready_at", Date.now() + 1200);
    drop.nameTag = `§r§b${graveLabel(grave)}`;
    grave.status = "dropped";
    grave.dropId = drop.id;
    grave.holderId = undefined;
    grave.current = position(dim, location);
    saveGrave(grave);
    return drop;
  } catch (error) { drop.remove(); throw error; }
}
export function mineGrave(player, block) {
  const grave = graveAt(block);
  if (!grave) {
    const legacy = block.dimension.getEntities({type: MARKER, location: center(position(block.dimension, block.location)), maxDistance: 2}).some(e => !e.getDynamicProperty(ID_PROPERTY) && container(e)?.emptySlotsCount < 42);
    if (legacy) { player.sendMessage("§e旧版墓碑正在迁移，请稍后再挖掘。 "); return; }
    const decoration = new ItemStack(block.typeId);
    block.dimension.spawnItem(decoration, center(position(block.dimension, block.location), 0.3));
    block.setType("minecraft:air");
    return;
  }
  if (locks.has(grave.id)) return;
  locks.add(grave.id);
  try {
    if (grave.status !== "placed") return;
    const drop = spawnDrop(grave, center(grave.current, 0.3));
    try { block.setType("minecraft:air"); }
    catch (error) { drop.remove(); grave.status = "placed"; grave.dropId = undefined; saveGrave(grave); throw error; }
    grave.everMoved = true;
    removeMarker(grave);
    lookup.delete(locationKey(grave.current));
    saveGrave(grave);
  } finally { locks.delete(grave.id); }
}
export function placeGrave(player, clickedBlock, face) {
  const inv = container(player);
  const slot = player.selectedSlotIndex;
  const item = inv.getItem(slot);
  if (item?.typeId !== GRAVE_ITEM) return;
  const grave = itemGrave(item);
  if (!grave || grave.status !== "carried" || grave.holderId !== player.id) { player.sendMessage("§c这份墓碑物品尚未确认归属、已经放置或已被开启，请稍后重试。 "); return; }
  if (locks.has(grave.id)) return;
  const offsets = {Up: [0, 1, 0], Down: [0, -1, 0], North: [0, 0, -1], South: [0, 0, 1], East: [1, 0, 0], West: [-1, 0, 0]};
  const [dx, dy, dz] = offsets[face];
  const block = safeBlock(player.dimension, {x: clickedBlock.x + dx, y: clickedBlock.y + dy, z: clickedBlock.z + dz});
  if (!block || !placeable.has(block.typeId)) { player.sendMessage("§e请对着有空位的方块表面放置墓碑。 "); return; }
  locks.add(grave.id);
  const old = {...grave};
  const permutation = block.permutation;
  try {
    block.setType(grave.blockId);
    grave.current = position(player.dimension, block.location);
    grave.status = "placed";
    grave.everMoved = true;
    grave.holderId = undefined;
    grave.dropId = undefined;
    mark(grave);
    saveGrave(grave);
    inv.setItem(slot);
    lookup.set(locationKey(grave.current), grave.id);
  } catch (error) {
    removeMarker(grave);
    Object.assign(grave, old);
    block.setPermutation(permutation);
    saveGrave(grave);
    throw error;
  } finally { locks.delete(grave.id); }
}
export async function openGrave(player, block) {
  const grave = graveAt(block);
  const key = container(player).getItem(player.selectedSlotIndex);
  if (!grave) { player.sendMessage("§e这座墓碑尚无可用记录，请等待旧版迁移或联系管理员。 "); return; }
  if (key?.typeId !== ADMIN_KEY && !player.hasTag("admin") && !(key?.typeId === KEY && itemGrave(key)?.id === grave.id)) { player.sendMessage(`§c需要编号 #${grave.id} 的墓碑钥匙。`); return; }
  if (locks.has(grave.id) || grave.status !== "placed") return;
  locks.add(grave.id);
  try {
    let entity;
    try {
      entity = storage(grave);
      if (!entity) {
        player.sendMessage(`§e正在加载墓碑 #${grave.id} 的库存，请稍候……`);
        entity = await loadStorage(grave);
      }
    } catch (error) { if (player.isValid) player.sendMessage(`§e${error.message}`); log(error); return; }
    if (!player.isValid || grave.status !== "placed") return;
    const keySlot = player.selectedSlotIndex;
    const held = container(player).getItem(keySlot);
    if (held?.typeId !== ADMIN_KEY && !player.hasTag("admin") && !(held?.typeId === KEY && itemGrave(held)?.id === grave.id)) { player.sendMessage("§e钥匙已切换，开墓取消；未领取物品或经验。 "); return; }
    const source = container(entity);
    const target = container(player);
    let left = false;
    for (let i = 0; i < source.size; i++) {
      const item = source.getItem(i);
      if (!item) continue;
      const remainder = target.addItem(item);
      source.setItem(i, remainder);
      if (remainder) left = true;
    }
    if (!grave.xpPaid) {
      const xp = refundXp(grave.xp, player.id === grave.ownerId);
      grave.xpPaid = true;
      saveGrave(grave);
      try { player.addExperience(xp); }
      catch (error) { grave.xpPaid = false; saveGrave(grave); throw error; }
      player.sendMessage(`§a墓碑 #${grave.id} 返还 ${xp} 点经验（${player.id === grave.ownerId ? "所有者 70%" : "其他玩家 50%"}），剩余经验已消散。`);
    }
    if (left) {
      const remaining = [];
      for (let slot = 0; slot < source.size; slot++) remaining.push(source.getItem(slot));
      grave.statistics = statistics(remaining);
      saveGrave(grave);
      player.sendMessage("§e物品栏已满，剩余物品仍在墓碑中。腾出空间后再次用钥匙开启。经验不会重复返还。 ");
      return;
    }
    grave.status = "opened";
    grave.openedBy = player.name;
    saveGrave(grave);
    // Consume only the matching ordinary key used for this completed claim.
    // Partial/failed claims keep it; admin tools and other bound keys are untouched.
    const consumeKey = held?.typeId === KEY && itemGrave(held)?.id === grave.id;
    if (consumeKey) {
      if (held.amount > 1) { held.amount--; target.setItem(keySlot, held); }
      else target.setItem(keySlot);
    }
    lookup.delete(locationKey(grave.current));
    block.setType("minecraft:air");
    removeMarker(grave);
    entity.remove();
    player.sendMessage(`§a已取回墓碑 #${grave.id} 的全部物品。${consumeKey ? "本次使用的墓碑钥匙已消耗。" : ""}`);
  } finally { locks.delete(grave.id); }
}
export function convertVanillaDrop(entity) {
  if (!entity?.isValid || entity.typeId !== "minecraft:item") return;
  const item = entity.getComponent("minecraft:item")?.itemStack;
  if (item?.typeId !== GRAVE_ITEM) return;
  const grave = itemGrave(item);
  if (!grave || grave.status === "opened" || grave.status === "placed") return;
  if (getEntity(grave.dropId)) return; // A duplicated item can never create another active grave.
  spawnDrop(grave, entity.location, item, entity.dimension);
  entity.remove();
}
export function tickDrops(dim) {
  for (const drop of dim.getEntities({type: DROP})) guard(() => {
    const grave = getGrave(drop.getDynamicProperty(ID_PROPERTY));
    if (!grave || grave.status !== "dropped" || grave.dropId !== drop.id) return;
    const loc = drop.location;
    const beneath = safeBlock(dim, {x: loc.x, y: loc.y - 0.15, z: loc.z});
    const here = safeBlock(dim, loc);
    if ([here, beneath].some(b => b && b.typeId.includes("lava"))) {
      let y = Math.floor(loc.y);
      while (y < dim.heightRange.max - 2) {
        const block = safeBlock(dim, {x: loc.x, y, z: loc.z});
        if (!block || !block.typeId.includes("lava")) break;
        y++;
      }
      drop.teleport({x: loc.x, y: y + 0.35, z: loc.z});
      drop.clearVelocity();
    } else if (loc.y < dim.heightRange.min + 1) {
      drop.teleport({x: loc.x, y: dim.heightRange.min + 2, z: loc.z});
      drop.clearVelocity();
    }
    const p = position(dim, drop.location);
    if (locationKey(p) !== locationKey(grave.current)) { grave.current = p; saveGrave(grave); }
    if (Date.now() < Number(drop.getDynamicProperty("lanshiyi:ready_at") ?? 0)) return;
    const players = dim.getPlayers({location: drop.location, maxDistance: 1.7}).filter(p => p.getGameMode() !== "Spectator");
    for (const player of players) {
      if (locks.has(grave.id)) break;
      const inv = container(player);
      if (!inv.emptySlotsCount) continue;
      const item = container(drop).getItem(0) ?? makeGraveItem(grave);
      if (inv.addItem(item)) continue;
      container(drop).setItem(0);
      grave.status = "carried";
      grave.current = position(player.dimension, player.location);
      grave.holderId = player.id;
      grave.dropId = undefined;
      saveGrave(grave);
      drop.remove();
      break;
    }
  })();
}
/** Import the original inventory entity intact; never invent XP the old addon already dropped. */
export function migrateLegacy(marker) {
  if (!marker?.isValid || marker.typeId !== MARKER || marker.getDynamicProperty(ID_PROPERTY)) return;
  const old = container(marker);
  if (!old) return;
  const items = [];
  for (let slot = 0; slot < old.size; slot++) items.push(old.getItem(slot));
  if (!items.some(Boolean)) return;
  const p = position(marker.dimension, marker.getDynamicProperty("coords") ?? marker.location);
  const block = safeBlock(marker.dimension, p);
  if (!block || !GRAVE_IDS.includes(block.typeId)) return;
  const entity = createStorage();
  const inv = container(entity);
  const plainName = marker.nameTag.replace(/§./g, "").split(/[\r\n]/)[0].trim() || "旧版玩家";
  const ownerId = marker.getTags()[0] ?? "legacy:unknown";
  const grave = {id: nextNumber("grave_sequence"), ownerId, ownerName: plainName, blockId: block.typeId, original: p, death: {...p}, current: {...p}, status: "placed", everMoved: false, xp: 0, statistics: statistics(items), storageId: entity.id, storagePosition: position(entity.dimension, entity.location), markerId: marker.id, createdAt: Date.now(), legacy: true};
  const moved = [];
  try {
    for (let slot = 0; slot < old.size; slot++) { if (!old.getItem(slot)) continue; old.moveItem(slot, slot, inv); moved.push(slot); }
    entity.setDynamicProperty(ID_PROPERTY, grave.id);
    marker.setDynamicProperty(ID_PROPERTY, grave.id);
    marker.teleport(center(p, 1.15));
    marker.nameTag = `§r§e${graveLabel(grave)}`;
    saveGrave(grave);
    lookup.set(locationKey(p), grave.id);
    log(`已迁移旧版墓碑 #${grave.id}（${plainName}）。旧版已经散落的经验无法恢复。`);
  } catch (error) {
    for (const slot of moved) inv.moveItem(slot, slot, old);
    marker.setDynamicProperty(ID_PROPERTY);
    entity.remove();
    throw error;
  }
}
export function reconcileMarker(marker) {
  const grave = getGrave(marker.getDynamicProperty(ID_PROPERTY));
  if (!grave) { migrateLegacy(marker); return; }
  if (grave.status !== "placed" || grave.markerId !== marker.id) return;
  const block = safeBlock(marker.dimension, grave.current);
  if (!block) return; // Unloaded is not missing.
  if (block.typeId === grave.blockId) return;
  grave.everMoved = true;
  spawnDrop(grave, center(grave.current, 0.3));
  lookup.delete(locationKey(grave.current));
  removeMarker(grave);
  saveGrave(grave);
}
