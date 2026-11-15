// Entry point; implementation is split into lifecycle, persistence, interface and tracking modules.
import {world, system} from "@minecraft/server";
import {GRAVE_IDS, GRAVE_ITEM, KEY, MARKER, ID_PROPERTY, isBoundTool} from "./core.js";
import {guard, initialize, safeBlock, container, loadedDimensions, log, ensureVault} from "./store.js";
import {captureDeath, givePendingKeys, mineGrave, placeGrave, openGrave, convertVanillaDrop, rebuildLookup, migrateLegacy} from "./lifecycle.js";
import {showToolMenu, recoverKey} from "./interface.js";
import {tickPlayers, tickWorld, watchContainer, restoreWatches, bindLegacyKey} from "./tracking.js";

const defer = fn => system.run(guard(fn));
system.beforeEvents.startup.subscribe(event => {
  event.itemComponentRegistry.registerCustomComponent("lanshiyi:use", {
    onUse: event => { if (event.source.typeId === "minecraft:player" && isBoundTool(event.itemStack)) defer(() => showToolMenu(event.source)); }
  });
});
world.afterEvents.worldLoad.subscribe(guard(() => {
  // Required to transfer complete ItemStacks at death without vanilla double drops.
  world.gameRules.keepInventory = true;
  initialize();
  rebuildLookup();
  restoreWatches();
  log("已启用简体中文二改版。作者 lanshiyi，联系 3199912548@qq.com。死亡物品由墓碑接管；keepInventory 已开启。 ");
}));
world.afterEvents.entityDie.subscribe(guard(event => {
  if (event.deadEntity.typeId === "minecraft:player") captureDeath(event.deadEntity);
}));
world.afterEvents.playerSpawn.subscribe(event => {
  system.runTimeout(guard(() => givePendingKeys(event.player)), 20);
});
world.beforeEvents.itemUse.subscribe(event => {
  if (!isBoundTool(event.itemStack)) return;
  event.cancel = true;
  defer(() => showToolMenu(event.source));
});
world.beforeEvents.playerInteractWithBlock.subscribe(event => {
  const {player, block, blockFace} = event;
  const type = event.itemStack?.typeId;
  if (type === GRAVE_ITEM) {
    event.cancel = true;
    if (event.isFirstEvent) {
      const location = {...block.location};
      const dim = block.dimension;
      defer(() => { const live = safeBlock(dim, location); if (live) placeGrave(player, live, blockFace); });
    }
    return;
  }
  if (GRAVE_IDS.includes(block.typeId)) {
    event.cancel = true;
    if (!event.isFirstEvent) return;
    const location = {...block.location};
    const dim = block.dimension;
    defer(() => {
      const live = safeBlock(dim, location);
      if (!live || !GRAVE_IDS.includes(live.typeId)) return;
      if (type === "minecraft:ender_pearl") recoverKey(player, live);
      else { bindLegacyKey(player, live); return openGrave(player, live); }
    });
  } else if (type === KEY || isBoundTool(event.itemStack)) {
    event.cancel = true;
    if (event.isFirstEvent) defer(() => showToolMenu(player));
  } else if (event.isFirstEvent) {
    const location = {...block.location};
    const dim = block.dimension;
    defer(() => watchContainer(safeBlock(dim, location)));
  }
});
world.beforeEvents.playerBreakBlock.subscribe(event => {
  if (!GRAVE_IDS.includes(event.block.typeId)) return;
  // Suppress vanilla drops (and creative destruction); produce exactly one protected drop.
  event.cancel = true;
  const location = {...event.block.location};
  const dim = event.block.dimension;
  defer(() => { const block = safeBlock(dim, location); if (block && GRAVE_IDS.includes(block.typeId)) mineGrave(event.player, block); });
});
world.beforeEvents.explosion.subscribe(event => {
  event.setImpactedBlocks(event.getImpactedBlocks().filter(block => !GRAVE_IDS.includes(block.typeId)));
  // Protect the brief vanilla-item-to-persistent-entity handover window as well.
  const dim = event.dimension;
  if (dim.getEntities({type: "minecraft:item"}).some(entity => entity.getComponent("minecraft:item")?.itemStack.typeId === GRAVE_ITEM)) event.cancel = true;
});
world.afterEvents.entitySpawn.subscribe(event => {
  if (event.entity.typeId === "minecraft:item") guard(() => convertVanillaDrop(event.entity))();
});
world.afterEvents.entityLoad.subscribe(event => {
  if (event.entity.typeId === MARKER) defer(() => migrateLegacy(event.entity));
  if (event.entity.typeId === "minecraft:item") defer(() => convertVanillaDrop(event.entity));
});
// Five ticks keeps moving targets responsive; heavy entity/container discovery runs once a second.
system.runInterval(guard(tickPlayers), 5);
system.runInterval(guard(tickWorld), 20);
system.runInterval(guard(() => {
  ensureVault();
  if (!world.gameRules.keepInventory) { world.gameRules.keepInventory = true; log("keepInventory 被其他来源关闭，已恢复以避免重复掉落。 "); }
  for (const player of world.getAllPlayers()) givePendingKeys(player);
}), 100);
