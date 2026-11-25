// @ts-check
// Deterministic hashing and random numbers. Same results in Node, browsers and tests.

/** 32-bit hash of any mix of strings and numbers (FNV-1a with a murmur-style finalizer). */
export function hash32(...parts) {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0x1f; // separator so ('ab','c') != ('a','bc')
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hash mapped to [0, 1). */
export const unit = (...parts) => hash32(...parts) / 4294967296;

/** Small fast PRNG. Returns a function producing numbers in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** RNG keyed by a secret and any parts: the same inputs always give the same sequence. */
export const keyed = (secret, ...parts) => mulberry32(hash32(secret, ...parts));

/** Integer in [min, max] from an rng. */
export const randInt = (rng, min, max) => min + Math.floor(rng() * (max - min + 1));

/** Weighted pick: items [[value, weight], ...]. */
export function weighted(r, items) {
  const total = items.reduce((a, [, w]) => a + w, 0);
  let x = r * total;
  for (const [v, w] of items) { x -= w; if (x < 0) return v; }
  return items[items.length - 1][0];
}
