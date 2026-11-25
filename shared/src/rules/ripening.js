// @ts-check
// Ripening (gametokenomics.md 6.1, 6.8.3, 6.8.4): each crop gets exactly two weather rolls per cycle,
// decided when it ripens (the window it ripens in and the one before). Ripe crops never roll again.
// Fruit outcomes use a keyed RNG (secret, player, plant, cycle), so they are the same whenever resolved.
import { CROP } from '../data/crops.js';
import { WEATHER_BY_ID, VARIANTS, BIG, MASS, RIPENESS } from '../data/tables.js';
import { weatherAt, windowIndex, strikeTimes, windowStart } from './weather.js';

/** Weather kinds used for the two ripening rolls: [previous window, ripening window]. */
export function ripeningWindows(state, plant, seed) {
  const w = windowIndex(plant.readyAt);
  const prev = weatherAt(seed, w - 1);
  let cur = weatherAt(seed, w);
  const jar = (state.effects ?? []).some((e) => e.kind === 'rainJar' && plant.readyAt >= e.from && plant.readyAt < e.to);
  if (jar) cur = 'rain';
  return [prev, cur];
}

export function rollVariant(r) {
  let x = r;
  for (const v of VARIANTS) { x -= v.p; if (x < 0) return v.id; }
  return 'normal';
}

/**
 * Resolve a ripe plant's fruit. Idempotent.
 * @param {*} state @param {*} plant
 * @param {{now:number, seed:number, rng:(...parts:any[])=>()=>number}} ctx
 * @returns {boolean} true if fruit was created now
 */
export function resolveRipening(state, plant, ctx) {
  if (plant.fruit || ctx.now < plant.readyAt) return false;
  const crop = CROP[plant.crop];
  const rng = ctx.rng('fruit', plant.id, plant.cycle);
  const env = [...(plant.env ?? [])];
  for (const kind of ripeningWindows(state, plant, ctx.seed)) {
    const roll = WEATHER_BY_ID[kind].roll;
    const r = rng(); // always consume one number per window, so outcomes stay stable
    if (roll && r < roll.chance && !env.includes(roll.env)) env.push(roll.env);
  }
  if (env.includes('wet') && env.includes('chilled')) {
    env.splice(env.indexOf('wet'), 1);
    env.splice(env.indexOf('chilled'), 1);
    env.push('slushy');
  }
  plant.fruit = [];
  for (let i = 0; i < crop.fruits; i++) {
    let mass = MASS.min + rng() * (MASS.max - MASS.min);
    const big = rng() < BIG.p;
    if (big) mass *= BIG.mass;
    plant.fruit.push({ mass: Math.round(mass * 100) / 100, big, variant: rollVariant(rng()), env: [...env] });
  }
  return true;
}

/** Ripeness stage length (ms): max(20 s, 50% of the cycle's base time). */
export function stageMs(plant) {
  const crop = CROP[plant.crop];
  const secs = plant.cycle > 0 && crop.regrow ? crop.regrow : crop.grow;
  return Math.max(20, secs * 0.5) * 1000;
}

/** Ripeness index 0..2 (Fresh, Juicy, Peak) at time t. */
export function ripenessAt(plant, t) {
  if (t < plant.readyAt) return -1;
  return Math.min(2, Math.floor((t - plant.readyAt) / stageMs(plant)));
}
export const ripenessMult = (i) => (i < 0 ? 1 : RIPENESS[i].m);

/**
 * Apply thunderstorm / shooting-star strikes between (from, to]. Each strike hits one growing plant.
 * @returns {number} strikes that hit
 */
export function applyStrikes(state, from, to, ctx) {
  let hits = 0;
  for (let w = windowIndex(from); w <= windowIndex(to); w++) {
    const offsets = strikeTimes(ctx.seed, w);
    if (!offsets.length) continue;
    const env = WEATHER_BY_ID[weatherAt(ctx.seed, w)].strikes.env;
    offsets.forEach((off, i) => {
      const t = windowStart(w) + off;
      if (t <= from || t > to) return;
      const growing = state.plants.filter((p) => !p.fruit && p.cycleStart <= t && p.readyAt > t);
      if (!growing.length) return;
      const target = growing[Math.floor(ctx.rng('strike', w, i)() * growing.length)];
      target.env = target.env ?? [];
      if (!target.env.includes(env)) target.env.push(env);
      hits++;
    });
  }
  return hits;
}
