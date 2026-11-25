import test from 'node:test';
import assert from 'node:assert/strict';
import { keyed } from '../src/util/rng.js';
import { freshState } from '../src/rules/state.js';
import { refreshPeriods } from '../src/rules/quests.js';
import { plant, harvest } from '../src/rules/garden.js';
import { salePrice } from '../src/rules/economy.js';
import { buyEgg, hatch, petActions, trainPet, equipPet } from '../src/rules/pets.js';
import { buyHome, buyDecor, placeDecor, canPlaceDecor, rebirth, setAvatar, saleBonus, buyWear, avatarOf } from '../src/rules/estate.js';
import {
  claimCollection, collectionStatus, addRep, refreshOrders, deliverOrder, refreshContract, deliverContract,
  addSeasonXp, claimSeason, festivalAt, festivalHarvest, unlockIsland, acornSpots, pickAcorn, islandDay,
  trialStart, trialAct, trialOfDay, maybeSurprise, resolveSurprise, stickerKey,
} from '../src/rules/progress.js';
import { repNeeded, PET_LIMITS, ISLAND, TRIAL_GROW } from '../src/data/features.js';
import { toWorld } from '../src/world/village-layout.js';

const SEED = 777;
const NOW = Date.UTC(2026, 10, 10, 12); // a Tuesday
const ctxAt = (now, extra = {}) => ({ now, seed: SEED, rng: (...p) => keyed('s', 'p1', ...p), ...extra });
const garden = (now = NOW) => { const s = freshState(now); refreshPeriods(s, now, SEED); return s; };
const item = (crop, extra = {}) => ({ id: `x${Math.random()}`, crop, mass: 1, variant: 'normal', big: false, env: [], ripe: 0, star: false, ...extra });

test('eggs hatch after their timer into a pet that harvests ripe crops', () => {
  const s = garden();
  s.coins = 100_000;
  assert.equal(buyEgg(s, 'common', ctxAt(NOW)).code, 'mgrd', 'eggs are $MGRD-only');
  assert.ok(buyEgg(s, 'common', { ...ctxAt(NOW), allowCoins: true }).ok);
  assert.equal(hatch(s, s.eggs[0].id, ctxAt(NOW + 1000)).code, 'not_ready');
  assert.ok(hatch(s, s.eggs[0].id, ctxAt(NOW + 61_000)).ok);
  const pet = s.pets[0];
  assert.ok(['dog', 'bunny', 'bee'].includes(pet.kind));
  assert.equal(pet.equipped, true);
  if (pet.kind === 'bee') return; // bees water instead
  const t = NOW + 61_000;
  pet.last = t;
  const p = plant(s, 'carrot', 0, 0, ctxAt(t)).plant;
  const done = petActions(s, ctxAt(p.readyAt + 60_000));
  assert.ok(done.some((d) => d.did === 'harvest'));
  assert.ok(s.basket.length >= 1);
  assert.ok(pet.bond >= 1);
});

test('equip limit and training need bond and coins', () => {
  const s = garden();
  s.pets = Array.from({ length: 4 }, (_, i) => ({ id: `a${i}`, kind: 'dog', name: 'Pup', level: 0, bond: 0, equipped: i < PET_LIMITS.equipped, mode: 'speedy', last: NOW }));
  assert.equal(equipPet(s, 'a3').code, 'full');
  assert.equal(trainPet(s, 'a0').code, 'bond');
  s.pets[0].bond = 5; s.coins = 10_000;
  assert.ok(trainPet(s, 'a0').ok);
  assert.equal(s.pets[0].level, 1);
});

test('homes and rebirth stars raise every sale', () => {
  const s = garden();
  const it = item('carrot');
  const base = salePrice(s, it, NOW);
  s.coins = 250_000;
  assert.ok(buyHome(s).ok);
  assert.equal(saleBonus(s), 1.02);
  s.rebirths = 2;
  assert.ok(Math.abs(saleBonus(s) - 1.12) < 1e-9);
  assert.ok(salePrice(s, it, NOW) > base);
});

test('decor: bought, placed off the soil and away from the gate', () => {
  const s = garden();
  s.coins = 10_000;
  assert.equal(buyDecor(s, 'gnome').code, 'mgrd', 'decor is $MGRD-only');
  assert.ok(buyDecor(s, 'gnome', true).ok);
  assert.equal(canPlaceDecor(s, 'gnome', 0, 0).code, 'on_soil');
  assert.equal(canPlaceDecor(s, 'gnome', 0, 14.5).code, 'gate');
  assert.equal(canPlaceDecor(s, 'gnome', 30, 0).code, 'off_plot');
  assert.ok(placeDecor(s, 'gnome', 8, 0, 0).ok);
  assert.equal(s.decor.length, 1);
  assert.equal(placeDecor(s, 'gnome', 8, 0, 0).code, 'none');
});

test('album stickers and collections', () => {
  const s = garden();
  const p = plant(s, 'carrot', 0, 0, ctxAt(NOW)).plant;
  assert.ok(harvest(s, p.id, ctxAt(p.readyAt + 1)).ok);
  assert.equal(Object.keys(s.album).length, 1);
  assert.equal(stickerKey(s.basket[0]), Object.keys(s.album)[0]);
  assert.equal(collectionStatus(s).find((c) => c.id === 'first').progress, 1);
  assert.ok(claimCollection(s, 'first', ctxAt(NOW)).ok);
  assert.equal(claimCollection(s, 'first', ctxAt(NOW)).code, 'claimed');
  assert.equal(claimCollection(s, 'master', ctxAt(NOW)).code, 'not_done');
});

test('reputation levels never end and pay out', () => {
  const s = garden();
  const gems = s.gems;
  const ups = addRep(s, repNeeded(0) + repNeeded(1), ctxAt(NOW));
  assert.deepEqual(ups, [1, 2]);
  assert.ok(s.gems > gems);
});

test('villager orders: three on the board, delivery pays and refills', () => {
  const s = garden();
  refreshOrders(s, ctxAt(NOW));
  assert.equal(s.orders.length, 3);
  const o = s.orders[0];
  assert.equal(deliverOrder(s, o.id, ctxAt(NOW)).code, 'missing');
  for (let i = 0; i < o.count; i++) s.basket.push(item(o.crop, o.special ? { variant: 'golden', env: ['wet'] } : {}));
  const coins = s.coins;
  assert.ok(deliverOrder(s, o.id, ctxAt(NOW)).ok);
  assert.ok(s.coins > coins);
  assert.equal(s.orders.length, 3);
  refreshOrders(s, ctxAt(NOW + 3 * 3_600_000));
  assert.ok(s.orders.every((x) => x.until > NOW + 3 * 3_600_000));
});

test('weekly contract fills over several deliveries and pays a trophy', () => {
  const s = garden();
  refreshContract(s, ctxAt(NOW));
  for (const part of s.contract.parts) for (let i = 0; i < part.need; i++) s.basket.push(item(part.crop));
  assert.ok(deliverContract(s, ctxAt(NOW)).ok);
  assert.equal(s.contract.done, true);
  assert.equal(s.decorInv.trophy, 1);
});

test('season pass: tiers unlock with XP and pay once', () => {
  const s = garden();
  assert.equal(claimSeason(s, 1, ctxAt(NOW)).code, 'locked');
  addSeasonXp(s, 600, ctxAt(NOW));
  assert.ok(claimSeason(s, 1, ctxAt(NOW)).ok);
  assert.ok(claimSeason(s, 2, ctxAt(NOW)).ok);
  assert.equal(claimSeason(s, 2, ctxAt(NOW)).code, 'claimed');
});

test('festivals run Friday to Sunday and add tickets and festive mutations', () => {
  assert.equal(festivalAt(NOW), null);
  const fri = Date.UTC(2026, 10, 13, 12), sun = Date.UTC(2026, 10, 15, 20);
  assert.ok(festivalAt(fri));
  assert.equal(festivalAt(fri).key, festivalAt(sun).key);
  const s = garden(fri);
  const items = Array.from({ length: 40 }, () => item('carrot'));
  festivalHarvest(s, items, ctxAt(fri));
  assert.equal(s.festival.tickets, 40);
  assert.ok(items.some((i) => i.env.length));
});

test('Sky Island: balloon repair, daily acorns, no double picks', () => {
  const s = garden();
  assert.equal(unlockIsland(s, ctxAt(NOW)).code, 'missing');
  for (let i = 0; i < 10; i++) s.basket.push(item('pumpkin'));
  for (let i = 0; i < 5; i++) s.basket.push(item('bamboo'));
  assert.ok(unlockIsland(s, ctxAt(NOW)).ok);
  islandDay(s, ctxAt(NOW));
  const spot = acornSpots(s, s.island.day, SEED)[0];
  const pos = { x: ISLAND.center.x + spot.x, z: ISLAND.center.z + spot.z };
  assert.ok(pickAcorn(s, 0, pos, ctxAt(NOW)).ok);
  assert.equal(pickAcorn(s, 0, pos, ctxAt(NOW)).code, 'picked');
  assert.equal(pickAcorn(s, 1, pos, ctxAt(NOW)).code, 'far');
  assert.equal(s.island.acorns, 1);
});

test('daily challenge: equal resources, a medal on the first win', () => {
  const s = garden();
  trialStart(s, ctxAt(NOW));
  const def = trialOfDay(NOW);
  let t = NOW;
  if (def.id === 'market') {
    while (s.trial.coins < 100 && !s.trial.done) {
      trialAct(s, 'buy', 0, '', ctxAt(t)); trialAct(s, 'plant', 0, 'carrot', ctxAt(t));
      t += TRIAL_GROW.carrot * 1000; trialAct(s, 'harvest', 0, '', ctxAt(t));
    }
  } else {
    const order = Object.entries(s.trial.seeds).flatMap(([c, n]) => Array(n).fill(c));
    for (const c of order) { trialAct(s, 'plant', 0, c, ctxAt(t)); t += 20_000; trialAct(s, 'harvest', 0, '', ctxAt(t)); }
  }
  assert.equal(s.trial.done, true);
  assert.equal(s.medals, 1);
});

test('surprises: one at a time, resolved next to it', () => {
  const s = garden();
  const sp = maybeSurprise(s, 0, ctxAt(NOW));
  assert.ok(sp);
  assert.equal(maybeSurprise(s, 0, ctxAt(NOW + 1000)), null);
  if (sp.kind === 'alien') s.basket.push(item(sp.want));
  const w = toWorld(0, sp.x, sp.z);
  assert.ok(resolveSurprise(s, 0, w, ctxAt(NOW + 2000)).ok);
  assert.equal(s.surprise, null);
});

test('rebirth keeps pets and album, resets the farm, adds a star', () => {
  const s = garden();
  assert.equal(rebirth(s, ctxAt(NOW)).code, 'not_ready');
  s.soil = 6; s.home = 3; s.coins = 9e9; s.pets = [{ id: 'a1', kind: 'dog' }]; s.album = { 'carrot|normal||': 1 };
  assert.ok(rebirth(s, ctxAt(NOW)).ok);
  assert.equal(s.coins, 50);
  assert.equal(s.soil, 0);
  assert.equal(s.rebirths, 1);
  assert.equal(s.pets.length, 1);
  assert.equal(Object.keys(s.album).length, 1);
});

test('avatar: free colours, wardrobe items must be bought, special hair costs gems once', () => {
  const s = garden();
  assert.ok(setAvatar(s, { skin: '#c98e6a', hair: '#e8c070' }).ok);
  assert.equal(s.avatar.skin, '#c98e6a');
  assert.equal(setAvatar(s, { shirt: 'plaid_blue' }).code, 'not_owned');
  assert.equal(setAvatar(s, { hat: 'plaid_blue' }).code, 'bad');
  s.coins = 1000;
  assert.ok(buyWear(s, 'plaid_blue').ok);
  assert.equal(s.coins, 600);
  assert.equal(s.avatar.shirt, 'plaid_blue');
  assert.equal(buyWear(s, 'plaid_blue').code, 'owned');
  assert.ok(setAvatar(s, { shirt: 'plaid_red' }).ok);
  assert.equal(buyWear(s, 'crown').code, 'no_gems');
  assert.equal(buyWear(s, 'cap_gold').code, 'festival');
  s.gems = 70;
  assert.ok(setAvatar(s, { hair: '#ff8fc8' }).ok);
  assert.equal(s.gems, 10);
  assert.ok(setAvatar(s, { hair: null }).ok);
  assert.ok(setAvatar(s, { hair: '#ff8fc8' }).ok);
  assert.equal(s.gems, 10);
  assert.equal(setAvatar(s, { skin: '#00ff00' }).code, 'bad');
  // old saves stored colours per part: they fall back to the defaults
  s.avatar = { shirt: '#9DD3FF', outfit: '#3d6ea8', hatColor: '#e9d08a', hat: true };
  assert.equal(avatarOf(s).shirt, 'plaid_red');
});

test('season points: per-source and daily caps, weekly reset, nothing paid counts', async () => {
  const { addSeasonPoints, seasonPointsView } = await import('../src/rules/season-points.js');
  const s = garden();
  const t0 = Date.UTC(2026, 10, 9, 12); // a Monday
  assert.equal(addSeasonPoints(s, 'challenge', 40, t0), 40);
  assert.equal(addSeasonPoints(s, 'challenge', 40, t0), 0, 'challenge counts once a day');
  for (let i = 0; i < 5; i++) addSeasonPoints(s, 'tasks', 8, t0);
  assert.equal(seasonPointsView(s, t0).today.tasks, 25, 'tasks capped at 25');
  addSeasonPoints(s, 'coop', 50, t0);
  addSeasonPoints(s, 'discover', 50, t0);
  assert.equal(seasonPointsView(s, t0).dayTotal, 100, 'day capped at 100');
  assert.equal(addSeasonPoints(s, 'coins', 999, t0), 0, 'unknown sources (e.g. coins) never count');
  assert.equal(addSeasonPoints(s, 'challenge', 40, t0 + 86_400_000), 40, 'new day');
  const nextWeek = t0 + 7 * 86_400_000;
  assert.equal(seasonPointsView(s, nextWeek).points, 0);
  assert.equal(s.spPrev.points, 140);
});

test('$MGRD purchases: prices, grants, soil requirements and Grow All fairness', async () => {
  const { mgrdPrice, mgrdGrant } = await import('../src/rules/mgrd.js');
  const s = garden();
  const ctx = ctxAt(NOW);
  assert.equal(mgrdPrice(s, 'egg', 'rare', NOW, 1).mgrd, 2_000);
  assert.ok(mgrdGrant(s, 'egg', 'rare', ctx).ok);
  assert.equal(s.eggs.length, 1);
  assert.equal(mgrdPrice(s, 'decor', 'gnome', NOW, 1).mgrd, 600);
  mgrdGrant(s, 'decor', 'gnome', ctx);
  assert.equal(s.decorInv.gnome, 1);
  assert.equal(mgrdPrice(s, 'decor', 'trophy', NOW, 1).ok, false, 'earned-only decor is not for sale');
  assert.equal(mgrdPrice(s, 'wear', 'crown', NOW, 1).mgrd, 6_000, 'gem specials: 10 $MGRD per gem');
  assert.equal(mgrdPrice(s, 'hair', '#ff8fc8', NOW, 1).mgrd, 600);
  mgrdGrant(s, 'limited', 'founder_crown', ctx, 7);
  assert.equal(s.editions.founder_crown, 7);
  assert.ok(s.wardrobe.includes('founder_crown'));
  assert.equal(mgrdPrice(s, 'limited', 'founder_crown', NOW, 1).ok, false, 'one per player');
  // soil: $MGRD replaces only the coin price
  s.coins = 0;
  const lvl = s.soil;
  assert.ok(mgrdPrice(s, 'soil', '', NOW, 1).ok, 'level 1 has no other requirements');
  mgrdGrant(s, 'soil', '', ctx);
  assert.equal(s.soil, lvl + 1);
  assert.equal(s.coins, 0, 'no coins taken');
});

test('Grow All harvests earn Season Points too, within the daily cap', async () => {
  const { mgrdGrant } = await import('../src/rules/mgrd.js');
  const { festivalAt } = await import('../src/rules/progress.js');
  const { SP_CAPS } = await import('../src/rules/season-points.js');
  let t = NOW; while (!festivalAt(t)) t += 3_600_000;
  const s = garden();
  const p = plant(s, 'carrot', 0, 0, ctxAt(t)).plant;
  mgrdGrant(s, 'growall', '', ctxAt(t + 1000));
  assert.ok(harvest(s, p.id, ctxAt(t + 2000)).ok);
  const coop = s.sp?.today?.coop ?? 0;
  assert.ok(coop > 0 && coop <= SP_CAPS.coop, 'boosted harvest gives co-op points, capped');
});
