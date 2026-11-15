export const EquipmentSlot = {Head: "Head", Chest: "Chest", Legs: "Legs", Feet: "Feet", Offhand: "Offhand"};
export class ItemStack {
  constructor(typeId, amount = 1) { this.typeId = typeId; this.amount = amount; this.properties = new Map(); this.lines = []; this.keepOnDeath = false; this.maxAmount = typeId === "minecraft:ender_pearl" ? 16 : (typeId === "effect99:key" || typeId.startsWith("lanshiyi:") ? 1 : 64); }
  clone() { const result = new ItemStack(this.typeId, this.amount); Object.assign(result, structuredClone(this)); return result; }
  setDynamicProperty(k, v) { v === undefined ? this.properties.delete(k) : this.properties.set(k, v); }
  getDynamicProperty(k) { return this.properties.get(k); }
  getDynamicPropertyIds() { return [...this.properties.keys()]; }
  setLore(lines) { this.lines = [...lines]; }
  getLore() { return [...this.lines]; }
}
export class Container {
  constructor(size = 36) { this.size = size; this.slots = Array(size); }
  get emptySlotsCount() { return this.slots.filter(Boolean).length === this.size ? 0 : this.size - this.slots.filter(Boolean).length; }
  getItem(i) { return this.slots[i]?.clone(); }
  setItem(i, value) { this.slots[i] = value?.clone(); }
  moveItem(from, to, target) { target.setItem(to, this.getItem(from)); this.setItem(from); }
  addItem(value) {
    const item = value.clone();
    if (item.maxAmount > 1) for (let i = 0; i < this.size; i++) {
      const current = this.slots[i];
      if (current?.typeId !== item.typeId || current.amount >= current.maxAmount) continue;
      const n = Math.min(current.maxAmount - current.amount, item.amount);
      current.amount += n; item.amount -= n;
      if (!item.amount) return undefined;
    }
    for (let i = 0; i < this.size; i++) {
      if (this.slots[i]) continue;
      const n = Math.min(item.maxAmount, item.amount);
      const copy = item.clone(); copy.amount = n; this.slots[i] = copy; item.amount -= n;
      if (!item.amount) return undefined;
    }
    return item;
  }
}
let sequence = 0;
export const entities = new Map();
const eventSignals = () => new Proxy({}, {get(target, name) { return target[name] ??= {callbacks: [], subscribe(fn) { this.callbacks.push(fn); return fn; }}; }});
export const system = {currentTick: 0, beforeEvents: eventSignals(), run(fn) { queueMicrotask(fn); return 1; }, runTimeout(fn, ticks = 1) { queueMicrotask(() => { this.currentTick += ticks; fn(); }); return 1; }, runInterval() { return 1; }};
export class Entity {
  constructor(typeId, dim, location, size = 42) { this.id = `entity${++sequence}`; this.typeId = typeId; this.dimension = dim; this.location = {...location}; this.isValid = true; this.nameTag = ""; this.properties = new Map(); this.inventory = new Container(typeId === "lanshiyi:grave_drop" ? 1 : size); this.tags = []; entities.set(this.id, this); }
  getComponent(name) { if (name === "minecraft:inventory") return {container: this.inventory}; if (name === "minecraft:item") return this.item ? {itemStack: this.item.clone()} : undefined; }
  getDynamicProperty(k) { return this.properties.get(k); }
  setDynamicProperty(k, v) { v === undefined ? this.properties.delete(k) : this.properties.set(k, v); }
  getTags() { return [...this.tags]; }
  addTag(tag) { if (!this.tags.includes(tag)) this.tags.push(tag); return true; }
  remove() { this.isValid = false; entities.delete(this.id); }
  teleport(p, options) { this.location = {...p}; if (options?.dimension) this.dimension = options.dimension; }
  clearVelocity() { this.velocityCleared = true; }
}
export class Player extends Entity {
  constructor(name, dim, location = {x: 0, y: 64, z: 0}) { super("minecraft:player", dim, location, 36); this.name = name; this.nameTag = name; this.level = 10; this.xp = 101; this.selectedSlotIndex = 0; this.equipment = new Map(); this.messages = []; this.yaw = 0; this.teleportWorks = true; this.onScreenDisplay = {setActionBar: text => { this.actionBar = text; }}; }
  getComponent(name) { if (name === "minecraft:equippable") return {getEquipment: slot => this.equipment.get(slot)?.clone(), setEquipment: (slot, item) => { if (item) this.equipment.set(slot, item.clone()); else this.equipment.delete(slot); return true; }}; return super.getComponent(name); }
  getTotalXp() { return this.xp; }
  resetLevel() { this.xp = 0; this.level = 0; }
  addExperience(amount) { this.xp += amount; return this.xp; }
  sendMessage(text) { this.messages.push(text); }
  getGameMode() { return "Survival"; }
  getRotation() { return {x: 0, y: this.yaw}; }
  hasTag(tag) { return this.tags.includes(tag); }
  tryTeleport(p, options) { if (!this.teleportWorks) return false; this.teleport(p, options); return true; }
}
export class Block {
  constructor(dim, location, typeId) { this.dimension = dim; Object.assign(this, location); this.location = {...location}; this.typeId = typeId; this.inventory = undefined; }
  get isAir() { return this.typeId === "minecraft:air"; }
  get isLiquid() { return /^(minecraft:)(flowing_)?(water|lava)$/.test(this.typeId); }
  get permutation() { return {typeId: this.typeId}; }
  setPermutation(p) { this.typeId = p.typeId; }
  setType(typeId) { this.typeId = typeId; }
  getComponent(name) { return name === "minecraft:inventory" && this.inventory ? {container: this.inventory} : undefined; }
}
export class Dimension {
  constructor(id) { this.id = id; this.heightRange = {min: -64, max: 320}; this.blocks = new Map(); this.unloaded = false; this.loadWorks = true; this.commands = []; this.areas = new Map(); this.areaLimit = 10; this.loadDelay = 0; }
  getBlock(loc) {
    if (this.unloaded) {
      const native = [...entities.values()].some(e => e.isValid && e.dimension === this && e.typeId === "lanshiyi:grave_vault_anchor" && Math.abs(e.location.x - loc.x) < 32 && Math.abs(e.location.z - loc.z) < 32);
      const loaded = this.loadWorks && [...this.areas.values()].some(a => a.readyAt <= system.currentTick && Math.floor(loc.x / 16) >= a.minX && Math.floor(loc.x / 16) <= a.maxX && Math.floor(loc.z / 16) >= a.minZ && Math.floor(loc.z / 16) <= a.maxZ);
      if (!native && !loaded) return undefined;
    }
    const p = {x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z)};
    const key = `${p.x},${p.y},${p.z}`;
    if (!this.blocks.has(key)) this.blocks.set(key, new Block(this, p, this.terrain ? this.terrain(p) : p.y < 64 ? "minecraft:stone" : "minecraft:air"));
    return this.blocks.get(key);
  }
  spawnEntity(type, loc) { return new Entity(type, this, loc); }
  getBlockFromRay(loc, direction, options) {
    const block = this.getBlock({x: loc.x, y: Math.floor(loc.y) - 1, z: loc.z});
    if (block?.collidable !== false && (["minecraft:stone", "minecraft:cobblestone", "minecraft:dirt", "minecraft:grass_block"].includes(block?.typeId) || block?.typeId.startsWith("effect99:"))) return {block, face: "Up", faceLocation: {x: 0.5, y: 1, z: 0.5}};
    return undefined;
  }
  spawnItem(item, loc) { const entity = new Entity("minecraft:item", this, loc); entity.item = item.clone(); return entity; }
  getEntities(options = {}) { return [...entities.values()].filter(e => e.isValid && (e.loadAt ?? 0) <= system.currentTick && e.dimension === this && (!options.type || e.typeId === options.type) && (!options.location || Math.hypot(e.location.x - options.location.x, e.location.y - options.location.y, e.location.z - options.location.z) <= (options.maxDistance ?? Infinity))); }
  getPlayers(options = {}) { return this.getEntities({...options, type: "minecraft:player"}); }
  runCommand(cmd) {
    this.commands.push(cmd);
    if (this.failCommands) throw new Error("command unavailable");
    for (const [name, area] of this.areas) if (area.removeAt <= system.currentTick) this.areas.delete(name);
    const args = cmd.split(" ");
    if (args[0] === "tickingarea") {
      if (args[1] === "remove") {
        const area = this.areas.get(args[2]);
        if (!area) return {successCount: 0};
        if (this.deferAreaRemoval) area.removeAt = system.currentTick + 1;
        else this.areas.delete(args[2]);
        return {successCount: 1};
      }
      if (args[1] === "preload") return {successCount: this.areas.has(args[2]) ? 1 : 0};
      if (args[1] === "add") {
        const name = args[8];
        if (this.areas.has(name) || this.areas.size >= this.areaLimit) return {successCount: 0};
        this.areas.set(name, {minX: Math.floor(Number(args[2]) / 16), maxX: Math.floor(Number(args[5]) / 16), minZ: Math.floor(Number(args[4]) / 16), maxZ: Math.floor(Number(args[7]) / 16), readyAt: system.currentTick + this.loadDelay});
      }
    }
    return {successCount: 1};
  }
}
export const dims = new Map(["minecraft:overworld", "minecraft:nether", "minecraft:the_end"].map(id => [id, new Dimension(id)]));
export const world = {properties: new Map(), beforeEvents: eventSignals(), afterEvents: eventSignals(), gameRules: {keepInventory: true}, getDynamicProperty(k) { return this.properties.get(k); }, setDynamicProperty(k, v) { v === undefined ? this.properties.delete(k) : this.properties.set(k, v); }, getDynamicPropertyIds() { return [...this.properties.keys()]; }, getDimension(id) { return dims.get(id.includes(":") ? id : `minecraft:${id}`); }, getEntity(id) { if (id === "invalid-native-id") throw new Error("InvalidEntityError"); const entity = entities.get(id); return entity && (entity.loadAt ?? 0) <= system.currentTick ? entity : undefined; }, getAllPlayers() { return [...entities.values()].filter(e => e.isValid && e.typeId === "minecraft:player"); }, getDefaultSpawnLocation() { return {x: 0, y: 64, z: 0}; }};
