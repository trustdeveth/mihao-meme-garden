// @ts-check
// Free planting on open soil (gametokenomics.md 6.8.1a).
import { CROP, isBuddy, BUDDY_RANGE } from '../data/crops.js';
import { SOIL_LEVELS, SPRINKLER_OCCUPANT_RADIUS, GADGETS } from '../data/tables.js';

export const GAP_FACTOR = 0.9;
export const EDGE_FACTOR = 0.5;

export const soilRect = (level) => SOIL_LEVELS[Math.max(0, Math.min(SOIL_LEVELS.length - 1, level))];

/** Inside a soil rectangle, keeping part of the plant's radius away from the edge. */
export function onSoil(level, x, z, r) {
  const s = soilRect(level);
  const m = r * EDGE_FACTOR;
  return Math.abs(x) + m <= s.w / 2 && Math.abs(z) + m <= s.d / 2;
}

/** Things on the soil that take space: plants and active placed sprinklers. */
export function occupants(state, now) {
  const list = state.plants.map((p) => ({ id: p.id, x: p.x, z: p.z, r: CROP[p.crop].radius }));
  for (const e of state.effects) {
    if (GADGETS[e.kind]?.place && e.to > now) list.push({ id: e.id, x: e.x, z: e.z, r: SPRINKLER_OCCUPANT_RADIUS });
  }
  return list;
}

/**
 * Can something of radius r be placed at (x, z)?
 * @returns {{ok:true}|{ok:false, code:'off_soil'|'locked_soil'|'too_close'|'bad_spot', blocker?:string}}
 */
export function canPlace(state, r, x, z, now, ignoreId = null) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return { ok: false, code: 'bad_spot' };
  if (!onSoil(state.soil, x, z, r)) {
    return { ok: false, code: onSoil(SOIL_LEVELS.length - 1, x, z, r) ? 'locked_soil' : 'off_soil' };
  }
  for (const o of occupants(state, now)) {
    if (o.id === ignoreId) continue;
    if (Math.hypot(o.x - x, o.z - z) < GAP_FACTOR * (o.r + r) - 1e-9) return { ok: false, code: 'too_close', blocker: o.id };
  }
  return { ok: true };
}

/** Nearest buddy plant within range, or null. */
export function findBuddy(state, plant) {
  let best = null, bestD = Infinity;
  for (const other of state.plants) {
    if (other.id === plant.id || !isBuddy(plant.crop, other.crop)) continue;
    const d = Math.hypot(other.x - plant.x, other.z - plant.z);
    if (d <= BUDDY_RANGE && d < bestD) { best = other.id; bestD = d; }
  }
  return best;
}

export const snap = (v, grid = 0.5) => Math.round(v / grid) * grid;
