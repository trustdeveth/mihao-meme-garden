// @ts-check
// Long-term progression: sticker album, collections and titles, reputation, villager orders, the weekly
// contract, season pass, festivals, Sky Island, daily challenges and silly surprises.
import { CROP, CROPS, tierIndex } from '../data/crops.js';
import { GADGETS, WORLD_EPOCH } from '../data/tables.js';
import {
  COLLECTIONS, repNeeded, VILLAGERS, ORDER_SLOTS, ORDER_MS, SEASON_MS, SEASON_NAMES, SEASON_TIER_XP, SEASON_TIERS, seasonReward,
  FESTIVALS, FESTIVAL_MUTATION_CHANCE, FESTIVAL_SHOP, ISLAND, TRIALS, TRIAL_GROW, TRIAL_REWARD, SURPRISES, DECOR, PETS, AVATAR,
} from '../data/features.js';
import { ok, fail, dayKey, weekKey } from './state.js';
import { stat, grant } from './quests.js';
import { keyed, hash32, randInt } from '../util/rng.js';
import { toLocal } from '../world/village-layout.js';
import { addSeasonPoints, SP_AWARD } from './season-points.js';

const ensure = (s) => {
  s.album ??= {};
  s.badges ??= {};
  s.titles ??= [];
  s.rep ??= { level: 0, points: 0, total: 0 };
  s.orders ??= [];
  s.orderGen ??= 0;
  s.contract ??= null;
  s.season ??= { id: -1, xp: 0, claimed: [] };
  s.festival ??= { id: '', tickets: 0 };
  s.island ??= { unlocked: false, day: '', picked: [], acorns: 0, days: 0 };
  s.decorInv ??= {};
  s.trial ??= null;
  s.trialBest ??= {};
  s.medals ??= 0;
  s.surprise ??= null;
  s.surpriseAt ??= 0;
  s.stats.decorPlaced ??= 0;
  return s;
};
export { ensure as ensureProgress };

/** Add rewards of any kind (coins, gems, gadgets, decor, reputation, titles). */
export function give(state, r, ctx) {
  ensure(state);
  grant(state, { coins: r.coins ?? 0, gems: r.gems ?? 0, gadgets: r.gadgets ?? {} });
  for (const [id, n] of Object.entries(r.decor ?? {})) state.decorInv[id] = (state.decorInv[id] ?? 0) + n;
  if (r.title && !state.titles.includes(r.title)) state.titles.push(r.title);
  if (r.reputation) addRep(state, r.reputation, ctx);
}

// ---- Album and collections ---------------------------------------------------------

export const stickerKey = (i) => `${i.crop}|${i.variant}|${[...i.env].sort().join('+')}|${i.big ? 'B' : ''}`;

/** Called for every harvested item. */
export function onHarvest(state, items, ctx) {
  ensure(state);
  let fresh = 0;
  for (const it of items) {
    const k = stickerKey(it);
    if (!state.album[k]) fresh++;
    state.album[k] = (state.album[k] ?? 0) + 1;
  }
  addSeasonXp(state, items.length * 3, ctx);
  trackCollections(state);
  return fresh;
}

function collectionProgress(state, need) {
  const items = Object.keys(state.album ?? {}).map((k) => { const [crop, variant, env, big] = k.split('|'); return { crop, variant, env: env ? env.split('+') : [], big: !!big }; });
  if (need.harvested) return Math.min(1, state.stats.harvested / need.harvested);
  if (need.species) return Math.min(1, Object.keys(state.species).filter((c) => CROP[c]?.tier !== 'ornamental').length / need.species);
  if (need.variants) return need.variants.filter((v) => items.some((i) => i.variant === v)).length / need.variants.length;
  if (need.envs) return need.envs.filter((e) => items.some((i) => i.env.includes(e))).length / need.envs.length;
  if (need.big) return items.some((i) => i.big) ? 1 : 0;
  if (need.petSpecies) return Math.min(1, new Set((state.pets ?? []).map((p) => p.kind)).size / need.petSpecies);
  if (need.stickers) return Math.min(1, Object.keys(state.album ?? {}).length / need.stickers);
  if (need.home) return (state.home ?? 0) >= need.home ? 1 : 0;
  if (need.decorPlaced) return Math.min(1, (state.stats.decorPlaced ?? 0) / need.decorPlaced);
  if (need.islandDays) return Math.min(1, (state.island?.days ?? 0) / need.islandDays);
  if (need.reputation) return Math.min(1, (state.rep?.level ?? 0) / need.reputation);
  return 0;
}
export const collectionStatus = (state) => COLLECTIONS.map((c) => ({ ...c, progress: collectionProgress(ensure(state), c.need), claimed: !!state.badges[c.id] }));

/** Mark finished collections as claimable (the player claims them for the reward). */
export function trackCollections(state) { ensure(state); }

export function claimCollection(state, id, ctx) {
  ensure(state);
  const c = COLLECTIONS.find((x) => x.id === id);
  if (!c) return fail('no_item', 'Unknown collection.');
  if (state.badges[id]) return fail('claimed', 'Already claimed.');
  if (collectionProgress(state, c.need) < 1) return fail('not_done', 'Not finished yet.');
  state.badges[id] = ctx.now;
  give(state, { gems: c.gems, title: c.title }, ctx);
  return ok(`Badge earned: ${c.name}!${c.title ? ` New title: ${c.title}.` : ''}`);
}

export function setTitle(state, title) {
  ensure(state);
  if (title && !state.titles.includes(title)) return fail('locked', 'You have not earned that title yet.');
  state.title = title || '';
  return ok(title ? `Title set: ${title}` : 'Title hidden.');
}

// ---- Reputation ----------------------------------------------------------------------

const STAGE_COINS = [100, 600, 4_000, 30_000, 250_000, 2_000_000];
const stage = (s) => Math.max(0, Math.min(5, s.stats.tierMax ?? 0));

export function addRep(state, n, ctx) {
  ensure(state);
  state.rep.points += n;
  state.rep.total += n;
  const ups = [];
  while (state.rep.points >= repNeeded(state.rep.level)) {
    state.rep.points -= repNeeded(state.rep.level);
    state.rep.level += 1;
    const L = state.rep.level;
    const reward = { coins: STAGE_COINS[stage(state)], gems: 2 };
    if (L % 5 === 0) reward.gadgets = { mysteryBox: 1, growJuice: 1 };
    if (L % 25 === 0) reward.title = `Village Legend ${L / 25}`;
    grant(state, reward);
    if (reward.title && !state.titles.includes(reward.title)) state.titles.push(reward.title);
    ups.push(L);
  }
  return ups;
}

// ---- Villager orders ------------------------------------------------------------------

function knownCrops(state) {
  const st = stage(state);
  return CROPS.filter((c) => c.tier !== 'ornamental' && tierIndex(c.tier) <= Math.max(0, st) && (state.species[c.id] || tierIndex(c.tier) <= 0));
}

function makeOrder(state, slot, ctx) {
  const rng = keyed(ctx.seed, 'order', state.created, slot, state.orderGen++);
  const crops = knownCrops(state);
  const crop = crops[Math.floor(rng() * crops.length)] ?? CROP.carrot;
  const count = randInt(rng, 2, crop.tier === 'common' ? 6 : 4);
  const special = rng() < 0.25 ? (rng() < 0.5 ? { env: 'any' } : { variant: 'silver+' }) : null;
  const value = crop.value * count * (special ? 6 : 3) + 50;
  return {
    id: `o${state.nextId++}`, slot, villager: VILLAGERS[Math.floor(rng() * VILLAGERS.length)], crop: crop.id, count, special,
    reward: { coins: Math.round(value), gems: special ? 3 : 1, reputation: special ? 25 : 12 }, until: ctx.now + ORDER_MS,
  };
}

/** Keep three orders on the board, replacing expired ones. */
export function refreshOrders(state, ctx) {
  ensure(state);
  state.orders = state.orders.filter((o) => o.until > ctx.now);
  for (let slot = 0; slot < ORDER_SLOTS; slot++) if (!state.orders.some((o) => o.slot === slot)) state.orders.push(makeOrder(state, slot, ctx));
  state.orders.sort((a, b) => a.slot - b.slot);
}

const matches = (it, crop, special) => it.crop === crop && !it.star && (!special || (special.env ? it.env.length > 0 : it.variant !== 'normal'));

export function deliverOrder(state, orderId, ctx) {
  ensure(state);
  const o = state.orders.find((x) => x.id === orderId);
  if (!o) return fail('no_item', 'That order is gone.');
  const have = state.basket.filter((i) => matches(i, o.crop, o.special));
  if (have.length < o.count) return fail('missing', `Needs ${o.count} ${CROP[o.crop].name}${o.special ? (o.special.env ? ' with a weather mark' : ' (Silver or better)') : ''}. You have ${have.length}.`);
  const used = new Set(have.slice(0, o.count).map((i) => i.id));
  state.basket = state.basket.filter((i) => !used.has(i.id));
  state.orders = state.orders.filter((x) => x !== o);
  give(state, o.reward, ctx);
  stat(state, 'orders');
  addSeasonPoints(state, 'tasks', SP_AWARD.order, ctx.now);
  refreshOrders(state, ctx);
  return ok(`${o.villager}: "Thank you!" +${o.reward.coins.toLocaleString('en-US')} coins, +${o.reward.reputation} reputation.`);
}

// ---- Weekly contract -------------------------------------------------------------------

export function refreshContract(state, ctx) {
  ensure(state);
  const wk = weekKey(ctx.now);
  if (state.contract?.week === wk) return;
  const rng = keyed(ctx.seed, 'contract', wk, stage(state));
  const crops = knownCrops(state);
  const picks = [];
  for (let i = 0; i < 3 && crops.length; i++) {
    const c = crops[Math.floor(rng() * crops.length)];
    if (!picks.some((p) => p.crop === c.id)) picks.push({ crop: c.id, need: randInt(rng, 6, 14) * (c.tier === 'common' ? 2 : 1), have: 0 });
  }
  const names = ['Royal Banquet', 'Harvest Festival Feast', 'Village Bake-Off', 'Mayor\'s Picnic', 'School Lunch Rush'];
  state.contract = { week: wk, name: names[hash32(wk) % names.length], parts: picks, done: false, reward: { coins: STAGE_COINS[stage(state)] * 8, gems: 20, reputation: 120, decor: { trophy: 1 }, title: 'Contract Champion' } };
}

export function deliverContract(state, ctx) {
  ensure(state);
  refreshContract(state, ctx);
  const c = state.contract;
  if (c.done) return fail('claimed', 'This week\'s contract is complete!');
  let given = 0;
  for (const part of c.parts) {
    const missing = part.need - part.have;
    const items = state.basket.filter((i) => i.crop === part.crop && !i.star).slice(0, missing);
    const ids = new Set(items.map((i) => i.id));
    state.basket = state.basket.filter((i) => !ids.has(i.id));
    part.have += items.length;
    given += items.length;
  }
  if (!given) return fail('missing', 'You have none of the crops this contract needs (starred crops are kept).');
  if (c.parts.every((p) => p.have >= p.need)) {
    c.done = true;
    give(state, c.reward, ctx);
    addSeasonPoints(state, 'tasks', SP_AWARD.contract, ctx.now);
    return ok(`Contract complete: ${c.name}! You earned a trophy.`);
  }
  return ok(`Delivered ${given} crops to the ${c.name}.`);
}

// ---- Season pass -----------------------------------------------------------------------

export const seasonIndex = (t) => Math.floor((t - WORLD_EPOCH) / SEASON_MS);
export const seasonInfo = (t) => { const i = seasonIndex(t); return { id: i, name: SEASON_NAMES[((i % SEASON_NAMES.length) + SEASON_NAMES.length) % SEASON_NAMES.length], ends: WORLD_EPOCH + (i + 1) * SEASON_MS }; };

export function addSeasonXp(state, n, ctx) {
  ensure(state);
  const id = seasonIndex(ctx.now);
  if (state.season.id !== id) state.season = { id, xp: 0, claimed: [] };
  state.season.xp += n;
}
export const seasonTier = (state) => Math.min(SEASON_TIERS, Math.floor((state.season?.xp ?? 0) / SEASON_TIER_XP));

export function claimSeason(state, tier, ctx) {
  ensure(state);
  addSeasonXp(state, 0, ctx);
  if (!(tier >= 1 && tier <= SEASON_TIERS)) return fail('no_item', 'Unknown tier.');
  if (seasonTier(state) < tier) return fail('locked', 'Not reached yet.');
  if (state.season.claimed.includes(tier)) return fail('claimed', 'Already claimed.');
  state.season.claimed.push(tier);
  const r = seasonReward(tier);
  give(state, { ...r, coins: r.coinsStage ? STAGE_COINS[stage(state)] : 0 }, ctx);
  return ok(`Season reward ${tier} claimed!`);
}

// ---- Festivals -------------------------------------------------------------------------

const WEEK_MS = 7 * 86_400_000;
/** The festival running at time t (Friday 00:00 to Sunday 24:00 UTC), or null. */
export function festivalAt(t) {
  const d = new Date(t);
  const dow = d.getUTCDay(); // 5 Fri, 6 Sat, 0 Sun
  if (![5, 6, 0].includes(dow)) return null;
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (dow === 0 ? 2 : dow - 5)); // that Friday
  const wk = Math.floor((start - WORLD_EPOCH) / WEEK_MS);
  const f = FESTIVALS[((wk % FESTIVALS.length) + FESTIVALS.length) % FESTIVALS.length];
  return { ...f, key: `${f.id}-${dayKey(start)}`, ends: start + 3 * 86_400_000 };
}
/** Next festival start (for the HUD countdown). */
export function nextFestival(t) {
  for (let k = 0; k < 8; k++) { const d = Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), new Date(t).getUTCDate() + k); if (new Date(d).getUTCDay() === 5 && d > t) return { at: d, fest: festivalAt(d) }; }
  return null;
}

/** Festival effects on a fresh harvest: tickets and a chance of the festival mutation. */
export function festivalHarvest(state, items, ctx) {
  ensure(state);
  const f = festivalAt(ctx.now);
  if (!f) return null;
  if (state.festival.id !== f.key) state.festival = { id: f.key, tickets: 0 };
  state.festival.tickets += items.length;
  if (!ctx.noSP) addSeasonPoints(state, 'coop', SP_AWARD.festivalHarvest * items.length, ctx.now);
  const rng = ctx.rng('fest', state.nextId);
  for (const it of items) if (rng() < FESTIVAL_MUTATION_CHANCE && !it.env.includes(f.env)) it.env.push(f.env);
  return f;
}

export function festivalBuy(state, id, ctx) {
  ensure(state);
  const f = festivalAt(ctx.now);
  if (!f || state.festival.id !== f.key) return fail('closed', 'No festival is running right now.');
  const item = FESTIVAL_SHOP[id];
  if (!item) return fail('no_item', 'Unknown item.');
  if (state.festival.tickets < item.price) return fail('no_tickets', 'Not enough festival tickets.');
  state.festival.tickets -= item.price;
  if (item.kind === 'decor') give(state, { decor: { [id]: 1 } }, ctx);
  else if (item.kind === 'gadget') give(state, { gadgets: { [id]: 1 } }, ctx);
  else { state.wardrobe ??= []; if (!state.wardrobe.includes(id)) state.wardrobe.push(id); }
  return ok('Bought with festival tickets!');
}

// ---- Sky Island --------------------------------------------------------------------------

export function unlockIsland(state, ctx) {
  ensure(state);
  if (state.island.unlocked) return fail('done', 'The balloon is already fixed!');
  for (const [crop, n] of Object.entries(ISLAND.unlock)) {
    if (state.basket.filter((i) => i.crop === crop && !i.star).length < n) return fail('missing', `Captain Puff needs ${ISLAND.unlock.pumpkin} ${CROP.pumpkin.name} and ${ISLAND.unlock.bamboo} ${CROP.bamboo.name} to fix the balloon.`);
  }
  for (const [crop, n] of Object.entries(ISLAND.unlock)) { let left = n; state.basket = state.basket.filter((i) => (left > 0 && i.crop === crop && !i.star ? (left--, false) : true)); }
  state.island.unlocked = true;
  return ok('The balloon is fixed! You can fly to Sky Island.');
}

/** Today's acorn spots (island-local metres), different for every player and day. */
export function acornSpots(state, day, seed) {
  const rng = keyed(seed, 'acorn', state.created, day);
  return Array.from({ length: ISLAND.acornsPerDay }, () => { const a = rng() * Math.PI * 2, r = 4 + rng() * (ISLAND.radius - 7); return { x: Math.sin(a) * r, z: Math.cos(a) * r }; });
}

export function islandDay(state, ctx) {
  ensure(state);
  const d = dayKey(ctx.now);
  if (state.island.day !== d) { state.island.day = d; state.island.picked = []; state.island.days += 1; }
}

export function pickAcorn(state, i, pos, ctx) {
  ensure(state);
  if (!state.island.unlocked) return fail('locked', 'Fix the balloon first.');
  islandDay(state, ctx);
  const spots = acornSpots(state, state.island.day, ctx.seed);
  const s = spots[i];
  if (!s || state.island.picked.includes(i)) return fail('picked', 'Already picked.');
  const lx = pos.x - ISLAND.center.x, lz = pos.z - ISLAND.center.z;
  if (Math.hypot(lx - s.x, lz - s.z) > 3) return fail('far', 'Walk a little closer first.');
  if (state.island.acorns >= ISLAND.acornCap) return fail('full', 'Your acorn pouch is full.');
  state.island.picked.push(i);
  state.island.acorns += 1;
  addSeasonPoints(state, 'discover', SP_AWARD.acorn, ctx.now);
  return ok('Found a Sky Acorn!');
}

export function acornShop(state, id, ctx) {
  ensure(state);
  const price = ISLAND.shop[id];
  if (!price) return fail('no_item', 'Unknown item.');
  if (state.island.acorns < price) return fail('no_acorns', 'Not enough Sky Acorns.');
  state.island.acorns -= price;
  if (id.startsWith('seed_')) { const c = id.slice(5); state.seeds[c] = (state.seeds[c] ?? 0) + 1; }
  else give(state, { gadgets: { [id]: 1 } }, ctx);
  return ok('The owl wraps it up for you.');
}

// ---- Daily Silly Challenge ---------------------------------------------------------------------

export const trialOfDay = (t) => TRIALS[hash32(dayKey(t)) % TRIALS.length];

export function trialStart(state, ctx) {
  ensure(state);
  const def = trialOfDay(ctx.now);
  state.trial = { id: def.id, day: dayKey(ctx.now), start: ctx.now, until: ctx.now + def.secs * 1000, beds: Array(def.beds).fill(null), seeds: { ...def.seeds }, coins: def.coins, harvested: 0, species: [], done: false };
  return ok(`Challenge started: ${def.name}! Go!`);
}

export function trialAct(state, a, bed, crop, ctx) {
  ensure(state);
  const t = state.trial;
  if (!t || t.done) return fail('none', 'Start the challenge first.');
  if (ctx.now > t.until) { t.done = true; return fail('time', 'Time is up!'); }
  const def = TRIALS.find((x) => x.id === t.id);
  if (a === 'buy') {
    if (t.coins < def.buy) return fail('no_coins', 'Not enough trial coins.');
    t.coins -= def.buy; t.seeds.carrot = (t.seeds.carrot ?? 0) + 1;
  } else if (a === 'plant') {
    if (!(bed >= 0 && bed < t.beds.length) || t.beds[bed]) return fail('busy', 'That bed is busy.');
    if (!(t.seeds[crop] > 0)) return fail('no_seeds', 'No seeds of that kind.');
    t.seeds[crop]--;
    t.beds[bed] = { crop, ready: ctx.now + TRIAL_GROW[crop] * 1000 };
  } else if (a === 'harvest') {
    const b = t.beds[bed];
    if (!b || ctx.now < b.ready) return fail('not_ripe', 'Not ready yet.');
    t.beds[bed] = null;
    if (def.id === 'market') t.coins += def.sell;
    else { t.harvested += 1; if (!t.species.includes(b.crop)) t.species.push(b.crop); }
  } else return fail('unknown', 'Unknown move.');
  const won = (def.goal.harvest && t.harvested >= def.goal.harvest) || (def.goal.species && t.species.length >= def.goal.species) || (def.goal.coins && t.coins >= def.goal.coins);
  if (won) {
    t.done = true;
    const time = (ctx.now - t.start) / 1000;
    const key = `${t.id}`;
    const firstToday = state.trialWon !== t.day;
    state.trialBest[key] = Math.min(state.trialBest[key] ?? Infinity, Math.round(time * 10) / 10);
    if (firstToday) { state.trialWon = t.day; state.medals += 1; give(state, { gems: TRIAL_REWARD.gems, reputation: TRIAL_REWARD.reputation }, ctx); addSeasonPoints(state, 'challenge', SP_AWARD.challenge, ctx.now); }
    return ok(`Challenge complete in ${time.toFixed(1)} s!${firstToday ? ' Medal earned!' : ''}`, { won: true });
  }
  return ok('');
}

// ---- Silly surprises ---------------------------------------------------------------------------

/** Maybe start a surprise for an online player (deterministic per player and 10-minute bucket). */
export function maybeSurprise(state, slot, ctx) {
  ensure(state);
  if (state.surprise && state.surprise.until > ctx.now) return null;
  if (state.surprise && state.surprise.until <= ctx.now) state.surprise = null;
  if (ctx.now < (state.surpriseAt ?? 0)) return null;
  const rng = ctx.rng('surprise', Math.floor(ctx.now / 600_000));
  const kinds = Object.keys(SURPRISES);
  const kind = kinds[Math.floor(rng() * kinds.length)];
  const want = kind === 'alien' ? (Object.keys(state.species)[Math.floor(rng() * Math.max(1, Object.keys(state.species).length))] ?? 'carrot') : null;
  const x = (rng() - 0.5) * 18, z = (rng() - 0.5) * 6 + 7;
  state.surprise = { kind, x, z, want, until: ctx.now + SURPRISES[kind].secs * 1000, slot };
  state.surpriseAt = ctx.now + (6 + rng() * 6) * 60_000;
  return state.surprise;
}

export function resolveSurprise(state, slot, pos, ctx) {
  ensure(state);
  const s = state.surprise;
  if (!s || s.until < ctx.now) return fail('none', 'It flew away!');
  const l = toLocal(slot, pos.x, pos.z);
  if (Math.hypot(l.x - s.x, l.z - s.z) > 4) return fail('far', 'Walk a little closer first.');
  if (s.kind === 'alien') {
    const it = state.basket.find((i) => i.crop === s.want && !i.star);
    if (!it) return fail('missing', `The alien wants a ${CROP[s.want]?.name ?? s.want}.`);
    state.basket = state.basket.filter((i) => i !== it);
  }
  state.surprise = null;
  give(state, SURPRISES[s.kind].reward, ctx);
  const msg = { crow: 'Shoo! The crow dropped a shiny feather.', gnome: 'You caught a gnome! It will look great in your garden.', alien: 'The alien beams with joy and leaves gems behind!' }[s.kind];
  return ok(msg);
}

export { DECOR, PETS, AVATAR, GADGETS };
