// @ts-check
// Homes, decorations, Garden Rebirth and the avatar.
import { HOMES, HOME_SPOT, DECOR, DECOR_LIMIT, REBIRTH, AVATAR, DEFAULT_AVATAR, WEAR, WEAR_SLOTS } from '../data/features.js';
import { SOIL_LEVELS } from '../data/tables.js';
import { PLOT } from '../world/village-layout.js';
import { ok, fail } from './state.js';
import { ensureProgress } from './progress.js';
import { stat } from './quests.js';

export function buyHome(state) {
  const next = HOMES[state.home ?? 0];
  if (!next) return fail('max', `You already live in the ${HOMES[HOMES.length - 1].name}!`);
  if (state.coins < next.cost) return fail('no_coins', `The ${next.name} costs ${next.cost.toLocaleString('en-US')} coins.`);
  state.coins -= next.cost;
  state.home = next.tier;
  return ok(`Welcome to your ${next.name}! Every sale earns +${Math.round(next.bonus * 100)}%.`);
}

/** Total sale multiplier from home and rebirth stars. */
export function saleBonus(state) {
  const home = state.home ? HOMES[state.home - 1].bonus : 0;
  const stars = Math.min(REBIRTH.maxStars, state.rebirths ?? 0) * REBIRTH.bonusPerStar;
  return 1 + home + stars;
}

export function buyDecor(state, id, allowCoins = false) {
  ensureProgress(state);
  const d = DECOR[id];
  if (!d || d.price == null) return fail('no_item', 'That decoration is not for sale.');
  // decorations are sold only for $MGRD (earned decorations still come free from festivals, contracts and surprises)
  if (!allowCoins) return fail('mgrd', 'Decorations are sold for $MGRD. Connect a wallet to buy one.');
  if (state.coins < d.price) return fail('no_coins', 'Not enough coins.');
  state.coins -= d.price;
  state.decorInv[id] = (state.decorInv[id] ?? 0) + 1;
  return ok(`Bought a ${d.name}. Place it from your Decor panel!`);
}

/** Decor goes anywhere inside the fence, but not on the soil, the gate path, the home or other decor. */
export function canPlaceDecor(state, id, x, z, ignore = null) {
  const d = DECOR[id];
  if (!d || !Number.isFinite(x) || !Number.isFinite(z)) return { ok: false, code: 'bad_spot' };
  const r = d.r * (d.scale ?? 1);
  if (Math.abs(x) + r > PLOT.w / 2 - 0.6 || Math.abs(z) + r > PLOT.d / 2 - 0.6) return { ok: false, code: 'off_plot' };
  const soil = SOIL_LEVELS[state.soil];
  if (Math.abs(x) < soil.w / 2 + r && Math.abs(z) < soil.d / 2 + r) return { ok: false, code: 'on_soil' };
  if (Math.abs(x) < 2.4 + r && z > PLOT.d / 2 - 3) return { ok: false, code: 'gate' };
  if (state.home && Math.hypot(x - HOME_SPOT.x, z - HOME_SPOT.z) < 3.4 + r) return { ok: false, code: 'home' };
  for (const o of state.decor ?? []) {
    if (o.id === ignore) continue;
    const od = DECOR[o.kind];
    if (Math.hypot(o.x - x, o.z - z) < (od.r * (od.scale ?? 1) + r) * 0.9) return { ok: false, code: 'too_close' };
  }
  return { ok: true };
}
export const DECOR_MSG = { off_plot: 'Keep it inside your fence.', on_soil: 'Not on the soil: plants need it!', gate: 'Keep the gate path clear.', home: 'Too close to your home.', too_close: 'Too close to another decoration.', bad_spot: 'You cannot put it there.' };

export function placeDecor(state, kind, x, z, rot) {
  ensureProgress(state);
  state.decor ??= [];
  if (!(state.decorInv[kind] > 0)) return fail('none', 'You do not have that decoration.');
  const limit = DECOR_LIMIT + (state.club?.active ? 10 : 0); // Garden Club members get 10 more slots
  if (state.decor.length >= limit) return fail('full', `Your garden can hold ${limit} decorations.`);
  const c = canPlaceDecor(state, kind, x, z);
  if (!c.ok) return fail(c.code, DECOR_MSG[c.code]);
  state.decorInv[kind]--;
  if (!state.decorInv[kind]) delete state.decorInv[kind];
  state.decor.push({ id: `d${state.nextId++}`, kind, x, z, rot: ((Math.round((rot || 0) / (Math.PI / 4)) % 8) + 8) % 8 });
  stat(state, 'decorPlaced');
  return ok(`${DECOR[kind].name} placed!`);
}

export function moveDecor(state, id, x, z, rot) {
  const o = (state.decor ?? []).find((d) => d.id === id);
  if (!o) return fail('no_item', 'Decoration not found.');
  const c = canPlaceDecor(state, o.kind, x, z, id);
  if (!c.ok) return fail(c.code, DECOR_MSG[c.code]);
  o.x = x; o.z = z;
  if (rot != null) o.rot = ((Math.round(rot / (Math.PI / 4)) % 8) + 8) % 8;
  return ok('Moved!');
}

export function storeDecor(state, id) {
  ensureProgress(state);
  const o = (state.decor ?? []).find((d) => d.id === id);
  if (!o) return fail('no_item', 'Decoration not found.');
  state.decor = state.decor.filter((d) => d !== o);
  state.decorInv[o.kind] = (state.decorInv[o.kind] ?? 0) + 1;
  return ok(`${DECOR[o.kind].name} packed away.`);
}

// ---- Garden Rebirth --------------------------------------------------------------------------

export function rebirthReady(state) {
  return state.soil >= REBIRTH.soil && (state.home ?? 0) >= REBIRTH.home && (state.rebirths ?? 0) < REBIRTH.maxStars;
}

/** Voluntary reset: keep pets, decor, album, badges, titles, reputation and avatar; gain a Rebirth Star. */
export function rebirth(state, ctx) {
  if (!rebirthReady(state)) return fail('not_ready', `Promotion needs full soil (level ${REBIRTH.soil}) and the ${HOMES[REBIRTH.home - 1].name} or better.`);
  state.rebirths = (state.rebirths ?? 0) + 1;
  state.coins = 50;
  state.seeds = { carrot: 3 };
  state.plants = [];
  state.effects = [];
  state.basket = [];
  state.soil = 0;
  state.home = 0;
  state.gadgets = {};
  state.decor = (state.decor ?? []).filter((d) => canPlaceDecor(state, d.kind, d.x, d.z, d.id).ok);
  state.stats.tierMax = 0;
  state.lastRebirth = ctx.now;
  return ok(`Promoted! mihao. You now have ${state.rebirths} Rank Star${state.rebirths > 1 ? 's' : ''}: +${Math.round(state.rebirths * REBIRTH.bonusPerStar * 100)}% on every sale.`);
}

// ---- Avatar ---------------------------------------------------------------------------------

/** Old avatars stored colours per part; anything unknown goes back to the defaults. */
export function avatarOf(state) {
  const a = { ...DEFAULT_AVATAR, ...(state.avatar ?? {}) };
  for (const s of WEAR_SLOTS) if (!WEAR[a[s]] || WEAR[a[s]].slot !== s) a[s] = DEFAULT_AVATAR[s];
  if (!AVATAR.skin.includes(a.skin)) a.skin = null;
  if (!AVATAR.hair.includes(a.hair) && !AVATAR.premiumHair[a.hair]) a.hair = null;
  if (!AVATAR.beards.some((b) => b.id === a.beard)) a.beard = DEFAULT_AVATAR.beard;
  return { skin: a.skin, hair: a.hair, hat: a.hat, shirt: a.shirt, pants: a.pants, shoes: a.shoes, beard: a.beard, height: Number(a.height) || 1 };
}
export const ownsWear = (state, id) => WEAR[id]?.price === 0 || (state.wardrobe ?? []).includes(id);

/** Buy a wardrobe item with coins or gems; it is worn right away. */
export function buyWear(state, id) {
  const w = WEAR[id];
  if (!w) return fail('no_item', 'Unknown item.');
  if (ownsWear(state, id)) return fail('owned', 'You already have that.');
  if (w.mgrd || w.limited) return fail('mgrd', 'That one is sold in the $MGRD shop.');
  if (w.gems) {
    if (state.gems < w.gems) return fail('no_gems', `That costs ${w.gems} gems.`);
    state.gems -= w.gems;
  } else if (w.price != null) {
    if (state.coins < w.price) return fail('no_coins', `That costs ${w.price.toLocaleString('en-US')} coins.`);
    state.coins -= w.price;
  } else return fail('festival', 'That one comes from the festival ticket shop.');
  state.wardrobe ??= [];
  state.wardrobe.push(id);
  state.avatar = { ...avatarOf(state), [w.slot]: id };
  return ok(`${w.name} is yours!`);
}

/** Change colours, worn items or height. Items must be owned; special hair colours cost gems once. */
export function setAvatar(state, a) {
  const next = avatarOf(state);
  if (a?.skin !== undefined) {
    if (!AVATAR.skin.includes(a.skin)) return fail('bad', 'That colour is not available.');
    next.skin = a.skin;
  }
  let cost = 0;
  if (a?.hair !== undefined) {
    const premium = AVATAR.premiumHair[a.hair];
    if (!AVATAR.hair.includes(a.hair) && !premium) return fail('bad', 'That colour is not available.');
    if (premium && !(state.unlockedColors ?? []).includes(a.hair)) cost = premium;
    next.hair = a.hair;
  }
  for (const s of WEAR_SLOTS) {
    const v = a?.[s];
    if (v == null) continue;
    if (WEAR[v]?.slot !== s) return fail('bad', 'That does not go there.');
    if (!ownsWear(state, v)) return fail('not_owned', `Buy the ${WEAR[v].name} first.`);
    next[s] = v;
  }
  if (a?.beard != null) {
    if (!AVATAR.beards.some((b) => b.id === a.beard)) return fail('bad', 'That style is not available.');
    next.beard = a.beard;
  }
  if (a?.height != null) next.height = Math.min(1.1, Math.max(0.9, Number(a.height) || 1));
  if (state.gems < cost) return fail('no_gems', `That hair colour costs ${cost} gems.`);
  if (cost) { state.gems -= cost; state.unlockedColors ??= []; state.unlockedColors.push(next.hair); }
  state.avatar = next;
  return ok(cost ? `Looking sharp! (${cost} gems)` : 'Looking sharp!');
}
