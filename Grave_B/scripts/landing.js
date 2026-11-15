import {safeBlock, waitTicks} from "./store.js";

export const LANDING_RADIUS = 32;
const danger = /lava|fire|magma|cactus|campfire|portal|powder_snow|berry_bush|wither_rose/;
const plants = new Set(["minecraft:short_grass", "minecraft:tall_grass", "minecraft:fern", "minecraft:large_fern", "minecraft:deadbush", "minecraft:dandelion", "minecraft:poppy", "minecraft:blue_orchid", "minecraft:allium", "minecraft:azure_bluet", "minecraft:oxeye_daisy", "minecraft:cornflower", "minecraft:lily_of_the_valley", "minecraft:torchflower", "minecraft:sunflower", "minecraft:lilac", "minecraft:rose_bush", "minecraft:peony", "minecraft:red_tulip", "minecraft:orange_tulip", "minecraft:white_tulip", "minecraft:pink_tulip", "minecraft:pink_petals", "minecraft:vine"]);
const clear = block => !!block && (block.isAir || plants.has(block.typeId));
const replaceableFloor = block => !!block && (block.isAir || ["minecraft:water", "minecraft:flowing_water", "minecraft:lava", "minecraft:flowing_lava"].includes(block.typeId));

function* columns(target, maxRadius, minRadius = 0) {
  for (let radius = minRadius; radius <= maxRadius; radius++) {
    for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
      if (radius && Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;
      yield {x: Math.floor(target.x) + dx, z: Math.floor(target.z) + dz};
    }
  }
}
function* heights(y, distance, min, max, skip = -1) {
  for (let dy = 0; dy <= distance; dy++) {
    if (dy <= skip) continue;
    if (y + dy >= min && y + dy <= max) yield y + dy;
    if (dy && y - dy >= min && y - dy <= max) yield y - dy;
  }
}
/** @param {import('@minecraft/server').Dimension} dim @param {import('@minecraft/server').Vector3} p */
export function canStand(dim, p) {
  if (!clear(safeBlock(dim, p)) || !clear(safeBlock(dim, {...p, y: p.y + 1}))) return false;
  const cell = {x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z)};
  const ground = safeBlock(dim, {...cell, y: cell.y - 1});
  if (!ground || ground.isAir || ground.isLiquid || danger.test(ground.typeId)) return false;
  try {
    // Block.isSolid is NOT part of stable API 2.0. Use the native collision ray.
    const hit = dim.getBlockFromRay({x: cell.x + 0.5, y: cell.y + 0.05, z: cell.z + 0.5}, {x: 0, y: -1, z: 0}, {maxDistance: 1.1, includeLiquidBlocks: false, includePassableBlocks: false});
    return hit?.block.y === cell.y - 1;
  } catch { return false; }
}

/** Prefer nearby terrain, including downhill positions and non-colliding grass. */
export async function safeLanding(dim, target) {
  const y = Math.floor(target.y), min = dim.heightRange.min + 1, max = dim.heightRange.max - 2;
  let checked = 0;
  for (const phase of [0, 1]) {
    for (const column of columns(target, phase ? LANDING_RADIUS : 8)) {
      const radius = Math.max(Math.abs(column.x - target.x), Math.abs(column.z - target.z));
      for (const height of heights(y, phase ? 32 : 8, min, max, phase && radius <= 8 ? 8 : -1)) {
        const p = {...column, y: height};
        if (canStand(dim, p)) return {x: p.x + 0.5, y: p.y, z: p.z + 0.5};
      }
      // Native block queries are spread across ticks to avoid the script watchdog.
      if (++checked % 32 === 0) await waitTicks(1);
    }
  }
  return undefined;
}

/** A void/ocean fallback only replaces air or liquid, never existing solid terrain. */
export async function planLandingPlatform(dim, target) {
  const min = Math.max(dim.heightRange.min + 2, Math.floor(target.y));
  const max = dim.heightRange.max - 2;
  let checked = 0;
  // Search upwards near the grave; the central column is tried first.
  for (let y = min; y <= max; y++) {
    for (const c of columns(target, 2)) {
      const floor = [];
      let fits = true;
      for (let dx = -1; dx <= 1 && fits; dx++) for (let dz = -1; dz <= 1; dz++) {
        const p = {x: c.x + dx, y, z: c.z + dz};
        const block = safeBlock(dim, {...p, y: y - 1});
        if (!replaceableFloor(block) || !clear(safeBlock(dim, p)) || !clear(safeBlock(dim, {...p, y: y + 1}))) { fits = false; break; }
        floor.push(block);
      }
      if (fits) return {location: {x: c.x + 0.5, y, z: c.z + 0.5}, floor};
      if (++checked % 64 === 0) await waitTicks(1);
    }
  }
  return undefined;
}
