// Only injected into a disposable BDS test pack; never shipped in the addon.
import {world, system, ItemStack} from "@minecraft/server";
import {ID_PROPERTY, TOKEN_PROPERTY, MARKER, VAULT_ANCHOR, STORAGE, countItem} from "./core.js";
import {ensureVault, createStorage, container, nextNumber, newKey, saveGrave, getGrave, keyUsed, loadDestination, safeBlock, waitTicks, locks} from "./store.js";
import {teleportToGrave} from "./interface.js";

const check = (value, message) => { if (!value) throw new Error(message); };
const out = (name, data) => console.warn(`NATIVE_${name} ${JSON.stringify(data)}`);
function fullQuota(dim, vault) {
  check(dim.runCommand(`tickingarea add ${vault.x} ${vault.y} ${vault.z} ${vault.x} ${vault.y} ${vault.z} lanshiyi_grave_vault true`).successCount === 1, "recovery area not created");
  for (let i = 0; i < 9; i++) check(dim.runCommand(`tickingarea add ${2000 + i * 32} 80 2000 ${2000 + i * 32} 80 2000 native_other_${i} true`).successCount === 1, "quota fixture not created");
  check(dim.runCommand("tickingarea add 3000 80 3000 3000 80 3000 native_overflow true").successCount === 0, "fixture did not exhaust actual command quota");
}
function checkAndClearQuota(dim) {
  for (let i = 0; i < 9; i++) {
    check(dim.runCommand(`tickingarea preload native_other_${i} true`).successCount === 1, "an unrelated area was deleted");
    dim.runCommand(`tickingarea remove native_other_${i}`);
  }
}
function playerFacade(entity) {
  return {
    id: entity.id, selectedSlotIndex: 0, messages: [],
    get isValid() { return entity.isValid; },
    get dimension() { return entity.dimension; },
    get location() { return entity.location; },
    getComponent: name => entity.getComponent(name),
    tryTeleport(p, options) {
      // Unlike a real player, this entity cannot keep its arrival chunk loaded for assertions.
      const anchor = options.dimension.spawnEntity(VAULT_ANCHOR, p);
      this.arrivalAnchorId = anchor.id;
      return entity.tryTeleport(p, options);
    },
    sendMessage(message) { this.messages.push(message); out("MESSAGE", message); }
  };
}
world.afterEvents.worldLoad.subscribe(() => system.runTimeout(async () => {
  try {
    check(ensureVault(), "vault unavailable");
    // Let the native anchor activate before filling all command-area slots.
    await waitTicks(40);
    check(ensureVault(), "vault did not remain loaded after anchor activation");
    const overworld = world.getDimension("overworld");
    const vault = world.getDynamicProperty("lanshiyi:vault");
    const saved = world.getDynamicProperty("native:teleports");
    if (!saved) {
      fullQuota(overworld, vault);
      const records = [];
      for (const [index, dimension] of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"].entries()) {
        const original = {dimension, x: 100000 + index * 1000, y: 80, z: -100000};
        const grave = {id: nextNumber("grave_sequence"), ownerId: "native-teleport", ownerName: "Native Steve", blockId: "effect99:grave", original, current: {...original}, death: {...original}, status: "placed", everMoved: false, xp: 0, statistics: {types: 1, stacks: 1, total: 3}, storageId: createStorage().id, createdAt: Date.now()};
        const target = await loadDestination(grave, 32);
        check(target, "unloaded destination failed with recoverable full quota");
        try {
          for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 2; dy++) target.dim.getBlock({x: original.x + dx, y: original.y + dy, z: original.z + dz}).setType(dy === -1 ? "minecraft:stone" : "minecraft:air");
          target.dim.getBlock(original).setType(grave.blockId);
          const marker = target.dim.spawnEntity(MARKER, {x: original.x + 0.5, y: original.y + 1.15, z: original.z + 0.5});
          marker.setDynamicProperty(ID_PROPERTY, grave.id);
          grave.markerId = marker.id;
          container(world.getEntity(grave.storageId)).setItem(0, new ItemStack("minecraft:diamond", 3));
          saveGrave(grave);
          const source = createStorage();
          source.addTag(`native_source_${grave.id}`);
          container(source).setItem(0, newKey(grave));
          container(source).setItem(1, new ItemStack("minecraft:ender_pearl", 2));
          records.push({grave: grave.id, source: source.id});
        } finally { target.release(); }
        if (index === 0) checkAndClearQuota(overworld);
      }
      world.setDynamicProperty("native:teleports", JSON.stringify(records));
      await waitTicks(100);
      check(safeBlock(overworld, vault), "vault unloaded after removing its redundant command area");
      check(overworld.getEntities({type: "lanshiyi:grave_vault_anchor"}).length === 1, "native anchor lost or duplicated");
      out("PHASE1_PASS", {quotaRecovery: true, unrelatedAreasPreserved: true, records});
      return;
    }
    const records = JSON.parse(String(saved));
    fullQuota(overworld, vault);
    for (const record of records) {
      const grave = getGrave(record.grave);
      check(!safeBlock(world.getDimension(grave.original.dimension), grave.original), "destination was already loaded after restart");
      let source = world.getEntity(record.source);
      check(source?.isValid, "source inventory missing after restart");
      const player = playerFacade(source), key = container(source).getItem(0);
      grave.markerId = "invalid-native-id";
      if (grave.original.dimension === "minecraft:nether") {
        check(overworld.runCommand("tickingarea add 4000 80 4000 4000 80 4000 native_other_9 true").successCount === 1, "final quota slot not filled");
        await teleportToGrave(player, key.getDynamicProperty(TOKEN_PROPERTY));
        check(!keyUsed(key) && countItem(container(source), "minecraft:ender_pearl") === 2, "failed teleport charged a fee");
        check(grave.status === "placed" && !grave.everMoved && !locks.has(grave.id), "failed teleport changed grave or leaked its lock");
        check(player.messages.at(-1).includes("目标区块尚未加载"), "quota failure not reported");
        for (let i = 0; i < 10; i++) check(overworld.runCommand(`tickingarea preload native_other_${i} true`).successCount === 1, "quota failure deleted another area");
        overworld.runCommand("tickingarea remove native_other_9");
        await waitTicks(2);
        out("QUOTA_FAILURE_PASS", {noCharge: true, unrelatedAreasPreserved: true});
      }
      await teleportToGrave(player, key.getDynamicProperty(TOKEN_PROPERTY));
      for (let attempt = 0; attempt < 40; attempt++) {
        // Resolve by fixture tag rather than relying on the pre-transfer wrapper.
        source = world.getDimension(grave.original.dimension).getEntities({type: STORAGE, tags: [`native_source_${grave.id}`]})[0];
        if (source?.isValid) break;
        await waitTicks(2);
      }
      if (!source?.isValid) out("ARRIVAL_DEBUG", {id: record.source, target: grave.original.dimension, entities: world.getDimension(grave.original.dimension).getEntities().map(e => ({id: e.id, type: e.typeId, location: e.location, tags: e.getTags()}))});
      check(source?.isValid, "teleported source not available");
      check(keyUsed(key), "teleport did not spend key token");
      check(countItem(container(source), "minecraft:ender_pearl") === 1, "pearl not charged exactly once");
      check(source.dimension.id === grave.original.dimension && Math.hypot(source.location.x - grave.original.x, source.location.z - grave.original.z) <= 33, "native entity did not arrive near grave");
      check(container(world.getEntity(grave.storageId)).getItem(0)?.amount === 3, "grave inventory was changed");
      check(!locks.has(grave.id), "grave lock leaked");
      const arrival = {grave: grave.id, dimension: source.dimension.id, location: source.location};
      await waitTicks(2);
      check(world.getDimension(grave.original.dimension).runCommand(`tickingarea preload ls_tp_${grave.id} true`).successCount === 0, "temporary area leaked");
      world.getEntity(player.arrivalAnchorId)?.remove();
      out("TELEPORT_PASS", arrival);
    }
    checkAndClearQuota(overworld);
    check(safeBlock(overworld, vault), "vault lost after teleports");
    out("PHASE2_PASS", {restart: true, unloadedTargets: true, allThreeDimensions: true, crossDimension: true, quotaRecovery: true, quotaFailureNoCharge: true, nativeEntityTeleport: true, inventoryPreserved: true});
  } catch (error) { out("FAIL", {message: String(error), stack: error.stack}); }
}, 100));
