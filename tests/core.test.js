import test from "node:test";
import assert from "node:assert/strict";
import {refundXp, teleportReason, statistics, finderFrame, lore, graveLabel, consumeItem, countItem, positionText} from "../Grave_B/scripts/core.js";

const original = {dimension: "minecraft:overworld", x: -21, y: 64, z: 15};
const grave = {id: 1, ownerName: "lanshiyi", xp: 101, statistics: {types: 2, stacks: 3, total: 129}, original, death: {...original, y: -70}, current: {...original}, status: "placed", everMoved: false};
test("返还总经验点数，比例准确且向下取整", () => {
  for (let xp = 0; xp <= 10000; xp++) {
    assert.equal(refundXp(xp, true), Math.floor(xp * 7 / 10));
    assert.equal(refundXp(xp, false), Math.floor(xp / 2));
  }
  assert.equal(refundXp(-1, true), 0);
});
test("传送只依赖持久化状态，不需要区块已加载", () => assert.equal(teleportReason(grave, false), ""));
test("钥匙只有一次传送次数", () => assert.match(teleportReason(grave, true), /用完/));
test("挖起、掉落、携带、开过的墓碑均不能传送", () => {
  for (const status of ["dropped", "carried", "opened"]) assert.notEqual(teleportReason({...grave, status}, false), "");
});
test("重新放回原坐标也不能恢复传送资格", () => assert.match(teleportReason({...grave, everMoved: true}, false), /重新放置/));
test("跨维度或偏离原坐标禁止传送", () => {
  for (const current of [{...original, dimension: "minecraft:nether"}, {...original, x: 0}]) assert.notEqual(teleportReason({...grave, current}, false), "");
});
test("缺失记录明确提示且不应扣费", () => assert.match(teleportReason(undefined, false), /未扣除/));
test("物品种类按物品ID统计，堆数和总数量独立", () => assert.deepEqual(statistics([{typeId: "a", amount: 64}, undefined, {typeId: "a", amount: 64}, {typeId: "b", amount: 1}]), {types: 2, stacks: 3, total: 129}));
test("名称、说明包含编号、所有者、原始与死亡位置、经验和数量", () => {
  assert.equal(graveLabel(grave), "#1 lanshiyi的墓碑");
  const text = lore(grave).join("\n");
  for (const expected of ["#1", "lanshiyi", "主世界", "-21, 64, 15", "-21, -70, 15", "101", "129", "物品种类", "堆数"]) assert.ok(text.includes(expected));
});
test("寻墓器针尖相对于视角旋转", () => {
  assert.equal(finderFrame({x: 0, z: 0}, {x: 0, z: 10}, 0), 0);
  assert.equal(finderFrame({x: 0, z: 0}, {x: -10, z: 0}, 0), 4);
  assert.equal(finderFrame({x: 0, z: 0}, {x: 0, z: -10}, 0), 8);
  assert.equal(finderFrame({x: 0, z: 0}, {x: 10, z: 0}, 0), 12);
  assert.equal(finderFrame({x: 0, z: 0}, {x: -10, z: 0}, 90), 0);
});
test("材料不足不做部分扣除；20颗珍珠跨堆扣除", () => {
  const slots = [{typeId: "pearl", amount: 16}, {typeId: "pearl", amount: 8}, {typeId: "stone", amount: 64}];
  const inv = {size: 3, getItem(i) { return slots[i] ? {...slots[i]} : undefined; }, setItem(i, value) { slots[i] = value; }};
  assert.equal(consumeItem(inv, "pearl", 25), false);
  assert.equal(countItem(inv, "pearl"), 24);
  assert.equal(consumeItem(inv, "pearl", 20), true);
  assert.equal(countItem(inv, "pearl"), 4);
  assert.equal(slots[2].amount, 64);
});
test("坐标显示中文维度和负坐标", () => assert.equal(positionText({...original, dimension: "minecraft:the_end"}), "末地 -21, 64, 15"));
