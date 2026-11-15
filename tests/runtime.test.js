import {registerHooks} from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
registerHooks({resolve(specifier, context, next) {
  if (specifier === "@minecraft/server") return {url: new URL("./mock-server.js", import.meta.url).href, shortCircuit: true};
  if (specifier === "@minecraft/server-ui") return {url: new URL("./mock-ui.js", import.meta.url).href, shortCircuit: true};
  return next(specifier, context);
}});
const mc = await import("./mock-server.js");
const ui = await import("./mock-ui.js");
const core = await import("../Grave_B/scripts/core.js");
const store = await import("../Grave_B/scripts/store.js");
const life = await import("../Grave_B/scripts/lifecycle.js");
const menu = await import("../Grave_B/scripts/interface.js");
const tracking = await import("../Grave_B/scripts/tracking.js");
await import("../Grave_B/scripts/grave.js");
const overworld = mc.world.getDimension("overworld");
let counter = 0;
function fresh() {
  mc.entities.clear();
  for (const dim of mc.dims.values()) { dim.blocks.clear(); dim.terrain = undefined; dim.unloaded = false; dim.loadWorks = true; dim.failCommands = false; dim.commands.length = 0; }
  store.locks.clear(); ui.responses.length = 0;
  const owner = new mc.Player("lanshiyi", overworld, {x: (++counter) * 100, y: 64, z: 0});
  owner.inventory.setItem(0, new mc.ItemStack("minecraft:diamond", 3));
  return owner;
}
function death(owner) {
  life.captureDeath(owner);
  const grave = store.allGraves().filter(g => g.ownerId === owner.id).at(-1);
  assert.ok(grave);
  life.givePendingKeys(owner);
  const key = owner.inventory.getItem(0);
  assert.equal(key.typeId, core.KEY);
  return {grave, key, block: overworld.getBlock(grave.current)};
}
test("真实入口事件注册与2.0启动组件", () => {
  assert.equal(mc.world.afterEvents.entityDie.callbacks.length, 1);
  assert.equal(mc.world.beforeEvents.playerBreakBlock.callbacks.length, 1);
  assert.equal(mc.system.beforeEvents.startup.callbacks.length, 1);
});
test("死亡完整保存附魔/自定义数据/装备；经验清零，钥匙保留且有编号", () => {
  const owner = fresh();
  const sword = new mc.ItemStack("minecraft:diamond_sword"); sword.enchantments = {sharpness: 5}; sword.damage = 123; sword.setDynamicProperty("other_mod:data", "preserve"); sword.nameTag = "传家宝";
  owner.inventory.setItem(5, sword); owner.equipment.set("Head", new mc.ItemStack("minecraft:diamond_helmet"));
  const {grave, key} = death(owner);
  assert.equal(owner.xp, 0); assert.equal(owner.inventory.getItem(5), undefined); assert.equal(owner.equipment.size, 0);
  const saved = store.container(store.storage(grave)).getItem(5);
  assert.deepEqual(saved.enchantments, {sharpness: 5}); assert.equal(saved.damage, 123); assert.equal(saved.nameTag, "传家宝"); assert.equal(saved.getDynamicProperty("other_mod:data"), "preserve");
  assert.match(key.nameTag, new RegExp(`#${grave.id}`)); assert.match(key.getLore().join(""), /保存经验：101/);
  assert.equal(store.getEntity(grave.markerId).nameTag, `§r§e#${grave.id} lanshiyi的墓碑`);
});
test("本人70%，其他玩家50%，完整领取消耗钥匙，重复开启不重复结算", async () => {
  for (const isOwner of [true, false]) {
    const owner = fresh(); const {grave, key, block} = death(owner);
    const opener = isOwner ? owner : new mc.Player("其他玩家", overworld, owner.location);
    opener.inventory.setItem(0, key); opener.xp = 0;
    await life.openGrave(opener, block);
    assert.equal(opener.xp, isOwner ? 70 : 50); assert.equal(grave.status, "opened");
    await life.openGrave(opener, block); assert.equal(opener.xp, isOwner ? 70 : 50);
    assert.equal(opener.inventory.getItem(0), undefined);
  }
});
test("错误编号钥匙不能打开其他墓碑", () => {
  const owner = fresh(); const a = death(owner); owner.inventory.setItem(1, new mc.ItemStack("minecraft:gold_ingot")); const b = death(owner);
  owner.inventory.setItem(0, a.key); owner.xp = 0;
  life.openGrave(owner, b.block); assert.equal(b.grave.status, "placed"); assert.equal(owner.xp, 0);
  assert.equal(owner.inventory.getItem(0).getDynamicProperty(core.TOKEN_PROPERTY), a.key.getDynamicProperty(core.TOKEN_PROPERTY));
});
test("挖起→保护掉落实体→拾取→再放置，库存和编号保持且永久取消传送", () => {
  const owner = fresh(); const {grave, block} = death(owner);
  life.mineGrave(owner, block);
  assert.equal(block.typeId, "minecraft:air"); assert.equal(grave.everMoved, true); assert.equal(grave.status, "dropped");
  const drop = store.getEntity(grave.dropId); assert.equal(drop.typeId, core.DROP); drop.setDynamicProperty("lanshiyi:ready_at", 0);
  life.tickDrops(overworld);
  assert.equal(grave.status, "carried"); assert.equal(drop.isValid, false);
  const slot = owner.inventory.slots.findIndex(i => i?.typeId === core.GRAVE_ITEM); owner.selectedSlotIndex = slot;
  const support = overworld.getBlock({x: owner.location.x + 3, y: 63, z: 0});
  life.placeGrave(owner, support, "Up");
  assert.equal(grave.status, "placed"); assert.equal(grave.current.x, support.x); assert.notEqual(core.teleportReason(grave, false), "");
  assert.equal(store.container(store.storage(grave)).getItem(0).amount, 3);
});
test("传送成功扣1颗珍珠、钥匙保留，复制钥匙共享用尽状态", async () => {
  const owner = fresh(); const {grave, key} = death(owner); owner.inventory.setItem(1, new mc.ItemStack("minecraft:ender_pearl", 3));
  const token = key.getDynamicProperty(core.TOKEN_PROPERTY);
  await menu.teleportToGrave(owner, token);
  assert.equal(core.countItem(owner.inventory, "minecraft:ender_pearl"), 2); assert.equal(store.keyUsed(key), true); assert.equal(owner.inventory.getItem(0).typeId, core.KEY);
  await menu.teleportToGrave(owner, token); assert.equal(core.countItem(owner.inventory, "minecraft:ender_pearl"), 2);
});
test("珍珠不足、失败或取消的传送不扣费不消耗次数", async () => {
  const owner = fresh(); const {key} = death(owner); const token = key.getDynamicProperty(core.TOKEN_PROPERTY);
  await menu.teleportToGrave(owner, token); assert.equal(store.keyUsed(key), false);
  owner.inventory.setItem(1, new mc.ItemStack("minecraft:ender_pearl")); owner.teleportWorks = false;
  await menu.teleportToGrave(owner, token);
  assert.equal(core.countItem(owner.inventory, "minecraft:ender_pearl"), 1); assert.equal(store.keyUsed(key), false);
});
test("未加载区块可通过临时区域加载后传送，结束后清理区域", async () => {
  const owner = fresh(); const {grave, key} = death(owner); owner.inventory.setItem(1, new mc.ItemStack("minecraft:ender_pearl"));
  overworld.unloaded = true;
  await menu.teleportToGrave(owner, key.getDynamicProperty(core.TOKEN_PROPERTY));
  assert.equal(store.keyUsed(key), true); assert.ok(overworld.commands.some(c => c.includes(`tickingarea remove ls_tp_${grave.id}`)));
});
test("区块加载超时不会误判挖起或丢失，也不会扣珍珠", async () => {
  const owner = fresh(); const {grave, key} = death(owner); owner.inventory.setItem(1, new mc.ItemStack("minecraft:ender_pearl"));
  overworld.unloaded = true; overworld.loadWorks = false;
  await menu.teleportToGrave(owner, key.getDynamicProperty(core.TOKEN_PROPERTY));
  assert.equal(grave.status, "placed"); assert.equal(grave.everMoved, false); assert.equal(store.keyUsed(key), false); assert.equal(core.countItem(owner.inventory, "minecraft:ender_pearl"), 1);
  assert.match(owner.messages.at(-1), /区块尚未加载/);
});

test("远距离传送等待方块加载后延迟恢复的墓碑实体", async () => {
  const owner = fresh(); const {grave, key} = death(owner);
  owner.location = {x: 100000, y: 64, z: -100000};
  owner.inventory.setItem(1, new mc.ItemStack("minecraft:ender_pearl"));
  const readyAt = mc.system.currentTick + 30;
  mc.entities.get(grave.markerId).loadAt = readyAt;
  overworld.unloaded = true;
  await menu.teleportToGrave(owner, key.getDynamicProperty(core.TOKEN_PROPERTY));
  assert.ok(mc.system.currentTick >= readyAt);
  assert.equal(store.keyUsed(key), true);
  assert.ok(Math.abs(owner.location.x - grave.original.x) <= 32);
  assert.equal(core.countItem(owner.inventory, "minecraft:ender_pearl"), 0);
  assert.ok(overworld.commands.includes(`tickingarea remove ls_tp_${grave.id}`));
});

test("远距离传送按原位置与编号重连失效的墓碑实体ID", async () => {
  const owner = fresh(); const {grave, key} = death(owner);
  const actualId = grave.markerId;
  grave.markerId = "invalid-native-id";
  owner.inventory.setItem(1, new mc.ItemStack("minecraft:ender_pearl"));
  await menu.teleportToGrave(owner, key.getDynamicProperty(core.TOKEN_PROPERTY));
  assert.equal(grave.markerId, actualId);
  assert.equal(store.keyUsed(key), true);
});

test("墓碑实体确实缺失时等待超时，不扣费且释放区域与锁", async () => {
  const owner = fresh(); const {grave, key} = death(owner);
  store.getEntity(grave.markerId).remove();
  owner.inventory.setItem(1, new mc.ItemStack("minecraft:ender_pearl"));
  const started = mc.system.currentTick;
  await menu.teleportToGrave(owner, key.getDynamicProperty(core.TOKEN_PROPERTY));
  assert.ok(mc.system.currentTick >= started + 80);
  assert.equal(store.keyUsed(key), false);
  assert.equal(core.countItem(owner.inventory, "minecraft:ender_pearl"), 1);
  assert.equal(grave.status, "placed");
  assert.equal(store.locks.has(grave.id), false);
  assert.ok(overworld.commands.includes(`tickingarea remove ls_tp_${grave.id}`));
  assert.match(owner.messages.at(-1), /实体加载超时/);
});

test("等待墓碑实体恢复期间切换钥匙，取消传送并保留材料", async () => {
  const owner = fresh(); const {grave, key} = death(owner);
  mc.entities.get(grave.markerId).loadAt = mc.system.currentTick + 30;
  owner.inventory.setItem(1, new mc.ItemStack("minecraft:ender_pearl"));
  const pending = menu.teleportToGrave(owner, key.getDynamicProperty(core.TOKEN_PROPERTY));
  await Promise.resolve();
  owner.selectedSlotIndex = 1;
  await pending;
  assert.equal(store.keyUsed(key), false);
  assert.equal(core.countItem(owner.inventory, "minecraft:ender_pearl"), 1);
  assert.equal(store.locks.has(grave.id), false);
});
test("20颗珍珠跨堆补领，仅限所有者且保留绑定", () => {
  const owner = fresh(); const {grave, block} = death(owner);
  owner.inventory.setItem(0, new mc.ItemStack("minecraft:ender_pearl", 16)); owner.inventory.setItem(1, new mc.ItemStack("minecraft:ender_pearl", 7));
  menu.recoverKey(owner, block);
  assert.equal(core.countItem(owner.inventory, "minecraft:ender_pearl"), 3); assert.equal(store.itemGrave(owner.inventory.getItem(0)).id, grave.id);
  const other = new mc.Player("other", overworld, owner.location); other.inventory.setItem(0, new mc.ItemStack("minecraft:ender_pearl", 16)); other.inventory.setItem(1, new mc.ItemStack("minecraft:ender_pearl", 16));
  menu.recoverKey(other, block); assert.equal(core.countItem(other.inventory, "minecraft:ender_pearl"), 32);
});
test("合成寻墓器精确继承编号，只扣当前钥匙及一个指南针", async () => {
  const owner = fresh(); const {grave, key} = death(owner); owner.inventory.setItem(1, new mc.ItemStack("minecraft:compass", 2));
  ui.responses.push({canceled: false, selection: 1});
  await menu.craftFinder(owner, key.getDynamicProperty(core.TOKEN_PROPERTY));
  assert.equal(owner.inventory.getItem(0).typeId, `${core.FINDER_PREFIX}0`); assert.equal(store.itemGrave(owner.inventory.getItem(0)).id, grave.id); assert.equal(core.countItem(owner.inventory, "minecraft:compass"), 1);
});
test("满背包仍保存未领取遗物，经验只发放一次", () => {
  const owner = fresh(); const {grave, block} = death(owner);
  for (let i = 1; i < 36; i++) owner.inventory.setItem(i, new mc.ItemStack("minecraft:dirt", 64));
  life.openGrave(owner, block); assert.equal(grave.status, "placed"); assert.equal(owner.xp, 70); assert.equal(store.container(store.storage(grave)).getItem(0).amount, 3);
  assert.equal(owner.inventory.getItem(0).typeId, core.KEY);
  life.openGrave(owner, block); assert.equal(owner.xp, 70);
  owner.inventory.setItem(1); life.openGrave(owner, block); assert.equal(grave.status, "opened"); assert.equal(owner.xp, 70);
  assert.equal(owner.inventory.getItem(0), undefined);
});

test("部分领取：保留钥匙供续领，最后一次领取才消耗且经验不重复", async () => {
  const owner = fresh(); const {grave, block, key} = death(owner);
  owner.inventory.setItem(1, new mc.ItemStack("minecraft:diamond", 63));
  for (let i = 2; i < 36; i++) owner.inventory.setItem(i, new mc.ItemStack("minecraft:dirt", 64));
  await life.openGrave(owner, block);
  assert.equal(owner.inventory.getItem(1).amount, 64);
  assert.equal(store.container(store.storage(grave)).getItem(0).amount, 2);
  assert.equal(owner.inventory.getItem(0).getDynamicProperty(core.TOKEN_PROPERTY), key.getDynamicProperty(core.TOKEN_PROPERTY));
  assert.equal(grave.status, "placed"); assert.equal(owner.xp, 70);
  owner.inventory.setItem(2);
  await life.openGrave(owner, block);
  assert.equal(grave.status, "opened"); assert.equal(owner.inventory.getItem(0), undefined);
  assert.equal(core.countItem(owner.inventory, "minecraft:diamond"), 66); assert.equal(owner.xp, 70);
});

test("只消耗当前槽位使用的一把钥匙，其他墓碑钥匙、复制钥匙及管理员钥匙保留", async () => {
  const owner = fresh(); const a = death(owner); const b = death(owner);
  const bKey = store.newKey(b.grave);
  owner.inventory.setItem(1, bKey); owner.inventory.setItem(2, a.key);
  owner.inventory.setItem(3, new mc.ItemStack(core.ADMIN_KEY)); owner.selectedSlotIndex = 2;
  await life.openGrave(owner, a.block);
  assert.equal(a.grave.status, "opened"); assert.equal(owner.inventory.getItem(2), undefined);
  assert.equal(owner.inventory.getItem(0).getDynamicProperty(core.ID_PROPERTY), a.grave.id);
  assert.equal(owner.inventory.getItem(1).getDynamicProperty(core.TOKEN_PROPERTY), bKey.getDynamicProperty(core.TOKEN_PROPERTY));
  assert.equal(owner.inventory.getItem(3).typeId, core.ADMIN_KEY); assert.equal(b.grave.status, "placed");
});

test("管理员钥匙开启成功后保留", async () => {
  const owner = fresh(); const {grave, block} = death(owner);
  owner.inventory.setItem(0, new mc.ItemStack(core.ADMIN_KEY));
  await life.openGrave(owner, block);
  assert.equal(grave.status, "opened"); assert.equal(owner.inventory.getItem(0).typeId, core.ADMIN_KEY);
});

test("管理员权限开启不误删手持的其他墓碑钥匙", async () => {
  const owner = fresh(); const a = death(owner); const b = death(owner);
  const otherKey = store.newKey(b.grave); owner.inventory.setItem(0, otherKey); owner.addTag("admin");
  await life.openGrave(owner, a.block);
  assert.equal(a.grave.status, "opened"); assert.equal(b.grave.status, "placed");
  assert.equal(owner.inventory.getItem(0).getDynamicProperty(core.TOKEN_PROPERTY), otherKey.getDynamicProperty(core.TOKEN_PROPERTY));
});

test("空墓碑成功完成也消耗钥匙；传送次数用尽的钥匙仍可开启并消耗", async () => {
  for (const empty of [true, false]) {
    const owner = fresh();
    if (empty) { owner.inventory.setItem(0); owner.xp = 0; }
    const {grave, block, key} = death(owner); store.spendKey(key);
    await life.openGrave(owner, block);
    assert.equal(grave.status, "opened"); assert.equal(owner.inventory.getItem(0), undefined);
  }
});

test("钥匙说明展示全部领取后消耗的规则，刷新说明时保留", () => {
  const owner = fresh(); const {grave, key} = death(owner);
  assert.ok(key.getLore().includes(core.KEY_USE_HINT));
  assert.ok(menu.updateTool(key, grave).getLore().includes(core.KEY_USE_HINT));
});
test("普通墓碑物品被丢弃时立即转换为永久实体", () => {
  const owner = fresh(); const {grave, block} = death(owner); life.mineGrave(owner, block); const old = store.getEntity(grave.dropId); old.remove(); grave.dropId = undefined; grave.status = "carried";
  const vanilla = overworld.spawnItem(life.makeGraveItem(grave), {x: owner.location.x + 20, y: 64, z: 0});
  life.convertVanillaDrop(vanilla); assert.equal(vanilla.isValid, false); assert.equal(store.getEntity(grave.dropId).typeId, core.DROP);
});
test("岩浆中的墓碑实体被托至液面上方", () => {
  const owner = fresh(); const {grave, block} = death(owner); life.mineGrave(owner, block); const drop = store.getEntity(grave.dropId); drop.location.x += 20;
  for (let y = 64; y <= 68; y++) overworld.getBlock({x: drop.location.x, y, z: 0}).setType("minecraft:lava");
  life.tickDrops(overworld); assert.ok(drop.location.y > 69); assert.equal(drop.velocityCleared, true);
});
test("旧版库存实体迁移保留物品、分配编号，旧钥匙可认领", () => {
  const owner = fresh(); owner.inventory.setItem(0); const p = {...owner.location}; const marker = overworld.spawnEntity(core.MARKER, p); marker.nameTag = "§c旧名字§r\n R.I.P"; marker.tags = [owner.id]; marker.setDynamicProperty("coords", p); marker.inventory.setItem(0, new mc.ItemStack("minecraft:emerald", 7));
  const block = overworld.getBlock(p); block.setType("effect99:stone_grave"); life.migrateLegacy(marker);
  const grave = store.getGrave(marker.getDynamicProperty(core.ID_PROPERTY)); assert.equal(grave.xp, 0); assert.equal(store.container(store.storage(grave)).getItem(0).amount, 7); assert.equal(marker.inventory.emptySlotsCount, 42);
  const key = new mc.ItemStack(core.KEY); key.setLore([`§r§9Place of death: §c${p.x}, ${p.y}, ${p.z}`, "§r§8minecraft:overworld"]); owner.inventory.setItem(0, key);
  assert.equal(tracking.bindLegacyKey(owner, block), true); assert.equal(store.itemGrave(owner.inventory.getItem(0)).id, grave.id);
});
test("寻墓器跟随他人背包、跨维度和被打开的容器", () => {
  const owner = fresh(); const {grave, block} = death(owner); life.mineGrave(owner, block); store.getEntity(grave.dropId).remove(); grave.dropId = undefined;
  const carrier = new mc.Player("carrier", mc.world.getDimension("nether"), {x: 20, y: 72, z: 30}); carrier.inventory.setItem(3, life.makeGraveItem(grave));
  tracking.tickPlayers(); assert.equal(grave.current.dimension, "minecraft:nether"); assert.equal(grave.holderId, carrier.id);
  const chest = carrier.dimension.getBlock({x: 21, y: 72, z: 30}); chest.inventory = new mc.Container(27); chest.inventory.setItem(0, carrier.inventory.getItem(3)); carrier.inventory.setItem(3); tracking.watchContainer(chest);
  tracking.tickWorld(); assert.equal(grave.current.x, 21); assert.match(grave.holderId, /^container:/);
});
test("重建持久层后，编号、移动标志、经验和已用令牌保留", async () => {
  const owner = fresh(); const {grave, key, block} = death(owner);
  store.spendKey(key); life.mineGrave(owner, block);
  const reloaded = await import(`../Grave_B/scripts/store.js?restart=${counter}`);
  const record = reloaded.getGrave(grave.id);
  assert.equal(record.id, grave.id); assert.equal(record.everMoved, true); assert.equal(record.xp, 101); assert.equal(record.status, "dropped"); assert.equal(reloaded.keyUsed(key), true);
});
test("爆炸事件排除墓碑方块，且不移除普通受影响方块", () => {
  const owner = fresh(); const {block} = death(owner);
  const ordinary = overworld.getBlock({x: block.x + 5, y: 63, z: 0});
  const event = {dimension: overworld, getImpactedBlocks() { return [block, ordinary]; }, setImpactedBlocks(value) { this.blocks = value; }};
  mc.world.beforeEvents.explosion.callbacks[0](event);
  assert.deepEqual(event.blocks, [ordinary]);
});
test("传送加载期间切换钥匙会取消，锁被释放且不扣费", async () => {
  const owner = fresh(); const {grave, key} = death(owner);
  owner.inventory.setItem(1, new mc.ItemStack("minecraft:ender_pearl")); overworld.unloaded = true;
  const pending = menu.teleportToGrave(owner, key.getDynamicProperty(core.TOKEN_PROPERTY));
  owner.selectedSlotIndex = 1;
  await pending;
  assert.equal(core.countItem(owner.inventory, "minecraft:ender_pearl"), 1); assert.equal(store.keyUsed(key), false); assert.equal(store.locks.has(grave.id), false);
});
test("跨多个存档死亡记录不会重用墓碑编号", () => {
  const owner = fresh(); const a = death(owner); owner.inventory.setItem(2, new mc.ItemStack("minecraft:iron_ingot")); const b = death(owner);
  assert.ok(b.grave.id > a.grave.id); assert.equal(store.getGrave(a.grave.id).id, a.grave.id);
});
test("回归：仅带钥匙零经验再次死亡，仍能同时存在三座独立编号墓碑", () => {
  const owner = fresh();
  const a = death(owner);
  life.captureDeath(owner); life.givePendingKeys(owner);
  life.captureDeath(owner); life.givePendingKeys(owner);
  const graves = store.allGraves().filter(g => g.ownerId === owner.id);
  assert.equal(graves.length, 3);
  assert.deepEqual(graves.map(g => g.id), [a.grave.id, a.grave.id + 1, a.grave.id + 2]);
  assert.equal(new Set(graves.map(g => `${g.current.x},${g.current.y},${g.current.z}`)).size, 3);
  assert.equal(new Set(graves.map(g => g.storageId)).size, 3);
});
test("回归：编号计数被重置，分配器仍越过已有记录且不覆盖旧墓碑", () => {
  const owner = fresh(); const {grave} = death(owner);
  const before = mc.world.getDynamicProperty(`lanshiyi:g:${grave.id}`);
  mc.world.setDynamicProperty("lanshiyi:grave_sequence", 0);
  assert.ok(store.nextNumber("grave_sequence") > grave.id);
  assert.equal(mc.world.getDynamicProperty(`lanshiyi:g:${grave.id}`), before);
});
test("回归：保存的库存实体ID失效，按墓碑编号恢复唯一库存关联", async () => {
  const owner = fresh(); const {grave, block} = death(owner);
  const actual = grave.storageId;
  grave.storageId = "invalid-native-id"; store.saveGrave(grave);
  await life.openGrave(owner, block);
  assert.equal(grave.storageId, actual); assert.equal(grave.status, "opened"); assert.equal(owner.xp, 70);
});
test("回归：区块方块先就绪、库存实体稍后加载，开墓会等待且只发一次遗物", async () => {
  const owner = fresh(); const {grave, block} = death(owner);
  const stored = store.getEntity(grave.storageId); stored.loadAt = mc.system.currentTick + 6;
  const first = life.openGrave(owner, block);
  const second = life.openGrave(owner, block);
  await Promise.all([first, second]);
  assert.equal(grave.status, "opened"); assert.equal(owner.xp, 70);
  assert.equal(core.countItem(owner.inventory, "minecraft:diamond"), 3);
  assert.equal(store.locks.has(grave.id), false);
});
test("回归：现有库存已加载时，命令配额异常不能阻止开墓", async () => {
  const owner = fresh(); const {grave} = death(owner);
  overworld.failCommands = true;
  const reloaded = await import(`../Grave_B/scripts/store.js?quota=${counter}`);
  assert.equal(reloaded.storage(grave)?.id, grave.storageId);
});
test("多墓碑：连续死亡保存三份遗物，正确钥匙分别取回，其他墓碑不受影响", async () => {
  const owner = fresh();
  const graves = [];
  const types = ["minecraft:diamond", "minecraft:emerald", "minecraft:gold_ingot"];
  for (let i = 0; i < 3; i++) {
    owner.inventory.setItem(20, new mc.ItemStack(types[i], i + 2));
    owner.xp = 101 + i * 100;
    life.captureDeath(owner); life.givePendingKeys(owner);
    graves.push(store.allGraves().filter(g => g.ownerId === owner.id).at(-1));
  }
  assert.equal(new Set(graves.map(g => g.id)).size, 3);
  for (let i = 0; i < graves.length; i++) {
    const grave = graves[i];
    const slot = owner.inventory.slots.findIndex(item => item?.typeId === core.KEY && item.getDynamicProperty(core.ID_PROPERTY) === grave.id);
    assert.ok(slot >= 0); owner.selectedSlotIndex = slot;
    await life.openGrave(owner, overworld.getBlock(grave.current));
    assert.equal(grave.status, "opened");
    assert.equal(core.countItem(owner.inventory, types[i]), i === 0 ? 5 : i + 2);
    for (const waiting of graves.slice(i + 1)) {
      assert.equal(waiting.status, "placed"); assert.ok(store.storage(waiting));
    }
  }
  assert.equal(owner.xp, 70 + 140 + 210);
});
test("重启：主计数和备用计数同时回退时，从已有记录恢复最大编号", async () => {
  const owner = fresh(); const {grave} = death(owner);
  const records = store.allGraves();
  const highest = Math.max(...records.map(g => g.id));
  const before = records.map(g => [g.id, mc.world.getDynamicProperty(`lanshiyi:g:${g.id}`)]);
  mc.world.setDynamicProperty("lanshiyi:grave_sequence", 0);
  mc.world.setDynamicProperty("lanshiyi:grave_sequence_high_water", 0);
  const reloaded = await import(`../Grave_B/scripts/store.js?counter_repair=${counter}`);
  assert.equal(reloaded.nextNumber("grave_sequence"), highest + 1);
  for (const [id, record] of before) assert.equal(mc.world.getDynamicProperty(`lanshiyi:g:${id}`), record);
  assert.equal(reloaded.getGrave(grave.id).storageId, grave.storageId);
});
test("升级：2.0.9记录无库存坐标且旧实体ID失效，仍能等待并恢复库存", async () => {
  const owner = fresh(); const {grave, block} = death(owner);
  const stored = store.getEntity(grave.storageId);
  delete grave.storagePosition; grave.storageId = "outdated-2.0.9-id"; store.saveGrave(grave);
  stored.loadAt = mc.system.currentTick + 6;
  await life.openGrave(owner, block);
  assert.equal(grave.storageId, stored.id); assert.equal(grave.status, "opened"); assert.equal(core.countItem(owner.inventory, "minecraft:diamond"), 3);
});
test("保护：库存实体确实不在时，保留钥匙和墓碑记录，不创建空库存或结算经验", async () => {
  const owner = fresh(); const {grave, block, key} = death(owner);
  store.getEntity(grave.storageId).remove();
  await life.openGrave(owner, block);
  assert.equal(grave.status, "placed"); assert.equal(grave.xpPaid, undefined); assert.equal(owner.xp, 0);
  assert.equal(overworld.getEntities({type: core.STORAGE}).length, 0);
  assert.match(owner.messages.at(-1), /未找到.*库存实体/);
  assert.equal(store.locks.has(grave.id), false);
  assert.equal(owner.inventory.getItem(0).getDynamicProperty(core.TOKEN_PROPERTY), key.getDynamicProperty(core.TOKEN_PROPERTY));
});
test("保护：等待库存期间切换钥匙，取消领取并释放墓碑锁", async () => {
  const owner = fresh(); const {grave, block} = death(owner);
  store.getEntity(grave.storageId).loadAt = mc.system.currentTick + 4;
  const pending = life.openGrave(owner, block); owner.selectedSlotIndex = 5;
  await pending;
  assert.equal(grave.status, "placed"); assert.equal(owner.xp, 0); assert.ok(store.storage(grave)); assert.equal(store.locks.has(grave.id), false);
  assert.equal(owner.inventory.getItem(0).typeId, core.KEY);
});
test("玩家姓名：墓碑和钥匙读取各自死亡玩家名字，不固定为作者名", () => {
  fresh();
  for (const [index, name] of ["Steve", "小明"].entries()) {
    const player = new mc.Player(name, overworld, {x: 9000 + index * 10, y: 64, z: 0});
    player.inventory.setItem(1, new mc.ItemStack("minecraft:iron_ingot"));
    const {grave, key} = death(player);
    assert.equal(grave.ownerName, name); assert.equal(grave.ownerId, player.id);
    assert.equal(store.getEntity(grave.markerId).nameTag, `§r§e#${grave.id} ${name}的墓碑`);
    assert.ok(key.nameTag.includes(`${name}的墓碑钥匙`));
    assert.ok(!key.nameTag.includes("lanshiyi"));
  }
});

test("传送落点：墓碑高于地面时向下寻找，允许站在草丛中", async () => {
  fresh();
  overworld.terrain = p => p.y < 63 ? "minecraft:stone" : p.y === 63 ? "minecraft:grass_block" : p.y === 64 ? "minecraft:short_grass" : "minecraft:air";
  const landing = await menu.safeLanding(overworld, {x: 0, y: 70, z: 0});
  assert.deepEqual(landing, {x: 0.5, y: 64, z: 0.5});
});

test("传送落点：近处无地面时扩大到32格，找到20格外安全点", async () => {
  fresh();
  overworld.terrain = p => p.x === 20 && p.y === 63 ? "minecraft:stone" : "minecraft:air";
  const landing = await menu.safeLanding(overworld, {x: 0, y: 64, z: 0});
  assert.equal(landing.x, 20.5); assert.equal(landing.y, 64);
});

test("传送落点：危险地面不可作为安全落点", async () => {
  const {canStand} = await import("../Grave_B/scripts/landing.js");
  for (const typeId of ["minecraft:lava", "minecraft:fire", "minecraft:magma", "minecraft:cactus", "minecraft:campfire"]) {
    fresh();
    overworld.getBlock({x: 0, y: 63, z: 0}).setType(typeId);
    assert.equal(canStand(overworld, {x: 0, y: 64, z: 0}), false);
  }
});

function voidGrave(owner) {
  const result = death(owner);
  overworld.blocks.clear();
  overworld.terrain = p => p.y <= 63 ? "minecraft:lava" : "minecraft:air";
  const block = overworld.getBlock(result.grave.original); block.setType(result.grave.blockId);
  block.collidable = false;
  return result;
}
test("传送兜底：没有天然地面也能抵达附近落脚台，只扣一颗珍珠", async () => {
  const owner = fresh(); const {grave, key} = voidGrave(owner);
  owner.inventory.setItem(1, new mc.ItemStack("minecraft:ender_pearl", 2));
  await menu.teleportToGrave(owner, key.getDynamicProperty(core.TOKEN_PROPERTY));
  assert.equal(core.countItem(owner.inventory, "minecraft:ender_pearl"), 1);
  assert.equal(store.keyUsed(key), true);
  assert.equal(overworld.getBlock({...owner.location, y: owner.location.y - 1}).typeId, "minecraft:cobblestone");
  assert.equal(overworld.getBlock(grave.original).typeId, grave.blockId);
  assert.match(owner.messages.join(""), /落脚台/);
});

test("传送兜底：失败会恢复落脚台原方块，退珍珠和次数", async () => {
  const owner = fresh(); const {key} = voidGrave(owner);
  owner.inventory.setItem(1, new mc.ItemStack("minecraft:ender_pearl")); owner.teleportWorks = false;
  await menu.teleportToGrave(owner, key.getDynamicProperty(core.TOKEN_PROPERTY));
  assert.equal(core.countItem(owner.inventory, "minecraft:ender_pearl"), 1);
  assert.equal(store.keyUsed(key), false);
  assert.equal([...overworld.blocks.values()].filter(b => b.typeId === "minecraft:cobblestone").length, 0);
});

test("传送搜索：扩展区块加载覆盖32格范围且结束后释放", async () => {
  const owner = fresh(); const {grave, key} = death(owner);
  owner.inventory.setItem(1, new mc.ItemStack("minecraft:ender_pearl"));
  await menu.teleportToGrave(owner, key.getDynamicProperty(core.TOKEN_PROPERTY));
  const p = grave.original;
  assert.ok(overworld.commands.includes(`tickingarea add ${p.x-32} ${p.y} ${p.z-32} ${p.x+32} ${p.y} ${p.z+32} ls_tp_${grave.id} true`));
  assert.ok(overworld.commands.includes(`tickingarea remove ls_tp_${grave.id}`));
});
