import test from 'node:test';
import assert from 'node:assert/strict';
import { CROPS, CROP, TIER_ORDER } from '../src/data/crops.js';
import { SOIL_LEVELS, WEATHER, WINDOW_MS, CARROT_STOCK, VARIANTS } from '../src/data/tables.js';
import { keyed } from '../src/util/rng.js';
import { freshState } from '../src/rules/state.js';
import { canPlace } from '../src/rules/placement.js';
import { weatherAt, windowIndex, windowStart } from '../src/rules/weather.js';
import { integrate, progressAt } from '../src/rules/growth.js';
import { resolveRipening, rollVariant, ripenessAt, stageMs } from '../src/rules/ripening.js';
import { moodLevel, bedHours, stockAt, sell, itemValue } from '../src/rules/economy.js';
import { plant, water, harvest, move, growAllQuote, growAll, pity, useGadget, expandSoil } from '../src/rules/garden.js';
import { genDaily, claimGift, refreshPeriods } from '../src/rules/quests.js';
import { catchUp } from '../src/rules/catchup.js';
import { applyAction } from '../src/rules/actions.js';

const SEED = 12345;
const NOW = Date.UTC(2026, 10, 10, 12);
const ctxAt = (now, secret = 's') => ({ now, seed: SEED, rng: (...parts) => keyed(secret, 'p1', ...parts) });
const garden = (now = NOW) => { const s = freshState(now); refreshPeriods(s, now, SEED); return s; };

/** First window index at or after `from` with the given weather kind. */
function findWindow(kind, from = windowIndex(NOW)) {
  for (let w = from; w < from + 5000; w++) if (weatherAt(SEED, w) === kind) return w;
  throw new Error(`no ${kind} window`);
}

test('crop table: 29 crops, values from the plan, frozen', () => {
  assert.equal(CROPS.length, 29);
  assert.equal(CROP.carrot.seed, 10);
  assert.equal(CROP.moonblossom.seed, 8_200_000);
  assert.equal(CROP.moonblossom.fruits, 3);
  assert.throws(() => { CROP.carrot.seed = 1; });
});

test('tier ladder holds per square metre: best of each tier < worst of the next', () => {
  for (let i = 0; i < TIER_ORDER.length - 1; i++) {
    const a = CROPS.filter((c) => c.tier === TIER_ORDER[i]).map((c) => c.perM2);
    const b = CROPS.filter((c) => c.tier === TIER_ORDER[i + 1]).map((c) => c.perM2);
    assert.ok(Math.max(...a) < Math.min(...b), `${TIER_ORDER[i]} -> ${TIER_ORDER[i + 1]}`);
  }
});

test('soil levels: areas match the plan and each contains the previous', () => {
  const areas = [30, 52, 84, 130, 192, 275.5, 374];
  SOIL_LEVELS.forEach((l, i) => {
    assert.ok(Math.abs(l.w * l.d - areas[i]) < 0.6, `level ${i}`);
    if (i) assert.ok(l.w >= SOIL_LEVELS[i - 1].w && l.d >= SOIL_LEVELS[i - 1].d);
  });
});

test('placement: exactly 0.9 x (r1 + r2) is allowed, 1 cm closer is rejected', () => {
  const s = garden();
  assert.ok(plant(s, 'carrot', 0, 0, ctxAt(NOW)).ok);
  const gap = 0.9 * (0.6 + 0.6);
  assert.equal(canPlace(s, 0.6, gap, 0, NOW).ok, true);
  const near = canPlace(s, 0.6, gap - 0.01, 0, NOW);
  assert.equal(near.ok, false);
  assert.equal(near.code, 'too_close');
});

test('placement: off soil vs locked soil', () => {
  const s = garden();
  assert.equal(canPlace(s, 0.6, 4.5, 0, NOW).code, 'locked_soil'); // inside the full-size soil
  assert.equal(canPlace(s, 0.6, 20, 0, NOW).code, 'off_soil');
  assert.equal(canPlace(s, 0.6, NaN, 0, NOW).code, 'bad_spot');
});

test('weather is deterministic and roughly follows the weights', () => {
  const w0 = windowIndex(NOW);
  assert.equal(weatherAt(SEED, w0), weatherAt(SEED, w0));
  const counts = Object.fromEntries(WEATHER.map((w) => [w.id, 0]));
  const N = 360 * 200;
  for (let w = w0; w < w0 + N; w++) counts[weatherAt(SEED, w)]++;
  assert.ok(counts.sunny / N > 0.4, 'sunny boosted by the forced-sunny rule');
  assert.ok(counts.stars > 0 && counts.storm > counts.stars);
});

test('growth: a rain window grows 1.3x faster than sunny', () => {
  const s = garden();
  const p = { crop: 'tomato', x: 0, z: 0, buddy: null };
  const wr = findWindow('rain'), ws = findWindow('sunny');
  const rain = integrate(s, p, SEED, windowStart(wr), 0, windowStart(wr) + 60_000);
  const sun = integrate(s, p, SEED, windowStart(ws), 0, windowStart(ws) + 60_000);
  assert.ok(Math.abs(rain.done - 78_000) < 1);
  assert.ok(Math.abs(sun.done - 60_000) < 1);
});

test('watering cuts the whole cycle to 65% and keeps progress', () => {
  const t0 = windowStart(findWindow('sunny')) + 1000;
  const s = garden(t0);
  const r = plant(s, 'carrot', 0, 0, ctxAt(t0));
  const p = r.plant;
  const unwatered = p.readyAt - t0;
  water(s, p.id, ctxAt(t0));
  assert.ok(p.readyAt - t0 < unwatered);
  assert.equal(p.work, 40_000 * 0.65);
});

test('buddies: within 2 m both get the bonus, moving apart removes it', () => {
  const s = garden();
  s.seeds = { mango: 1, banana: 1 };
  s.soil = 3;
  const a = plant(s, 'mango', -1, 0, ctxAt(NOW)).plant;
  const b = plant(s, 'banana', 0.5, 0, ctxAt(NOW)).plant;
  assert.equal(a.buddy, b.id);
  assert.equal(b.buddy, a.id);
  assert.ok(move(s, b.id, 3, 1.5, ctxAt(NOW + 1000)).ok);
  assert.equal(a.buddy, null);
});

test('ripening: exactly two weather rolls, ripe plants never roll again, outcomes stable', () => {
  const s = garden();
  const p = plant(s, 'carrot', 0, 0, ctxAt(NOW)).plant;
  let calls = 0;
  const counting = { ...ctxAt(p.readyAt + 5), rng: (...parts) => { const r = keyed('s', ...parts); return () => { calls++; return r(); }; } };
  assert.ok(resolveRipening(s, p, counting));
  assert.equal(calls, 2 + 3 * CROP.carrot.fruits); // 2 weather rolls + (mass, big, variant) per fruit
  const before = JSON.stringify(p.fruit);
  assert.equal(resolveRipening(s, p, ctxAt(p.readyAt + 3_600_000)), false);
  assert.equal(JSON.stringify(p.fruit), before);
});

test('ripening: offline resolution equals online resolution', () => {
  const s1 = garden(), s2 = garden();
  const p1 = plant(s1, 'carrot', 0, 0, ctxAt(NOW)).plant;
  const p2 = plant(s2, 'carrot', 0, 0, ctxAt(NOW)).plant;
  resolveRipening(s1, p1, ctxAt(p1.readyAt + 1000));
  resolveRipening(s2, p2, ctxAt(p2.readyAt + 8 * 3_600_000));
  assert.deepEqual(p1.fruit, p2.fruit);
});

test('ripening: a repeat crop gets fresh rolls each cycle; Wet + Chilled becomes Slushy', () => {
  const s = garden();
  s.seeds = { strawberry: 1 };
  const p = plant(s, 'strawberry', 0, 0, ctxAt(NOW)).plant;
  const t1 = p.readyAt + 1;
  assert.ok(harvest(s, p.id, ctxAt(t1)).ok);
  assert.equal(p.cycle, 1);
  assert.equal(p.work, 30_000);
  p.env = ['wet', 'chilled'];
  resolveRipening(s, p, ctxAt(p.readyAt + 1));
  assert.ok(p.fruit[0].env.includes('slushy'));
  assert.ok(!p.fruit[0].env.includes('wet'));
});

test('variants roughly match the odds', () => {
  const r = keyed('v');
  const n = 200_000, c = { normal: 0, silver: 0, golden: 0, rainbow: 0 };
  for (let i = 0; i < n; i++) c[rollVariant(r())]++;
  for (const v of VARIANTS) assert.ok(Math.abs(c[v.id] / n - v.p) < 0.004, v.id);
});

test('ripeness: stage is max(20 s, 50% of cycle); Fresh -> Juicy -> Peak', () => {
  const p = { crop: 'carrot', cycle: 0, readyAt: 1000 };
  assert.equal(stageMs(p), 20_000);
  assert.equal(ripenessAt(p, 1000), 0);
  assert.equal(ripenessAt(p, 21_000), 1);
  assert.equal(ripenessAt(p, 41_000), 2);
  assert.equal(stageMs({ crop: 'moonblossom', cycle: 1 }), 360_000);
});

test('market mood: one Moon Blossom fruit lowers demand a little; floor 50%; recovers 1 pt/min', () => {
  assert.ok(Math.abs(bedHours('moonblossom') - 30000 / CROP.moonblossom.baseHourly) < 1e-9);
  const s = garden();
  // 80 bamboo = 80 x 2-minute cycles = 2.67 bed-hours -> demand drops 1.7 pt per bed-hour = 4.53 pt
  s.basket = Array.from({ length: 80 }, (_, i) => ({ id: `i${i}`, crop: 'bamboo', mass: 1, variant: 'normal', big: false, env: [], ripe: 0 }));
  sell(s, 'all', ctxAt(NOW));
  assert.ok(Math.abs(moodLevel(s, 'bamboo', NOW) - (1 - 0.017 * 80 * 120 / 3600)) < 1e-9);
  // floor and recovery
  s.mood.bamboo = { lvl: 0.5, at: NOW };
  s.basket = [{ id: 'x', crop: 'bamboo', mass: 1, variant: 'normal', big: false, env: [], ripe: 0 }];
  sell(s, 'all', ctxAt(NOW));
  assert.equal(moodLevel(s, 'bamboo', NOW), 0.5);
  assert.ok(Math.abs(moodLevel(s, 'bamboo', NOW + 10 * 60_000) - 0.6) < 1e-9);
});

test('item value uses mass squared, variant, environment and ripeness', () => {
  const v = itemValue({ crop: 'carrot', mass: 2, variant: 'golden', env: ['wet', 'chilled'], ripe: 2 });
  assert.equal(Math.round(v), Math.round(26 * 4 * 8 * 4 * 1.3));
});

test('restock is deterministic; carrots always 10-20', () => {
  for (let r = 1000; r < 1300; r++) {
    const a = stockAt(SEED, r);
    assert.deepEqual(a, stockAt(SEED, r));
    assert.ok(a.seeds.carrot >= CARROT_STOCK.min && a.seeds.carrot <= CARROT_STOCK.max);
  }
});

test('grow all: quoted cost is never profitable and a stale quote is rejected', () => {
  const s = garden();
  s.coins = 1_000_000;
  const p = plant(s, 'carrot', 0, 0, ctxAt(NOW)).plant;
  const q = growAllQuote(s, NOW, SEED);
  assert.ok(q.cost >= 5 && q.cost >= CROP.carrot.value * 2.5 * 0.99);
  assert.equal(growAll(s, q.cost - 1, ctxAt(NOW)).code, 'quote_changed');
  assert.ok(growAll(s, q.cost, ctxAt(NOW)).ok);
  assert.equal(p.readyAt, NOW);
});

test('pity help: only when completely stuck, once per hour', () => {
  const s = garden();
  assert.equal(pity(s, ctxAt(NOW)).ok, false); // has seeds
  s.seeds = {}; s.coins = 5;
  assert.ok(pity(s, ctxAt(NOW)).ok);
  assert.equal(s.seeds.carrot, 3);
  s.seeds = {};
  assert.equal(pity(s, ctxAt(NOW + 60_000)).ok, false);
});

test('gadgets: sprinkler speeds covered plants; grow juice ripens instantly', () => {
  const t0 = windowStart(findWindow('sunny')) + 1000;
  const s = garden(t0);
  s.seeds = { tomato: 2 };
  s.soil = 2;
  const p = plant(s, 'tomato', 0, 0, ctxAt(t0)).plant;
  const before = p.readyAt;
  s.gadgets = { rocketSprinkler: 1, growJuice: 1 };
  assert.ok(useGadget(s, 'rocketSprinkler', { x: 1.6, z: 0 }, ctxAt(t0)).ok);
  assert.ok(p.readyAt < before);
  assert.ok(useGadget(s, 'growJuice', { plantId: p.id }, ctxAt(t0 + 1000)).ok);
  assert.equal(p.readyAt, t0 + 1000);
});

test('soil expansion: costs coins, level 2 needs the South Orchard delivery', () => {
  const s = garden();
  s.coins = 100_000;
  assert.ok(expandSoil(s, ctxAt(NOW)).ok);
  assert.equal(s.soil, 1);
  assert.equal(expandSoil(s, ctxAt(NOW)).code, 'requirements');
});

test('daily quests are deterministic and have positive targets', () => {
  const a = genDaily(SEED, '2026-11-10', 2), b = genDaily(SEED, '2026-11-10', 2);
  assert.deepEqual(a, b);
  for (const q of a) assert.ok(q.target > 0);
});

test('gift: once per day, streak continues on consecutive days', () => {
  const s = garden();
  assert.ok(claimGift(s, NOW).ok);
  assert.equal(claimGift(s, NOW + 1000).ok, false);
  assert.ok(claimGift(s, NOW + 86_400_000).ok);
  assert.equal(s.gift.streak, 2);
  assert.equal(s.gadgets.growJuice, 1);
});

test('full loop through applyAction: plant, harvest, sell', () => {
  const s = garden();
  const r = applyAction(s, 'plant', { crop: 'carrot', x: 0, z: 0 }, ctxAt(NOW));
  assert.ok(r.ok);
  const t = r.plant.readyAt + 1;
  assert.ok(applyAction(s, 'harvest', { id: r.plant.id }, ctxAt(t)).ok);
  assert.equal(s.basket.length, 1);
  const coins = s.coins;
  assert.ok(applyAction(s, 'sell', { all: true }, ctxAt(t)).ok);
  assert.ok(s.coins > coins);
});

test('catch-up after 8 hours ripens everything that was growing', () => {
  const s = garden();
  plant(s, 'carrot', 0, 0, ctxAt(NOW));
  const sum = catchUp(s, NOW, ctxAt(NOW + 8 * 3_600_000));
  assert.equal(sum.ripened.length, 1);
  assert.ok(s.plants[0].fruit);
  assert.equal(progressAt(s, s.plants[0], NOW + 9 * 3_600_000, SEED), 1);
});
