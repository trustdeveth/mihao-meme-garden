// @ts-check
// Eggs, pets and their garden help.
import { PETS, EGGS, PET_LIMITS, PET_TRAINING, PET_OFFLINE } from '../data/features.js';
import { ok, fail } from './state.js';
import { stat } from './quests.js';
import { harvest, water, settle } from './garden.js';
import { ripenessAt } from './ripening.js';
import { weighted } from '../util/rng.js';
import { trackCollections } from './progress.js';

const ensure = (s) => { s.pets ??= []; s.eggs ??= []; return s; };

export function buyEgg(state, id, ctx) {
  ensure(state);
  const e = EGGS[id];
  if (!e) return fail('no_item', 'Unknown egg.');
  // pet eggs are sold only for $MGRD (the server grants them after the on-chain payment; see rules/mgrd.js)
  if (!ctx?.allowCoins) return fail('mgrd', 'Pet eggs are sold for $MGRD. Connect a wallet to buy one.');
  if (state.eggs.length >= PET_LIMITS.incubators) return fail('full', 'Your incubators are full. Hatch an egg first.');
  if (state.pets.length + state.eggs.length >= PET_LIMITS.owned) return fail('full', 'Your pet house is full.');
  if (state.coins < e.cost) return fail('no_coins', 'Not enough coins.');
  state.coins -= e.cost;
  state.eggs.push({ id: `g${state.nextId++}`, kind: id, ready: ctx.now + e.hatch * 1000 });
  return ok(`${e.name} is warming up in your incubator!`);
}

export function hatch(state, eggId, ctx) {
  ensure(state);
  const egg = state.eggs.find((e) => e.id === eggId);
  if (!egg) return fail('no_item', 'Egg not found.');
  if (ctx.now < egg.ready) return fail('not_ready', 'This egg needs a little more time.');
  const kind = weighted(ctx.rng('hatch', egg.id)(), EGGS[egg.kind].odds);
  const pet = { id: `a${state.nextId++}`, kind, name: PETS[kind].name, level: 0, bond: 0, equipped: state.pets.filter((p) => p.equipped).length < PET_LIMITS.equipped, mode: 'speedy', last: ctx.now };
  state.pets.push(pet);
  state.eggs = state.eggs.filter((e) => e !== egg);
  state.xp += 20;
  trackCollections(state);
  return ok(`You hatched ${pet.name}!`, { pet: pet.kind });
}

export function equipPet(state, petId) {
  ensure(state);
  const p = state.pets.find((x) => x.id === petId);
  if (!p) return fail('no_item', 'Pet not found.');
  if (!p.equipped && state.pets.filter((x) => x.equipped).length >= PET_LIMITS.equipped) return fail('full', `Only ${PET_LIMITS.equipped} pets can help at once.`);
  p.equipped = !p.equipped;
  return ok(p.equipped ? `${p.name} is ready to help!` : `${p.name} is resting.`);
}

export function trainPet(state, petId) {
  ensure(state);
  const p = state.pets.find((x) => x.id === petId);
  if (!p) return fail('no_item', 'Pet not found.');
  const next = PET_TRAINING[p.level];
  if (!next) return fail('max', `${p.name} is already a Best Friend!`);
  if (p.bond < next.bond) return fail('bond', `Needs ${next.bond} bond (has ${p.bond}). Keep helping in the garden!`);
  if (state.coins < next.cost) return fail('no_coins', 'Not enough coins.');
  state.coins -= next.cost;
  p.level = next.level;
  return ok(`${p.name} is now a ${next.name}!`);
}

export function petMode(state, petId, mode) {
  ensure(state);
  const p = state.pets.find((x) => x.id === petId);
  if (!p) return fail('no_item', 'Pet not found.');
  p.mode = mode === 'patient' ? 'patient' : 'speedy';
  return ok(p.mode === 'patient' ? `${p.name} will wait for Peak ripeness.` : `${p.name} will harvest as soon as crops are ready.`);
}

export const petInterval = (p) => PETS[p.kind].interval * 1000 * (1 - 0.08 * p.level);

/** One helping action. Returns a description or null if there was nothing to do. */
function act(state, pet, t, ctx) {
  const c = { ...ctx, now: t };
  if (PETS[pet.kind].ability === 'water') {
    const target = state.plants.find((p) => !p.fruit && !p.watered && p.readyAt > t && p.cycleStart <= t);
    if (!target) return null;
    const r = water(state, target.id, c);
    return r.ok ? { pet: pet.id, did: 'water', plant: target.id, x: target.x, z: target.z } : null;
  }
  settle(state, c);
  const target = state.plants.find((p) => p.fruit && (pet.mode !== 'patient' || ripenessAt(p, t) >= 2));
  if (!target) return null;
  const { x, z } = target;
  const r = harvest(state, target.id, c); // pet harvests count for Season Points like your own (daily caps apply)
  return r.ok ? { pet: pet.id, did: 'harvest', plant: target.id, crop: target.crop, n: r.items.length, x, z } : null;
}

/**
 * Let equipped pets help. Online: called by the room tick. Offline: called on login with offline=true,
 * capped at 8 h and 24 actions per pet.
 */
export function petActions(state, ctx, offline = false) {
  ensure(state);
  const done = [];
  for (const pet of state.pets) {
    if (!pet.equipped) { pet.last = ctx.now; continue; }
    const iv = petInterval(pet);
    let t = Math.max(pet.last ?? ctx.now, ctx.now - PET_OFFLINE.maxMs);
    let n = 0;
    while (t + iv <= ctx.now && n < (offline ? PET_OFFLINE.maxActions : 2)) {
      t += iv;
      const r = act(state, pet, t, ctx);
      n++;
      if (r) { pet.bond += 1; done.push(r); stat(state, 'petHelps'); }
    }
    pet.last = n ? t : pet.last;
    if (ctx.now - pet.last > iv * 2) pet.last = ctx.now - iv; // do not bank unlimited time
  }
  return done;
}
