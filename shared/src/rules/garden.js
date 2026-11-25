// @ts-check
// Garden actions: plant, water, harvest, move (trowel), remove (shovel), expand soil,
// gadgets, Grow All and the goat's pity help. All pure: (state, args, ctx) -> result.
import { CROP, CROPS, tierIndex, TIER_ORDER } from '../data/crops.js';
import { SOIL_LEVELS, GADGETS, GROW_ALL_FACTOR, GROW_ALL_MIN, PITY } from '../data/tables.js';
import { canPlace, findBuddy } from './placement.js';
import { checkpoint, refresh, progressAt } from './growth.js';
import { resolveRipening, ripenessAt } from './ripening.js';
import { capacity } from './economy.js';
import { stat } from './quests.js';
import { ok, fail } from './state.js';
import { weighted } from '../util/rng.js';
import { onHarvest, festivalHarvest } from './progress.js';

/** @typedef {{now:number, seed:number, rng:(...parts:any[])=>()=>number}} Ctx */

const findPlant = (state, id) => state.plants.find((p) => p.id === id);

/** Re-evaluate buddy bonuses; checkpoint plants whose bonus changes so past growth stays exact. */
export function recomputeBuddies(state, ctx) {
  for (const p of state.plants) {
    const b = findBuddy(state, p);
    if ((b ?? null) === (p.buddy ?? null)) continue;
    checkpoint(state, p, ctx.now, ctx.seed);
    p.buddy = b;
    refresh(state, p, ctx.seed);
  }
}

function newPlant(state, cropId, x, z, now) {
  return {
    id: `p${state.nextId++}`,
    crop: cropId, x, z,
    planted: now, cycle: 0, cycleStart: now,
    ck: { at: now, done: 0 }, work: 1, readyAt: now,
    watered: false, copper: false, buddy: null, env: [], fruit: null,
  };
}

/** @param {Ctx} ctx */
export function plant(state, cropId, x, z, ctx) {
  const crop = CROP[cropId];
  if (!crop) return fail('no_item', 'Unknown seed.');
  if (!(state.seeds[cropId] > 0)) return fail('no_seeds', 'No seeds left. Visit Mo at the seed stall!');
  const spot = canPlace(state, crop.radius, x, z, ctx.now);
  if (!spot.ok) return fail(spot.code, PLACE_MSG[spot.code]);
  state.seeds[cropId]--;
  if (state.seeds[cropId] === 0) delete state.seeds[cropId];
  const p = newPlant(state, cropId, x, z, ctx.now);
  state.plants.push(p);
  refresh(state, p, ctx.seed);
  recomputeBuddies(state, ctx);
  state.stats.tierMax = Math.max(state.stats.tierMax ?? 0, Math.max(0, tierIndex(crop.tier)));
  stat(state, 'planted', 1, cropId);
  state.xp += 3;
  return ok(`${crop.name} planted!`, { plant: p });
}

export const PLACE_MSG = {
  off_soil: 'Plant on the soil!',
  locked_soil: 'Expand your soil to plant here!',
  too_close: 'Too close to another plant!',
  bad_spot: 'You cannot plant there.',
};

/** @param {Ctx} ctx */
export function water(state, id, ctx) {
  const p = findPlant(state, id);
  if (!p) return fail('no_plant', 'Plant not found.');
  if (p.fruit || ctx.now >= p.readyAt) return fail('ripe', 'This one is ready. Harvest it!');
  if (p.watered) return fail('watered', 'Already watered this cycle.');
  checkpoint(state, p, ctx.now, ctx.seed);
  p.watered = true;
  refresh(state, p, ctx.seed);
  if (p.ck.done >= p.work) p.readyAt = ctx.now;
  stat(state, 'watered');
  state.xp += 2;
  return ok('Watered! It will grow faster.');
}

/** Resolve all plants that have ripened by now. Returns the plants that just ripened. */
export function settle(state, ctx) {
  const ripened = [];
  for (const p of state.plants) if (resolveRipening(state, p, ctx)) ripened.push(p);
  return ripened;
}

/** @param {Ctx} ctx */
export function harvest(state, id, ctx) {
  const p = findPlant(state, id);
  if (!p) return fail('no_plant', 'Plant not found.');
  resolveRipening(state, p, ctx);
  if (!p.fruit) return fail('not_ripe', 'Still growing.');
  if (state.basket.length + p.fruit.length > capacity(state)) return fail('basket_full', 'Your basket is full. Sell some crops first!');
  const crop = CROP[p.crop];
  const ripe = Math.max(0, ripenessAt(p, ctx.now));
  const items = p.fruit.map((f) => ({ id: `i${state.nextId++}`, crop: p.crop, ...f, env: [...(f.env ?? [])], ripe, star: false }));
  // Grow All harvests count for Season Points like any other harvest (the daily caps still apply)
  festivalHarvest(state, items, ctx.noSP ? { ...ctx, noSP: true } : ctx);
  delete p.boosted;
  state.basket.push(...items);
  onHarvest(state, items, ctx);
  state.species[p.crop] = (state.species[p.crop] ?? 0) + items.length;
  const mutated = items.filter((i) => i.variant !== 'normal' || i.big || i.env.length).length;
  stat(state, 'harvested', items.length, p.crop);
  if (mutated) stat(state, 'mutated', mutated);
  state.xp += 8 * items.length;
  if (crop.regrow) {
    p.cycle += 1;
    p.cycleStart = ctx.now;
    p.ck = { at: ctx.now, done: 0 };
    p.watered = false;
    p.env = [];
    p.fruit = null;
    refresh(state, p, ctx.seed);
    return ok(`Harvested ${items.length} ${crop.name}!`, { items, removed: false });
  }
  state.plants = state.plants.filter((x) => x !== p);
  recomputeBuddies(state, ctx);
  return ok(`Harvested ${crop.name}!`, { items, removed: true });
}

/** Trowel: move a plant, keeping its growth, ripeness and fruit. */
export function move(state, id, x, z, ctx) {
  const p = findPlant(state, id);
  if (!p) return fail('no_plant', 'Plant not found.');
  const spot = canPlace(state, CROP[p.crop].radius, x, z, ctx.now, id);
  if (!spot.ok) return fail(spot.code, PLACE_MSG[spot.code]);
  checkpoint(state, p, ctx.now, ctx.seed); // sprinkler coverage may change with position
  p.x = x; p.z = z;
  refresh(state, p, ctx.seed);
  recomputeBuddies(state, ctx);
  return ok('Wheee! Moved.');
}

/** Shovel: remove a plant (no seed back). */
export function remove(state, id, ctx) {
  const p = findPlant(state, id);
  if (!p) return fail('no_plant', 'Plant not found.');
  state.plants = state.plants.filter((x) => x !== p);
  recomputeBuddies(state, ctx);
  return ok(`${CROP[p.crop].name} removed.`);
}

/** Requirement check for the next soil level. */
export function soilRequirements(state) {
  const next = SOIL_LEVELS[state.soil + 1];
  if (!next) return { max: true, ok: false, missing: [] };
  const missing = [];
  if (state.coins < next.price) missing.push({ kind: 'coins', need: next.price, have: state.coins });
  const req = next.requires;
  if (req) {
    const species = Object.keys(state.species).length;
    if (req.species && species < req.species) missing.push({ kind: 'species', need: req.species, have: species });
    if (req.harvested && state.stats.harvested < req.harvested) missing.push({ kind: 'harvested', need: req.harvested, have: state.stats.harvested });
    for (const [crop, n] of Object.entries(req.items ?? {})) {
      const have = state.basket.filter((i) => i.crop === crop && !i.star).length;
      if (have < n) missing.push({ kind: 'item', crop, need: n, have });
    }
  }
  return { max: false, ok: missing.length === 0, missing, next, level: state.soil + 1 };
}

export function expandSoil(state, ctx) {
  const r = soilRequirements(state);
  if (r.max) return fail('max', 'Your soil is already at full size!');
  if (!r.ok) return fail('requirements', 'Not ready to expand yet.');
  state.coins -= r.next.price;
  for (const [crop, n] of Object.entries(r.next.requires?.items ?? {})) {
    let left = n;
    state.basket = state.basket.filter((i) => (left > 0 && i.crop === crop && !i.star ? (left--, false) : true));
  }
  state.soil += 1;
  return ok(`Your soil grew to ${r.next.area} m²!`, { level: state.soil });
}

// ---- Gadgets ---------------------------------------------------------------

const MYSTERY_TIERS = [['common', 45], ['uncommon', 25], ['rare', 18], ['legendary', 9], ['mythical', 2.5], ['prismatic', 0.5]];

function spend(state, kind) {
  if (!(state.gadgets[kind] > 0)) return false;
  state.gadgets[kind]--;
  if (state.gadgets[kind] === 0) delete state.gadgets[kind];
  stat(state, 'gadgets');
  return true;
}

/**
 * @param {string} kind
 * @param {{x?:number, z?:number, plantId?:string}} args
 * @param {Ctx} ctx
 */
export function useGadget(state, kind, args, ctx) {
  const g = GADGETS[kind];
  if (!g) return fail('no_item', 'Unknown gadget.');
  if (g.permanent) return fail('passive', 'This one works on its own.');
  if (!(state.gadgets[kind] > 0)) return fail('no_gadget', `You have no ${g.name}.`);

  if (g.place) {
    const spot = canPlace(state, 0.8, args.x ?? NaN, args.z ?? NaN, ctx.now);
    if (!spot.ok) return fail(spot.code, PLACE_MSG[spot.code]);
    const covered = state.plants.filter((p) => Math.hypot(p.x - args.x, p.z - args.z) <= g.radius);
    for (const p of covered) checkpoint(state, p, ctx.now, ctx.seed);
    spend(state, kind);
    state.effects.push({ id: `e${state.nextId++}`, kind, x: args.x, z: args.z, from: ctx.now, to: ctx.now + g.dur * 1000 });
    for (const p of covered) refresh(state, p, ctx.seed);
    return ok(`${g.name} placed! Nearby plants grow faster.`);
  }
  if (kind === 'rainJar') {
    for (const p of state.plants) checkpoint(state, p, ctx.now, ctx.seed);
    spend(state, kind);
    state.effects.push({ id: `e${state.nextId++}`, kind, from: ctx.now, to: ctx.now + g.dur * 1000 });
    for (const p of state.plants) refresh(state, p, ctx.seed);
    return ok('A tiny rain cloud follows your garden!');
  }
  if (kind === 'capyHorn') {
    settle(state, ctx);
    const ripe = state.plants.filter((p) => p.fruit);
    if (!ripe.length) return fail('nothing_ripe', 'Nothing is ripe yet.');
    spend(state, kind);
    let n = 0;
    for (const p of [...ripe]) { const r = harvest(state, p.id, ctx); if (!r.ok) break; n += r.items.length; }
    return ok(`TOOT! Bean harvested ${n} fruit.`, { count: n });
  }
  if (kind === 'growJuice') {
    const p = findPlant(state, args.plantId);
    if (!p) return fail('no_plant', 'Pick a growing plant.');
    if (p.fruit || ctx.now >= p.readyAt) return fail('ripe', 'It is already ripe!');
    spend(state, kind);
    p.ck = { at: ctx.now, done: p.work };
    p.readyAt = ctx.now;
    return ok('Glug glug... *burp*. Ready!');
  }
  if (kind === 'mysteryBox') {
    spend(state, kind);
    const rng = ctx.rng('box', state.stats.gadgets, state.nextId);
    const tier = weighted(rng(), MYSTERY_TIERS);
    const pool = CROPS.filter((c) => c.tier === tier && !c.unlock);
    const crop = pool[Math.floor(rng() * pool.length)];
    state.seeds[crop.id] = (state.seeds[crop.id] ?? 0) + 1;
    return ok(`The box giggles... a ${crop.name} seed!`, { crop: crop.id, tier });
  }
  if (kind === 'oopsShovel') {
    const p = findPlant(state, args.plantId);
    if (!p) return fail('no_plant', 'Pick a plant.');
    spend(state, kind);
    state.plants = state.plants.filter((x) => x !== p);
    state.seeds[p.crop] = (state.seeds[p.crop] ?? 0) + 1;
    recomputeBuddies(state, ctx);
    return ok('Oops! Seed returned.');
  }
  return fail('no_item', 'Unknown gadget.');
}

// ---- Grow All --------------------------------------------------------------

export function growAllQuote(state, now, seed) {
  let cost = 0, count = 0;
  for (const p of state.plants) {
    if (p.fruit || now >= p.readyAt) continue;
    const c = CROP[p.crop];
    const left = 1 - progressAt(state, p, now, seed);
    cost += Math.max(GROW_ALL_MIN, Math.ceil(left * c.fruits * c.value * GROW_ALL_FACTOR));
    count++;
  }
  return { cost, count };
}

export function growAll(state, quoted, ctx) {
  const q = growAllQuote(state, ctx.now, ctx.seed);
  if (!q.count) return fail('all_grown', 'Everything is already grown!');
  if (q.cost > quoted) return fail('quote_changed', 'The price changed. Check it again.');
  if (state.coins < q.cost) return fail('no_coins', 'Not enough coins.');
  state.coins -= q.cost;
  for (const p of state.plants) {
    if (p.fruit || ctx.now >= p.readyAt) continue;
    p.ck = { at: ctx.now, done: p.work };
    p.readyAt = ctx.now;
    p.boosted = true;
  }
  return ok(`Grew ${q.count} plants for ${q.cost.toLocaleString('en-US')} coins.`, { cost: q.cost });
}

// ---- Gus the Mihao: "Got any snacks?" ----------------------------------------

export function pityEligible(state, now) {
  return state.coins < PITY.maxCoins
    && Object.values(state.seeds).every((n) => !n)
    && state.plants.length === 0
    && state.basket.length === 0
    && now - (state.pityAt ?? 0) >= PITY.cooldownMs;
}

export function pity(state, ctx) {
  if (!pityEligible(state, ctx.now)) return fail('no_pity', 'Gus looks at you suspiciously. "You look fine to me!"');
  state.pityAt = ctx.now;
  state.coins += PITY.coins;
  state.seeds.carrot = (state.seeds.carrot ?? 0) + PITY.seeds;
  return ok(`Gus shares his snacks: ${PITY.seeds} ${CROP.carrot.name} seeds and ${PITY.coins} coins!`);
}

export { TIER_ORDER };
