// @ts-check
// What a $MGRD payment buys: price lookup (USD) and the grant applied after the server has verified the on-chain
// payment receipt. Pure functions on the player state, shared by the server and the tests.
import { EGGS, DECOR, WEAR, AVATAR, PET_LIMITS } from '../data/features.js';
import { MGRD_EGG, MGRD_DECOR, MGRD_PER_GEM, MGRD_SOIL, MGRD_GROWALL, LIMITED } from '../data/mgrd.js';
import { soilRequirements, growAllQuote } from './garden.js';
import { ownsWear } from './estate.js';
import { ok, fail, dayKey } from './state.js';

/** Everything that can be bought with $MGRD: kind -> human label. */
export const MGRD_KINDS = Object.freeze({ wear: 'Outfit', egg: 'Pet egg', decor: 'Decoration', hair: 'Hair colour', soil: 'Expand Soil', growall: 'Grow All', limited: 'Limited drop' });

/**
 * $MGRD price for one purchase, or a failure explaining why it cannot be bought now.
 * @returns {{ok: true, mgrd: number, name: string} | {ok: false, code: string, msg: string}}
 */
export function mgrdPrice(state, kind, id, now, seed) {
  if (kind === 'wear') {
    const w = WEAR[id];
    if (!w || w.limited) return fail('no_item', 'Unknown item.');
    if (ownsWear(state, id)) return fail('owned', 'You already own that.');
    const mgrd = w.mgrd ?? (w.gems ? w.gems * MGRD_PER_GEM : null);
    if (!mgrd) return fail('no_item', 'That one is not sold for $MGRD.');
    return { ok: true, mgrd, name: w.name };
  }
  if (kind === 'egg') {
    const e = EGGS[id];
    if (!e) return fail('no_item', 'Unknown egg.');
    if ((state.eggs ?? []).length >= PET_LIMITS.incubators) return fail('full', 'Your incubators are full. Hatch an egg first.');
    if ((state.pets ?? []).length + (state.eggs ?? []).length >= PET_LIMITS.owned) return fail('full', 'Your pet house is full.');
    return { ok: true, mgrd: MGRD_EGG[id], name: e.name };
  }
  if (kind === 'decor') {
    const d = DECOR[id];
    if (!d || d.price == null) return fail('no_item', 'That decoration is not for sale.');
    return { ok: true, mgrd: MGRD_DECOR[d.tier] ?? 1_000, name: d.name };
  }
  if (kind === 'hair') {
    const gems = AVATAR.premiumHair[id];
    if (!gems) return fail('no_item', 'Unknown colour.');
    if ((state.unlockedColors ?? []).includes(id)) return fail('owned', 'You already have that colour.');
    return { ok: true, mgrd: gems * MGRD_PER_GEM, name: 'Special hair colour' };
  }
  if (kind === 'soil') {
    const r = soilRequirements(state);
    if (r.max) return fail('max', 'Your soil is already at full size!');
    // the coin price is what $MGRD replaces; every other requirement must already be met
    const other = r.missing.filter((m) => m.kind !== 'coins');
    if (other.length) return fail('requirements', 'Finish the other requirements first (crops and harvests).');
    return { ok: true, mgrd: MGRD_SOIL[r.level] ?? 25_000, name: `Expand Soil to ${r.next.area} m²` };
  }
  if (kind === 'growall') {
    const q = growAllQuote(state, now, seed);
    if (!q.count) return fail('all_grown', 'Everything is already grown!');
    const today = state.mgrdGrowAll?.day === dayKey(now) ? state.mgrdGrowAll.n : 0;
    if (today >= MGRD_GROWALL.perDay) return fail('limit', `$MGRD Grow All can be used ${MGRD_GROWALL.perDay} times a day.`);
    const mgrd = Math.min(MGRD_GROWALL.max, Math.max(MGRD_GROWALL.min, Math.round(q.cost / MGRD_GROWALL.coinsPerMgrd / 10) * 10));
    return { ok: true, mgrd, name: `Grow All (${q.count} plants)` };
  }
  if (kind === 'limited') {
    const L = LIMITED[id];
    if (!L) return fail('no_item', 'Unknown drop.');
    if ((state.editions ?? {})[id]) return fail('owned', 'You already own one.');
    return { ok: true, mgrd: L.mgrd, name: L.name };
  }
  return fail('no_item', 'Unknown purchase.');
}

/** Apply a verified purchase. `edition` is the limited-drop number (server-assigned). */
export function mgrdGrant(state, kind, id, ctx, edition = 0) {
  if (kind === 'wear') { state.wardrobe ??= []; if (!state.wardrobe.includes(id)) state.wardrobe.push(id); return ok(`${WEAR[id].name} is yours!`); }
  if (kind === 'egg') {
    state.eggs ??= [];
    state.eggs.push({ id: `g${state.nextId++}`, kind: id, ready: ctx.now + EGGS[id].hatch * 1000 });
    return ok(`${EGGS[id].name} is warming up in your incubator!`);
  }
  if (kind === 'decor') { state.decorInv ??= {}; state.decorInv[id] = (state.decorInv[id] ?? 0) + 1; return ok(`Bought a ${DECOR[id].name}. Place it from your Decor panel!`); }
  if (kind === 'hair') { state.unlockedColors ??= []; if (!state.unlockedColors.includes(id)) state.unlockedColors.push(id); return ok('New hair colour unlocked!'); }
  if (kind === 'soil') {
    const r = soilRequirements(state);
    if (r.max) return fail('max', 'Your soil is already at full size!');
    for (const [crop, n] of Object.entries(r.next.requires?.items ?? {})) {
      let left = n;
      state.basket = state.basket.filter((i) => (left > 0 && i.crop === crop && !i.star ? (left--, false) : true));
    }
    state.soil += 1;
    return ok(`Your soil grew to ${r.next.area} m²!`);
  }
  if (kind === 'growall') {
    let n = 0;
    for (const p of state.plants) {
      if (p.fruit || ctx.now >= p.readyAt) continue;
      p.ck = { at: ctx.now, done: p.work };
      p.readyAt = ctx.now;
      p.boosted = true; // harvests of boosted plants never add Season Points
      n++;
    }
    const day = dayKey(ctx.now);
    state.mgrdGrowAll = { day, n: (state.mgrdGrowAll?.day === day ? state.mgrdGrowAll.n : 0) + 1 };
    return ok(`Grew ${n} plants!`);
  }
  if (kind === 'limited') {
    const L = LIMITED[id];
    state.editions ??= {};
    state.editions[id] = edition;
    if (L.kind === 'wear') { state.wardrobe ??= []; if (!state.wardrobe.includes(L.item)) state.wardrobe.push(L.item); }
    else { state.decorInv ??= {}; state.decorInv[L.item] = (state.decorInv[L.item] ?? 0) + 1; }
    return ok(`${L.name} #${edition} is yours!`);
  }
  return fail('no_item', 'Unknown purchase.');
}
