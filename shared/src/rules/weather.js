// @ts-check
// Deterministic world weather: everyone in every room sees the same sky for a given world seed.
// Windows last 4 minutes. After a non-sunny window there is a 50% chance the next one is forced Sunny.
// The chain restarts at each UTC day so any window can be computed quickly (memoized per day).
import { WEATHER, WEATHER_BY_ID, WINDOW_MS, WORLD_EPOCH } from '../data/tables.js';
import { hash32, unit, weighted } from '../util/rng.js';

const PER_DAY = 86_400_000 / WINDOW_MS; // 360 windows per day
const WEIGHTS = WEATHER.map((w) => [w.id, w.weight]);

export const windowIndex = (t) => Math.floor((t - WORLD_EPOCH) / WINDOW_MS);
export const windowStart = (w) => WORLD_EPOCH + w * WINDOW_MS;

const memo = new Map(); // `${seed}:${day}` -> string[]
function dayChain(seed, day) {
  const key = `${seed}:${day}`;
  let chain = memo.get(key);
  if (chain) return chain;
  chain = [];
  for (let i = 0; i < PER_DAY; i++) {
    const w = day * PER_DAY + i;
    let kind = weighted(unit(seed, 'wx', w), WEIGHTS);
    if (i > 0 && chain[i - 1] !== 'sunny' && unit(seed, 'sun', w) < 0.5) kind = 'sunny';
    chain.push(kind);
  }
  if (memo.size > 64) memo.delete(memo.keys().next().value);
  memo.set(key, chain);
  return chain;
}

/** Weather id for window w. */
export function weatherAt(seed, w) {
  const day = Math.floor(w / PER_DAY);
  return dayChain(seed, day)[w - day * PER_DAY];
}

/** Weather definition at time t. */
export const weatherAtTime = (seed, t) => WEATHER_BY_ID[weatherAt(seed, windowIndex(t))];

/** Strike offsets (ms from window start) for storm / shooting-star windows. */
export function strikeTimes(seed, w) {
  const def = WEATHER_BY_ID[weatherAt(seed, w)];
  if (!def.strikes) return [];
  const out = [];
  for (let i = 0; i < def.strikes.n; i++) out.push(15_000 + (hash32(seed, 'strike', w, i) % (WINDOW_MS - 30_000)));
  return out.sort((a, b) => a - b);
}

/** Forecast for the HUD: current and next windows. */
export function forecast(seed, t, count = 3) {
  const w = windowIndex(t);
  return Array.from({ length: count }, (_, i) => ({ w: w + i, kind: weatherAt(seed, w + i), start: windowStart(w + i), end: windowStart(w + i + 1) }));
}
