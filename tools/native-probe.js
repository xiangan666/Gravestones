// Loaded only into the disposable BDS test pack, never shipped in the addon.
import {world, system, ItemStack, EnchantmentType} from "@minecraft/server";
import {ID_PROPERTY, KEY} from "./core.js";
import {container, createStorage, ensureVault, getGrave, storage, waitTicks} from "./store.js";
import {captureDeath, givePendingKeys, openGrave} from "./lifecycle.js";
import {safeLanding, canStand, planLandingPlatform} from "./landing.js";

const check = (value, message) => { if (!value) throw new Error(message); };
const out = (name, data) => console.warn(`NATIVE_${name} ${JSON.stringify(data)}`);
function playerFacade(entity, location) {
  let xp = 101;
  const equipment = new Map();
  return {
    id: entity.id, name: "Native Steve", level: 10, selectedSlotIndex: 0,
    dimension: entity.dimension, location,
    get isValid() { return entity.isValid; },
    getComponent(name) {
      if (name === "minecraft:equippable") return {getEquipment: slot => equipment.get(slot), setEquipment: (slot, item) => item ? equipment.set(slot, item) : equipment.delete(slot)};
      return entity.getComponent(name);
    },
    getTotalXp() { return xp; }, resetLevel() { xp = 0; }, addExperience(n) { xp += n; },
    getDynamicProperty: key => entity.getDynamicProperty(key),
    setDynamicProperty: (key, value) => entity.setDynamicProperty(key, value),
    sendMessage: message => out("MESSAGE", message), hasTag() { return false; }
  };
}
world.afterEvents.worldLoad.subscribe(() => system.runTimeout(async () => {
  try {
    check(ensureVault(), "vault not loaded");
    const dim = world.getDimension("overworld"), p = world.getDynamicProperty("lanshiyi:vault");
    check(!dim.getBlock(p).isAir && !dim.getBlock(p).isLiquid, "suffocation regression must run inside solid rock");
    const saved = world.getDynamicProperty("native:records");
    if (!saved) {
      const records = [];
      for (let i = 0; i < 3; i++) {
        const source = createStorage();
        const fake = playerFacade(source, {x: p.x + i * 4, y: 210, z: p.z});
        const items = container(source);
        items.setItem(0, new ItemStack("minecraft:diamond", i + 3));
        const sword = new ItemStack("minecraft:diamond_sword");
        sword.nameTag = `Heirloom ${i}`; sword.setLore(["Native saved lore"]);
        sword.setDynamicProperty("native:metadata", `keep-${i}`);
        sword.getComponent("minecraft:durability").damage = 123;
        sword.getComponent("minecraft:enchantable").addEnchantment({type: new EnchantmentType("sharpness"), level: 5});
        items.setItem(5, sword);
        fake.getComponent("minecraft:equippable").setEquipment("Head", new ItemStack("minecraft:diamond_helmet"));
        captureDeath(fake); givePendingKeys(fake);
        const key = items.getItem(0), id = key?.getDynamicProperty(ID_PROPERTY);
        check(key?.typeId === KEY && typeof id === "number", "death did not create bound key");
        const grave = getGrave(id);
        check(grave.ownerName === "Native Steve", "owner name hard-coded");
        check(container(storage(grave)).getItem(0)?.amount === i + 3, "native inventory move failed");
        check(container(storage(grave)).getItem(36)?.typeId === "minecraft:diamond_helmet", "armor transfer failed");
        records.push({id, source: source.id});
      }
      check(new Set(records.map(r => r.id)).size === 3, "duplicate grave number");
      world.setDynamicProperty("native:records", JSON.stringify(records));
      // Wait much longer than the original ~100-tick suffocation death.
      await waitTicks(400);
      for (const record of records) {
        check(storage(getGrave(record.id))?.isValid, "storage died before restart");
        check(world.getEntity(record.source)?.isValid, "source died inside bedrock");
      }
      check(dim.getEntities({type: "lanshiyi:grave_vault_anchor"}).length === 1, "vault anchor died or duplicated");
      out("PHASE1_PASS", {graves: records.map(r => r.id), ticks: 400, vaultBlock: dim.getBlock(p).typeId});
      return;
    }
    const records = JSON.parse(String(saved));
    for (const [i, record] of records.entries()) {
      const grave = getGrave(record.id), entity = storage(grave);
      check(entity?.isValid, "storage missing after actual BDS restart");
      check(container(entity).getItem(36)?.typeId === "minecraft:diamond_helmet", "armor lost after restart");
      const sword = container(entity).getItem(5);
      check(sword?.getDynamicProperty("native:metadata") === `keep-${i}`, "item dynamic property lost");
      check(sword.nameTag === `Heirloom ${i}` && sword.getLore()[0] === "Native saved lore", "item text lost");
      check(sword.getComponent("minecraft:durability").damage === 123, "durability lost");
      check(sword.getComponent("minecraft:enchantable").getEnchantment("sharpness")?.level === 5, "enchantment lost");
      const source = world.getEntity(record.source); check(source?.isValid, "source not reloaded");
      const fake = playerFacade(source, grave.current); fake.resetLevel();
      // Exercise partial claims against actual engine containers before the full claim.
      const inv = container(source);
      for (let slot = 1; slot < inv.size; slot++) inv.setItem(slot, new ItemStack("minecraft:stone", 64));
      const block = dim.getBlock(grave.current);
      await openGrave(fake, block);
      check(grave.status === "placed" && fake.getTotalXp() === 70, "partial claim/xp failed");
      check(inv.getItem(0)?.typeId === KEY && inv.getItem(0)?.getDynamicProperty(ID_PROPERTY) === grave.id, "key consumed before complete claim");
      check(container(storage(grave)).getItem(0)?.amount === i + 3, "full inventory erased remainder");
      for (let slot = 1; slot < inv.size; slot++) inv.setItem(slot);
      await openGrave(fake, block);
      check(grave.status === "opened" && fake.getTotalXp() === 70, "claim did not finish or XP duplicated");
      check(!inv.getItem(0), "ordinary key retained after complete claim");
      let diamonds = 0, helmets = 0, restoredSword;
      for (let slot = 0; slot < inv.size; slot++) {
        const item = inv.getItem(slot);
        if (item?.typeId === "minecraft:diamond") diamonds += item.amount;
        if (item?.typeId === "minecraft:diamond_helmet") helmets += item.amount;
        if (item?.typeId === "minecraft:diamond_sword") restoredSword = item;
      }
      check(diamonds === i + 3 && helmets === 1 && restoredSword?.getDynamicProperty("native:metadata") === `keep-${i}`, "wrong native items returned");
    }
    // Verify the terrain query and collision ray with actual blocks.
    const test = {x: p.x + 10, y: 220, z: p.z + 10};
    dim.getBlock({...test, y: 213}).setType("minecraft:stone");
    dim.getBlock({...test, y: 214}).setType("minecraft:short_grass");
    const landing = await safeLanding(dim, test);
    check(landing?.y === 214 && canStand(dim, landing), "downhill grass landing not recognized");
    const fallback = await planLandingPlatform(dim, {x: p.x + 4, y: 240, z: p.z + 4});
    check(fallback?.floor.length === 9, "void landing platform not planned");
    for (const block of fallback.floor) block.setType("minecraft:cobblestone");
    check(canStand(dim, fallback.location), "platform is not a native safe landing");
    out("PHASE2_PASS", {graves: records.map(r => r.id), nativeItems: true, partialClaims: true, keyConsumption: true, restart: true, grassLanding: landing, platform: fallback.location});
  } catch (error) { out("FAIL", {message: String(error), stack: error.stack}); }
}, 100));
