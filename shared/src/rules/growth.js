// @ts-check
// Growth integration. A plant needs `work` milliseconds of base growth. Growth speed at any moment is
// weather growth x best sprinkler of each kind x buddy bonus. Because weather and gadget effects are
// known time intervals, the exact ready time can be computed ahead: no per-tick timers, exact offline growth.
import { CROP, BUDDY_BONUS } from '../data/crops.js';
import { WEATHER_BY_ID, WATER_FACTOR, COPPER_WATER_FACTOR, GADGETS } from '../data/tables.js';
import { weatherAt, windowIndex, windowStart } from './weather.js';

const MAX_SOLVE_MS = 7 * 86_400_000;

/** Base work (ms) for a plant's current cycle, including watering. */
export function cycleWork(plant) {
  const crop = CROP[plant.crop];
  const secs = plant.cycle > 0 && crop.regrow ? crop.regrow : crop.grow;
  const water = plant.watered ? (plant.copper ? COPPER_WATER_FACTOR : WATER_FACTOR) : 1;
  return secs * 1000 * water;
}

/** Garden effects covering a plant at time t (sprinklers and rain jar). */
function effectMult(garden, plant, t, seed) {
  let weather = WEATHER_BY_ID[weatherAt(seed, windowIndex(t))].growth;
  const best = {};
  for (const e of garden.effects ?? []) {
    if (t < e.from || t >= e.to) continue;
    if (e.kind === 'rainJar') { weather = Math.max(weather, WEATHER_BY_ID.rain.growth); continue; }
    const g = GADGETS[e.kind];
    if (!g || g.kind !== 'sprinkler') continue;
    if (Math.hypot(plant.x - e.x, plant.z - e.z) > g.radius) continue;
    best[e.kind] = Math.max(best[e.kind] ?? 1, g.mult);
  }
  let m = weather;
  for (const v of Object.values(best)) m *= v;
  if (plant.buddy) m *= BUDDY_BONUS;
  return m;
}

/** Next time after t where the growth rate may change. */
function nextBoundary(garden, t) {
  let next = windowStart(windowIndex(t) + 1);
  for (const e of garden.effects ?? []) {
    if (e.from > t && e.from < next) next = e.from;
    if (e.to > t && e.to < next) next = e.to;
  }
  return next;
}

/**
 * Integrate growth from (fromT, fromDone). Stops at `until` or when `target` work is reached.
 * @returns {{t:number, done:number}}
 */
export function integrate(garden, plant, seed, fromT, fromDone, until, target = Infinity) {
  let t = fromT, done = fromDone;
  while (t < until && done < target) {
    const nb = Math.min(nextBoundary(garden, t), until);
    const rate = effectMult(garden, plant, t, seed);
    const gain = rate * (nb - t);
    if (done + gain >= target) return { t: t + (target - done) / rate, done: target };
    done += gain;
    t = nb;
  }
  return { t, done: Math.min(done, target) };
}

/** Bring the plant's checkpoint forward to `now` using the modifiers in force until now. */
export function advance(garden, plant, now, seed) {
  if (now <= plant.ck.at) return;
  const r = integrate(garden, plant, seed, plant.ck.at, plant.ck.done, now, plant.work);
  plant.ck = { at: now, done: r.done };
}

/** Recompute the exact ready time from the current checkpoint. */
export function solveReadyAt(garden, plant, seed) {
  if (plant.ck.done >= plant.work) return plant.ck.at;
  const r = integrate(garden, plant, seed, plant.ck.at, plant.ck.done, plant.ck.at + MAX_SOLVE_MS, plant.work);
  return r.done >= plant.work ? Math.round(r.t) : plant.ck.at + MAX_SOLVE_MS;
}

/** Call before changing anything that affects growth; then call refresh() after the change. */
export function checkpoint(garden, plant, now, seed) {
  if (plant.fruit) return; // ripe plants do not grow
  advance(garden, plant, now, seed);
}

export function refresh(garden, plant, seed) {
  if (plant.fruit) return;
  plant.work = cycleWork(plant);
  plant.readyAt = solveReadyAt(garden, plant, seed);
}

/** Growth progress 0..1 at time t (for display and Grow All quotes). */
export function progressAt(garden, plant, t, seed) {
  if (plant.fruit || t >= plant.readyAt) return 1;
  if (t <= plant.ck.at) return Math.min(1, plant.ck.done / plant.work);
  const r = integrate(garden, plant, seed, plant.ck.at, plant.ck.done, t, plant.work);
  return Math.min(1, r.done / plant.work);
}

/** Growth stage 0..4 for the 3D model (seed mound, sprout, young, mature, fruiting). */
export const stageOf = (progress) => (progress >= 1 ? 4 : Math.min(3, Math.floor(progress * 4)));
