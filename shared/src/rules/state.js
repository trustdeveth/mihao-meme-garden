// @ts-check
// Player state: one object per player, saved as a JSON blob by the server.

export const STATE_VERSION = 1;

/** @param {number} now */
export function freshState(now) {
  return {
    v: STATE_VERSION,
    created: now,
    lastSeen: now,
    coins: 50,
    gems: 0,
    xp: 0,
    seeds: { carrot: 3 },
    gadgets: {},           // kind -> charges
    tools: { magnifier: false },
    soil: 0,               // soil level index
    plants: [],            // see garden.js
    effects: [],           // timed garden effects (sprinklers, rain jar)
    basket: [],            // harvested fruit items
    nextId: 1,
    stats: { planted: 0, watered: 0, harvested: 0, sold: 0, earned: 0, liked: 0, bought: 0, mutated: 0, gadgets: 0, tierMax: 0 },
    species: {},           // cropId -> fruits harvested
    delivered: {},         // soil level -> true once its delivery was made
    daily: { key: '', stats: {}, quests: [] },
    weekly: { key: '', stats: {}, quests: [] },
    gift: { last: '', streak: 0 },
    mood: {},              // cropId -> {lvl, at}
    bought: { r: -1, items: {} },
    pityAt: 0,
    tutorial: 0,
    pets: [], eggs: [], home: 0, decor: [], decorInv: {}, rebirths: 0,
    avatar: null, title: '', titles: [],
    lastSeq: 0,
  };
}

/** Fill missing fields after loading (forward compatible). */
export function migrateState(raw, now) {
  const base = freshState(now);
  if (!raw || typeof raw !== 'object') return base;
  const s = { ...base, ...raw };
  s.stats = { ...base.stats, ...(raw.stats ?? {}) };
  s.tools = { ...base.tools, ...(raw.tools ?? {}) };
  for (const k of ['plants', 'effects', 'basket']) if (!Array.isArray(s[k])) s[k] = [];
  s.v = STATE_VERSION;
  return s;
}

export const ok = (msg = '', extra = {}) => ({ ok: true, code: 'ok', msg, ...extra });
export const fail = (code, msg) => ({ ok: false, code, msg });

export const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
export function weekKey(t) {
  const d = new Date(t);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  return dayKey(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
}
