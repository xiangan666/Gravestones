import {world, ItemStack, EquipmentSlot} from "@minecraft/server";
import {GRAVE_ITEM, KEY, FINDER_PREFIX, ID_PROPERTY, MARKER, STORAGE, DROP, isBoundTool, isFinder, finderFrame, position, positionText, dimensionName, stateName, samePosition} from "./core.js";
import {container, getGrave, getEntity, itemGrave, loadedDimensions, safeBlock, saveGrave, guard, log, newKey} from "./store.js";
import {tickDrops, convertVanillaDrop, reconcileMarker, graveAt} from "./lifecycle.js";
import {updateTool} from "./interface.js";

const watched = new Map();
let watchCursor = 0;
const watchKey = p => `${p.dimension}:${p.x}:${p.y}:${p.z}`;
export function watchContainer(block) {
  try {
    if (!block?.getComponent("minecraft:inventory")) return;
    const p = position(block.dimension, block.location);
    const key = watchKey(p);
    if (watched.has(key)) return;
    watched.set(key, p);
    world.setDynamicProperty(`lanshiyi:c:${key}`, JSON.stringify(p));
  } catch (e) { log(e); }
}
export function restoreWatches() {
  for (const key of world.getDynamicPropertyIds().filter(k => k.startsWith("lanshiyi:c:"))) {
    const p = JSON.parse(String(world.getDynamicProperty(key)));
    watched.set(watchKey(p), p);
  }
}
function followItem(item, p, holderId) {
  if (item?.typeId !== GRAVE_ITEM) return;
  const grave = itemGrave(item);
  if (!grave || grave.status === "opened" || grave.status === "placed" || getEntity(grave.dropId)) return;
  if (grave.status !== "carried" || grave.holderId !== holderId || !samePosition(grave.current, p)) {
    grave.status = "carried";
    grave.current = p;
    grave.holderId = holderId;
    grave.dropId = undefined;
    saveGrave(grave);
  }
}
function scanInventory(inv, p, holderId) {
  if (!inv) return;
  for (let slot = 0; slot < inv.size; slot++) followItem(inv.getItem(slot), p, holderId);
}
function cloneAs(item, typeId) {
  const replacement = new ItemStack(typeId);
  for (const key of item.getDynamicPropertyIds()) replacement.setDynamicProperty(key, item.getDynamicProperty(key));
  replacement.keepOnDeath = true;
  return replacement;
}
function refreshHeld(player, inv, slot, item) {
  const grave = itemGrave(item);
  if (!grave) return;
  if (isFinder(item) && player.dimension.id === grave.current.dimension) {
    const frame = finderFrame(player.location, {x: grave.current.x + 0.5, z: grave.current.z + 0.5}, player.getRotation().y);
    const typeId = `${FINDER_PREFIX}${frame}`;
    if (item.typeId !== typeId) item = cloneAs(item, typeId);
  }
  updateTool(item, grave);
  inv.setItem(slot, item);
  if (player.dimension.id !== grave.current.dimension) {
    player.onScreenDisplay.setActionBar(`§e#${grave.id} 请前往${dimensionName(grave.current.dimension)}　§7${positionText(grave.current)}`);
  } else {
    const dx = grave.current.x + 0.5 - player.location.x;
    const dz = grave.current.z + 0.5 - player.location.z;
    player.onScreenDisplay.setActionBar(`§b#${grave.id} ${stateName(grave)}　§f${positionText(grave.current)}　§7水平距离 ${Math.hypot(dx, dz).toFixed(1)} 格${grave.status === "opened" ? "（最后位置）" : ""}`);
  }
}
export function bindLegacyKey(player, block) {
  const inv = container(player);
  const item = inv.getItem(player.selectedSlotIndex);
  if (item?.typeId !== KEY || item.getDynamicProperty(ID_PROPERTY)) return false;
  const grave = graveAt(block);
  if (!grave?.legacy || grave.ownerId !== player.id) return false;
  const lines = item.getLore().map(line => line.replace(/§./g, ""));
  const coords = lines[0]?.match(/-?\d+/g)?.map(Number);
  if (!coords || coords.length !== 3 || coords[0] !== grave.original.x || coords[1] !== grave.original.y || coords[2] !== grave.original.z || lines[1] !== grave.original.dimension) return false;
  inv.setItem(player.selectedSlotIndex, updateTool(newKey(grave), grave));
  player.sendMessage(`§a旧版钥匙已迁移并绑定墓碑 #${grave.id}。`);
  return true;
}
export function tickPlayers() {
  const players = world.getAllPlayers();
  // Complete the location pass before updating finders: player enumeration order is irrelevant.
  for (const player of players) guard(() => {
    const inv = container(player);
    const p = position(player.dimension, player.location);
    scanInventory(inv, p, player.id);
    const equipment = player.getComponent("minecraft:equippable");
    followItem(equipment?.getEquipment(EquipmentSlot.Offhand), p, player.id);
  })();
  for (const player of players) guard(() => {
    const inv = container(player);
    const slot = player.selectedSlotIndex;
    const item = inv.getItem(slot);
    if (isBoundTool(item)) refreshHeld(player, inv, slot, item);
  })();
}
export function tickWorld() {
  for (const dim of loadedDimensions()) {
    tickDrops(dim);
    for (const marker of dim.getEntities({type: MARKER})) guard(() => reconcileMarker(marker))();
    for (const item of dim.getEntities({type: "minecraft:item"})) guard(() => convertVanillaDrop(item))();
    // Minecarts, boats, pack animals and other loaded inventories.
    for (const entity of dim.getEntities()) guard(() => {
      if ([MARKER, STORAGE, DROP, "minecraft:player", "minecraft:item"].includes(entity.typeId)) return;
      scanInventory(container(entity), position(dim, entity.location), entity.id);
    })();
  }
  // A chest opened to deposit a grave becomes a persisted watch. Follow connected
  // inventories as well, including hopper chains, without scanning every world block.
  const registered = [...watched.values()];
  const queue = [...registered.slice(watchCursor), ...registered.slice(0, watchCursor)];
  watchCursor = (watchCursor + 256) % Math.max(1, registered.length);
  const visited = new Set();
  let budget = 256;
  while (queue.length && budget-- > 0) {
    const p = queue.shift();
    const key = watchKey(p);
    if (visited.has(key)) continue;
    visited.add(key);
    const dim = world.getDimension(p.dimension);
    const block = safeBlock(dim, p);
    const inv = block?.getComponent("minecraft:inventory")?.container;
    if (!inv) continue;
    scanInventory(inv, p, `container:${key}`);
    for (const [dx, dy, dz] of [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
      const next = {dimension: p.dimension, x: p.x + dx, y: p.y + dy, z: p.z + dz};
      if (visited.has(watchKey(next))) continue;
      const neighbor = safeBlock(dim, next);
      if (neighbor?.getComponent("minecraft:inventory")) { watchContainer(neighbor); queue.push(next); }
    }
  }
}
