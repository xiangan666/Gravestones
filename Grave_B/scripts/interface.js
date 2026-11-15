import {world, ItemStack} from "@minecraft/server";
import {ActionFormData, MessageFormData} from "@minecraft/server-ui";
import {KEY, ID_PROPERTY, TOKEN_PROPERTY, KEY_USE_HINT, FINDER_PREFIX, dimensionName, positionText, lore, stateName, graveLabel, countItem, consumeItem, teleportReason, isFinder} from "./core.js";
import {container, itemGrave, keyUsed, spendKey, restoreKey, newKey, locks, loadDestination, loadDestinationMarker, saveGrave, safeBlock} from "./store.js";
import {graveAt} from "./lifecycle.js";
import {safeLanding, planLandingPlatform, LANDING_RADIUS} from "./landing.js";
export {safeLanding} from "./landing.js";

const menus = new Set();
export function updateTool(item, grave) {
  item.nameTag = `§r§e#${grave.id} ${grave.ownerName}的${isFinder(item) ? "寻墓器" : "墓碑钥匙"}`;
  const lines = lore(grave);
  if (isFinder(item)) {
    lines.push(`§r§b当前位置：${positionText(grave.current)}`);
    lines.push(`§r§7状态：${stateName(grave)}；手持时针尖指向目标`);
  } else lines.push(`§r§d传送次数：${keyUsed(item) ? 0 : 1}/1（成功消耗1个末影珍珠）`, KEY_USE_HINT);
  item.setLore(lines);
  item.keepOnDeath = true;
  return item;
}
function infoText(grave) {
  return [graveLabel(grave), `状态：${stateName(grave)}`, `原始位置：${positionText(grave.original)}`, `死亡坐标：${positionText(grave.death)}`, `当前位置：${positionText(grave.current)}`, `保存经验：${grave.xp}${grave.xpPaid ? "（已结算）" : ""}`, `所有者开启返还70%，其他玩家开启返还50%（向下取整）`, `物品种类：${grave.statistics.types}`, `堆数：${grave.statistics.stacks}　总数量：${grave.statistics.total}`, grave.status === "opened" ? `开启者：${grave.openedBy ?? "未知"}；寻墓器保留最后位置。` : "物品会优先进入开启者的物品栏；全部领取后消耗本次绑定钥匙，满背包未领完时保留钥匙及剩余物品。", "不同维度显示目标维度；离线持有者显示最后保存位置。"].join("\n");
}
function sameHeldKey(player, token) {
  const item = container(player).getItem(player.selectedSlotIndex);
  return item?.typeId === KEY && item.getDynamicProperty(TOKEN_PROPERTY) === token ? item : undefined;
}
export async function teleportToGrave(player, token) {
  let item = sameHeldKey(player, token);
  if (!item) { player.sendMessage("§e请继续手持刚才使用的钥匙。未扣除末影珍珠。 "); return; }
  const grave = itemGrave(item);
  let reason = teleportReason(grave, keyUsed(item));
  if (reason) { player.sendMessage(`§e${reason}`); return; }
  if (locks.has(grave.id)) { player.sendMessage("§e墓碑正在被操作，请稍后重试。 "); return; }
  locks.add(grave.id);
  let destination;
  try {
    player.sendMessage("§e正在加载墓碑附近区块，请保持手持钥匙……");
    destination = await loadDestination(grave, LANDING_RADIUS, () => player.isValid && !!sameHeldKey(player, token));
    if (!player.isValid) return;
    item = sameHeldKey(player, token);
    if (!item) { player.sendMessage("§e钥匙已切换，传送取消，未扣费。 "); return; }
    if (!destination) { player.sendMessage("§e目标区块尚未加载。请确认世界允许命令，并至少预留1个临时常加载区域名额。墓碑记录仍然有效，未扣费，请稍后重试。 "); return; }
    reason = teleportReason(grave, keyUsed(item));
    if (reason) { player.sendMessage(`§e${reason}`); return; }
    if (destination.block.typeId !== grave.blockId) { player.sendMessage("§e区块已加载，但原位置的墓碑方块不匹配，传送已取消，未扣费。请联系管理员检查。 "); return; }
    const marker = await loadDestinationMarker(grave, destination.dim);
    if (!player.isValid) return;
    if (!marker) { player.sendMessage("§e墓碑实体加载超时或编号存在冲突，未扣费，请稍后重试。 "); return; }
    player.sendMessage("§e正在寻找墓碑附近的安全落点，请保持手持钥匙……");
    let landing = await safeLanding(destination.dim, grave.original);
    const platform = landing ? undefined : await planLandingPlatform(destination.dim, grave.original);
    landing ??= platform?.location;
    if (!landing) { player.sendMessage("§e目标附近区块尚未就绪，或没有容纳玩家与落脚台的空间。未扣费，请稍后重试。 "); return; }
    if (!player.isValid) return;
    item = sameHeldKey(player, token);
    if (!item) { player.sendMessage("§e钥匙已切换，传送取消，未扣费。 "); return; }
    reason = teleportReason(grave, keyUsed(item));
    if (reason) { player.sendMessage(`§e${reason}`); return; }
    if (safeBlock(destination.dim, grave.original)?.typeId !== grave.blockId) { player.sendMessage("§e原位置的墓碑发生变化，传送取消，未扣费。 "); return; }
    const inv = container(player);
    if (!consumeItem(inv, "minecraft:ender_pearl", 1)) { player.sendMessage("§c需要1个末影珍珠，未使用传送次数。 "); return; }
    const changed = [];
    const keySlot = player.selectedSlotIndex;
    let keyUpdated = false;
    try {
      // Persist before the successful teleport; a cloned key shares this spent token.
      spendKey(item);
      // Crossing dimensions can invalidate both the entity and its old inventory handle.
      inv.setItem(keySlot, updateTool(item, grave));
      keyUpdated = true;
      if (platform) for (const block of platform.floor) {
        if (!block.isAir && !["minecraft:water", "minecraft:flowing_water", "minecraft:lava", "minecraft:flowing_lava"].includes(block.typeId)) throw new Error("落脚台位置发生变化，请重试。");
        changed.push({block, permutation: block.permutation});
        block.setType("minecraft:cobblestone");
      }
      if (!player.tryTeleport(landing, {dimension: destination.dim, checkForBlocks: true})) throw new Error("目标位置被阻挡。");
    } catch (error) {
      for (const {block, permutation} of changed.reverse()) { try { block.setPermutation(permutation); } catch { /* Preserve the refund even if a block unloads. */ } }
      restoreKey(item);
      if (keyUpdated) inv.setItem(keySlot, updateTool(item, grave));
      const remainder = inv.addItem(new ItemStack("minecraft:ender_pearl"));
      if (remainder) player.dimension.spawnItem(remainder, player.location);
      player.sendMessage(`§e传送失败，已退还末影珍珠，次数未消耗：${error.message}`);
      return;
    }
    if (platform) player.sendMessage("§e附近没有天然安全落点，已在墓碑附近空旷处搭建3×3圆石落脚台。落脚台会保留。");
    player.sendMessage(`§a已传送至墓碑 #${grave.id}，消耗1个末影珍珠。钥匙保留，传送次数已用完。`);
  } finally { destination?.release(); locks.delete(grave.id); }
}
export async function craftFinder(player, token) {
  const confirmation = await new MessageFormData().title("合成寻墓器").body("消耗当前绑定钥匙1把 + 指南针1个，制作与这座墓碑绑定的寻墓器。钥匙会作为合成材料消耗；寻墓器用于寻路，不能代替钥匙开启墓碑。可用20个末影珍珠补领钥匙。").button1("取消").button2("确认合成").show(player);
  if (confirmation.canceled || confirmation.selection !== 1 || !player.isValid) return;
  const key = sameHeldKey(player, token);
  const grave = itemGrave(key);
  if (!key || !grave) { player.sendMessage("§e钥匙已切换或未绑定，合成取消。 "); return; }
  if (grave.status === "opened") { player.sendMessage("§e这座墓碑已经开启，无需制作寻墓器。 "); return; }
  const inv = container(player);
  const finder = new ItemStack(`${FINDER_PREFIX}0`);
  finder.setDynamicProperty(ID_PROPERTY, grave.id);
  updateTool(finder, grave);
  if (!consumeItem(inv, "minecraft:compass", 1)) { player.sendMessage("§c需要1个指南针，钥匙未消耗。 "); return; }
  inv.setItem(player.selectedSlotIndex, finder);
  player.sendMessage(`§a已合成 #${grave.id} 寻墓器。手持时显示目标方向、维度与位置。`);
}
export async function showToolMenu(player) {
  if (menus.has(player.id)) return;
  menus.add(player.id);
  try {
    const item = container(player).getItem(player.selectedSlotIndex);
    const grave = itemGrave(item);
    if (!grave) { player.sendMessage("§e这把钥匙未绑定墓碑。死亡后会自动获得绑定钥匙；补领请用20个末影珍珠点击自己的墓碑。 "); return; }
    const finder = isFinder(item);
    const token = item.getDynamicProperty(TOKEN_PROPERTY);
    const form = new ActionFormData().title(finder ? `#${grave.id} 寻墓器` : `#${grave.id} 墓碑钥匙`).body(`${graveLabel(grave)}\n状态：${stateName(grave)}\n${finder ? `目标：${positionText(grave.current)}` : `传送次数：${keyUsed(item) ? 0 : 1}/1`}`).button("基本信息");
    if (!finder) form.button("传送至墓碑").button("合成寻墓器（钥匙 + 指南针）");
    const response = await form.show(player);
    if (response.canceled || !player.isValid) return;
    if (response.selection === 0) await new ActionFormData().title("墓碑基本信息").body(infoText(grave)).button("关闭").show(player);
    else if (response.selection === 1 && !finder) {
      const reason = teleportReason(grave, keyUsed(item));
      if (reason) { player.sendMessage(`§e${reason}`); return; }
      const confirmation = await new MessageFormData().title("传送确认").body(`目标：${graveLabel(grave)}\n${positionText(grave.original)}\n确认后消耗1个末影珍珠和这把钥匙唯一的1次传送次数。墓碑必须始终位于初次生成位置。将优先传送到附近安全点；确无天然落点时在空旷处搭建3×3圆石落脚台，落脚台保留。`).button1("取消").button2("确认传送").show(player);
      if (!confirmation.canceled && confirmation.selection === 1) await teleportToGrave(player, token);
    } else if (response.selection === 2 && !finder) await craftFinder(player, token);
  } finally { menus.delete(player.id); }
}
export function recoverKey(player, block) {
  const grave = graveAt(block);
  if (!grave || grave.status !== "placed") { player.sendMessage("§e请对放置中的墓碑使用末影珍珠。 "); return; }
  if (grave.ownerId !== player.id) { player.sendMessage("§c只有墓碑所有者可以补领绑定钥匙。 "); return; }
  if (locks.has(grave.id)) return;
  const inv = container(player);
  if (inv.getItem(player.selectedSlotIndex)?.typeId !== "minecraft:ender_pearl") return;
  if (countItem(inv, "minecraft:ender_pearl") < 20) { player.sendMessage("§c补领钥匙需要20个末影珍珠，会从整个背包合计扣除。 "); return; }
  // Pearls stack to 16: taking 20 necessarily frees at least one slot.
  const key = updateTool(newKey(grave), grave);
  locks.add(grave.id);
  try {
    if (!consumeItem(inv, "minecraft:ender_pearl", 20)) return;
    const remainder = inv.addItem(key);
    if (remainder) {
      let refund = 20;
      while (refund) { const n = Math.min(refund, 16); const extra = inv.addItem(new ItemStack("minecraft:ender_pearl", n)); if (extra) player.dimension.spawnItem(extra, player.location); refund -= n; }
      player.sendMessage("§e背包空间不足，已退还20个末影珍珠。 ");
      return;
    }
    player.sendMessage(`§a已消耗20个末影珍珠，补领 #${grave.id} 绑定钥匙。墓碑被挖起后，新钥匙也不能传送。`);
  } finally { locks.delete(grave.id); }
}
