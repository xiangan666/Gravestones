/** @typedef {{dimension: string, x: number, y: number, z: number}} Position */
/** @typedef {{types: number, stacks: number, total: number}} Statistics */
/** @typedef {{id: number, ownerId: string, ownerName: string, blockId: string, original: Position, death: Position, current: Position, status: string, everMoved: boolean, xp: number, statistics: Statistics, storageId: string, storagePosition?: Position, markerId?: string, dropId?: string, holderId?: string, openedBy?: string, xpPaid?: boolean, createdAt: number, legacy?: boolean}} Grave */

export const VERSION = "2.0.14";
export const GRAVE_IDS = ["effect99:grave", "effect99:wooden_grave", "effect99:stone_grave", "effect99:stone_cross_grave", "effect99:stone_slab_grave", "effect99:blackstone_grave", "effect99:golden_blackstone_grave", "effect99:golden_cross_netherite_grave", "effect99:golden_netherite_grave"];
export const GRAVE_ITEM = "lanshiyi:gravestone";
export const KEY = "effect99:key";
export const ADMIN_KEY = "effect99:admin_key";
export const FINDER_PREFIX = "lanshiyi:finder_";
export const DROP = "lanshiyi:grave_drop";
export const STORAGE = "lanshiyi:grave_storage";
export const VAULT_ANCHOR = "lanshiyi:grave_vault_anchor";
export const MARKER = "entity:grave_inventory";
export const ID_PROPERTY = "lanshiyi:grave_id";
export const TOKEN_PROPERTY = "lanshiyi:key_token";
export const KEY_USE_HINT = "§r§7全部领取后消耗本次钥匙；未领完或失败时保留";
export const dimensions = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];

export function dimensionName(id) {
  return ({"minecraft:overworld": "主世界", "minecraft:nether": "下界", "minecraft:the_end": "末地"})[id] ?? id;
}
export function positionText(p) {
  return `${dimensionName(p.dimension)} ${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}`;
}
export function samePosition(a, b) {
  return a.dimension === b.dimension && a.x === b.x && a.y === b.y && a.z === b.z;
}
export function position(dimension, location) {
  return {dimension: typeof dimension === "string" ? dimension : dimension.id, x: Math.floor(location.x), y: Math.floor(location.y), z: Math.floor(location.z)};
}
export function center(p, offset = 0.1) {
  return {x: p.x + 0.5, y: p.y + offset, z: p.z + 0.5};
}
export function isFinder(item) {
  return Boolean(item?.typeId.startsWith(FINDER_PREFIX));
}
export function isBoundTool(item) {
  return item?.typeId === KEY || isFinder(item);
}
export function statistics(items) {
  const stacks = items.filter(Boolean);
  return {types: new Set(stacks.map(i => i.typeId)).size, stacks: stacks.length, total: stacks.reduce((n, i) => n + i.amount, 0)};
}
export function refundXp(total, isOwner) {
  return Math.floor(Math.max(0, Math.trunc(total)) * (isOwner ? 70 : 50) / 100);
}
export function teleportReason(grave, used) {
  if (!grave) return "找不到墓碑记录，请联系管理员；未扣除末影珍珠。";
  if (used) return "这把钥匙的传送次数已用完，仍可用于开启墓碑。";
  if (grave.status === "opened") return "墓碑已被开启，无法传送。";
  if (grave.everMoved || grave.status !== "placed" || !samePosition(grave.current, grave.original)) return "墓碑已经被挖起或移动，重新放置也不能传送。";
  return "";
}
export function graveLabel(grave) {
  return `#${grave.id} ${grave.ownerName}的墓碑`;
}
export function lore(grave) {
  return [
    `§r§7墓碑编号：#${grave.id}　所有者：${grave.ownerName}`,
    `§r§7原始位置：${positionText(grave.original)}`,
    `§r§7死亡坐标：${positionText(grave.death)}`,
    `§r§a保存经验：${grave.xp}（本人70% / 他人50%）`,
    `§r§7物品种类：${grave.statistics.types}　堆数：${grave.statistics.stacks}　总数量：${grave.statistics.total}`
  ];
}
export function stateName(grave) {
  return ({placed: grave.everMoved ? "重新放置" : "原始位置", dropped: "掉落中", carried: "物品栏/容器中", opened: "已开启"})[grave.status] ?? "等待确认";
}
export function finderFrame(from, to, yaw) {
  const bearing = Math.atan2(-(to.x - from.x), to.z - from.z) * 180 / Math.PI;
  return Math.round((((bearing - yaw) % 360) + 360) % 360 / 22.5) % 16;
}
export function countItem(container, typeId) {
  let count = 0;
  for (let slot = 0; slot < container.size; slot++) {
    const item = container.getItem(slot);
    if (item?.typeId === typeId) count += item.amount;
  }
  return count;
}
export function consumeItem(container, typeId, amount) {
  if (countItem(container, typeId) < amount) return false;
  for (let slot = 0; slot < container.size && amount > 0; slot++) {
    const item = container.getItem(slot);
    if (item?.typeId !== typeId) continue;
    const take = Math.min(item.amount, amount);
    amount -= take;
    if (item.amount === take) container.setItem(slot);
    else { item.amount -= take; container.setItem(slot, item); }
  }
  return true;
}
