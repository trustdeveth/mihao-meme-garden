// @ts-check
// Prices, Market Mood v3 (6.8.12), selling and deterministic shop restocks (6.8.7).
import { CROP, CROPS } from '../data/crops.js';
import { ENV, VARIANT_FACTOR, MOOD, TIERS, CARROT_STOCK, GADGETS, RESTOCK_MS, WORLD_EPOCH, BASKET_CAPACITY } from '../data/tables.js';
import { ripenessMult } from './ripening.js';
import { hash32, unit } from '../util/rng.js';
import { ok, fail } from './state.js';
import { stat } from './quests.js';
import { saleBonus } from './estate.js';

export const capacity = (_state) => BASKET_CAPACITY;

/** Bed-hours of base output in one fruit: drives how much a sale lowers demand. */
export function bedHours(cropId) {
  const c = CROP[cropId];
  return c.regrow ? c.value / c.baseHourly : c.grow / 3600;
}

/** Current demand level for a crop (1 = full price, floor 0.5), recovering 1 point per minute. */
export function moodLevel(state, cropId, now) {
  const m = state.mood[cropId];
  if (!m) return 1;
  return Math.min(1, m.lvl + ((now - m.at) / 60_000) * MOOD.recoverPerMin);
}

function lowerMood(state, cropId, now) {
  const lvl = moodLevel(state, cropId, now);
  state.mood[cropId] = { lvl: Math.max(MOOD.floor, lvl - MOOD.dropPerBedHour * bedHours(cropId)), at: now };
}

/** Value of an item before Market Mood. */
export function itemValue(item) {
  const c = CROP[item.crop];
  const env = 1 + (item.env ?? []).reduce((a, e) => a + (ENV[e] ?? 0), 0);
  return c.value * item.mass * item.mass * VARIANT_FACTOR[item.variant] * env * ripenessMult(item.ripe ?? 0);
}

/** Sale price at the current mood. */
export const salePrice = (state, item, now) => Math.max(1, Math.round(itemValue(item) * moodLevel(state, item.crop, now) * saleBonus(state)));

/** Appraise items without selling (free, at the goat's stall). */
export function appraise(state, ids, now) {
  const items = ids === 'all' ? state.basket.filter((i) => !i.star) : state.basket.filter((i) => ids.includes(i.id));
  // simulate the mood drop across the batch for an honest total
  const sim = { ...state, mood: { ...state.mood } };
  let total = 0;
  for (const it of items) { total += salePrice(sim, it, now); lowerMood(sim, it.crop, now); }
  return { count: items.length, total };
}

/** Sell items by id, or all unstarred items. */
export function sell(state, ids, ctx) {
  const items = ids === 'all' ? state.basket.filter((i) => !i.star) : state.basket.filter((i) => ids.includes(i.id) && !i.star);
  if (!items.length) return fail('nothing_to_sell', 'Nothing to sell. Starred items are protected.');
  let total = 0;
  for (const it of items) {
    total += salePrice(state, it, ctx.now);
    lowerMood(state, it.crop, ctx.now);
  }
  const sold = new Set(items.map((i) => i.id));
  state.basket = state.basket.filter((i) => !sold.has(i.id));
  state.coins += total;
  stat(state, 'sold', items.length);
  stat(state, 'earned', total);
  return ok(`Sold ${items.length} for ${total.toLocaleString('en-US')} coins!`, { value: total, count: items.length });
}

export function star(state, itemId) {
  const it = state.basket.find((i) => i.id === itemId);
  if (!it) return fail('no_item', 'Item not found.');
  it.star = !it.star;
  return ok(it.star ? 'Starred: protected from selling.' : 'Star removed.');
}

// ---- Shop restocks ---------------------------------------------------------

export const restockIndex = (t) => Math.floor((t - WORLD_EPOCH) / RESTOCK_MS);
export const restockEnds = (r) => WORLD_EPOCH + (r + 1) * RESTOCK_MS;

/** Stock for restock r. Same for every player for a given world seed. */
export function stockAt(seed, r) {
  const seeds = {}, gadgets = {};
  for (const c of CROPS) {
    if (c.unlock) continue; // ornamentals come from projects later
    if (c.id === 'carrot') { seeds.carrot = CARROT_STOCK.min + (hash32(seed, 'stk', r, 'carrot') % (CARROT_STOCK.max - CARROT_STOCK.min + 1)); continue; }
    const t = TIERS[c.tier].restock;
    if (unit(seed, 'p', r, c.id) < t.p) seeds[c.id] = t.min + (hash32(seed, 'q', r, c.id) % (t.max - t.min + 1));
  }
  for (const [id, g] of Object.entries(GADGETS)) {
    if (g.price == null) continue;
    const t = TIERS[g.tier].restock;
    if (unit(seed, 'gp', r, id) < t.p) gadgets[id] = t.min + (hash32(seed, 'gq', r, id) % (t.max - t.min + 1));
  }
  return { r, seeds, gadgets, ends: restockEnds(r) };
}

function boughtMap(state, now) {
  const r = restockIndex(now);
  if (state.bought.r !== r) state.bought = { r, items: {} };
  return state.bought.items;
}

/** Remaining stock for this player in the current restock. */
export function remaining(state, seed, now, kind, id) {
  const stock = stockAt(seed, restockIndex(now));
  const have = (kind === 'seed' ? stock.seeds[id] : stock.gadgets[id]) ?? 0;
  return Math.max(0, have - (boughtMap(state, now)[`${kind}:${id}`] ?? 0));
}

export function buySeed(state, id, n, ctx) {
  const c = CROP[id];
  n = Math.max(1, Math.min(99, Math.floor(n || 1)));
  if (!c) return fail('no_item', 'Unknown seed.');
  if (remaining(state, ctx.seed, ctx.now, 'seed', id) < n) return fail('no_stock', 'Not enough in stock. Restock soon!');
  const cost = c.seed * n;
  if (state.coins < cost) return fail('no_coins', 'Not enough coins.');
  state.coins -= cost;
  state.seeds[id] = (state.seeds[id] ?? 0) + n;
  boughtMap(state, ctx.now)[`seed:${id}`] = (boughtMap(state, ctx.now)[`seed:${id}`] ?? 0) + n;
  stat(state, 'bought', n);
  return ok(`Bought ${n} ${c.name} seed${n > 1 ? 's' : ''}.`);
}

export function addGadget(state, kind, n = 1) {
  const g = GADGETS[kind];
  if (!g) return;
  if (g.permanent) { state.tools[kind] = true; return; }
  state.gadgets[kind] = (state.gadgets[kind] ?? 0) + n * (g.uses ?? 1);
}

export function buyGadget(state, id, ctx) {
  const g = GADGETS[id];
  if (!g || g.price == null) return fail('no_item', 'That gadget is not for sale.');
  if (g.permanent && state.tools[id]) return fail('owned', 'You already own this.');
  if (remaining(state, ctx.seed, ctx.now, 'gadget', id) < 1) return fail('no_stock', 'Out of stock. Restock soon!');
  if (state.coins < g.price) return fail('no_coins', 'Not enough coins.');
  state.coins -= g.price;
  addGadget(state, id, 1);
  boughtMap(state, ctx.now)[`gadget:${id}`] = (boughtMap(state, ctx.now)[`gadget:${id}`] ?? 0) + 1;
  return ok(`Bought ${g.name}.`);
}
