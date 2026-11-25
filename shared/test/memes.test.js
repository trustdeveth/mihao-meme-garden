import test from 'node:test';
import assert from 'node:assert/strict';
import { freshState } from '../src/rules/state.js';
import { awardMeme, ensureMeme, hasPose, unlockPose, maybeInspection, inspect, challengeOfWeek } from '../src/rules/memes.js';
import { POSES, LINES, MOMENTS, POSE, MEME_DAY_CAP, INSPECTION, CHALLENGES } from '../src/data/memes.js';
import { applyAction } from '../src/rules/actions.js';
import { toWorld } from '../src/world/village-layout.js';
import { keyed } from '../src/util/rng.js';
import { CROPS } from '../src/data/crops.js';
import { HOMES } from '../src/data/features.js';

const NOW = Date.UTC(2026, 10, 24, 12);
const ctx = (now) => ({ now, seed: 7, rng: (...p) => keyed('s', 'p1', ...p) });
/** Everything the economy and the token layer read. */
const economy = (s) => JSON.stringify([s.coins, s.gems, s.xp, s.rep ?? null, s.sp ?? null, s.seeds, s.basket, s.gadgets, s.decorInv, s.daily, s.weekly]);

test('meme data: poses have their own animation codes, moments point at real poses and lines', () => {
  assert.equal(new Set(POSES.map((p) => p.an)).size, POSES.length);
  assert.ok(POSES.every((p) => p.an >= 8 && p.an <= 15), 'codes fit what the server accepts');
  assert.equal(POSES.filter((p) => p.cost === 0).length, 4);
  for (const m of Object.values(MOMENTS)) { assert.ok(POSE[m.pose]); assert.ok(LINES[m.line]); }
});

test('meme points: daily cap, reset next day, and nothing in the economy changes', () => {
  const s = freshState(NOW);
  const before = economy(s);
  let got = 0;
  for (let i = 0; i < 20; i++) got += awardMeme(s, 'inspection', NOW);
  assert.equal(got, MEME_DAY_CAP);
  assert.equal(awardMeme(s, 'rare', NOW + 86_400_000), 3);
  assert.equal(awardMeme(s, 'nonsense', NOW), 0);
  assert.equal(economy(s), before);
});

test('poses: free ones work, locked ones need Meme Points and are spent once', () => {
  const s = freshState(NOW);
  assert.ok(hasPose(s, 'sit'));
  assert.ok(!hasPose(s, 'dance'));
  assert.equal(unlockPose(s, 'dance', ctx(NOW)).code, 'no_points');
  ensureMeme(s, NOW).points = POSE.dance.cost + 5;
  const before = economy(s);
  assert.ok(applyAction(s, 'unlockPose', { id: 'dance' }, ctx(NOW)).ok);
  assert.equal(s.meme.points, 5);
  assert.ok(hasPose(s, 'dance'));
  assert.equal(unlockPose(s, 'dance', ctx(NOW)).code, 'owned');
  assert.equal(unlockPose(s, 'nope', ctx(NOW)).code, 'no_item');
  assert.equal(economy(s), before);
});

test('official inspection: waits first, must be close, passes only with enough plants, pays only Meme Points', () => {
  const s = freshState(NOW);
  assert.equal(maybeInspection(s, ctx(NOW)), false, 'not straight away');
  const t = NOW + INSPECTION.firstGapMs + 1;
  assert.equal(maybeInspection(s, ctx(t)), true);
  const spot = { ...s.meme.inspection };
  assert.equal(inspect(s, 0, { x: 999, z: 999 }, ctx(t)).code, 'far');
  const here = toWorld(0, spot.x, spot.z);
  const before = economy(s);
  const failed = inspect(s, 0, here, ctx(t));
  assert.equal(failed.pass, false);
  assert.equal(s.meme.points, 0);
  assert.equal(inspect(s, 0, here, ctx(t)).code, 'none');
  s.meme.inspectAt = t;
  s.plants = Array.from({ length: INSPECTION.minPlants }, (_, i) => ({ id: `p${i}` }));
  assert.equal(maybeInspection(s, ctx(t + 1)), true);
  const passed = inspect(s, 0, toWorld(0, s.meme.inspection.x, s.meme.inspection.z), ctx(t + 2));
  assert.equal(passed.pass, true);
  assert.equal(s.meme.points, 15);
  s.plants = [];
  assert.equal(economy(s), before);
});

test('weekly challenge: same all week, changes the next week', () => {
  const mon = Date.UTC(2026, 10, 23, 0, 1);
  const a = challengeOfWeek(mon), b = challengeOfWeek(mon + 6 * 86_400_000), c = challengeOfWeek(mon + 7 * 86_400_000);
  assert.equal(a.id, b.id);
  assert.notEqual(a.id, c.id);
  assert.ok(CHALLENGES.some((x) => x.id === a.id));
});

test('mihao names: every crop and home has its own short name, and saved-game ids are unchanged', () => {
  assert.equal(CROPS.length, 29);
  assert.equal(new Set(CROPS.map((c) => c.name)).size, CROPS.length);
  assert.ok(CROPS.every((c) => c.name.length <= 22), CROPS.filter((c) => c.name.length > 22).map((c) => c.name).join());
  assert.deepEqual(CROPS.slice(0, 4).map((c) => c.id), ['carrot', 'strawberry', 'blueberry', 'bamboo']);
  assert.deepEqual(HOMES.map((h) => h.id), ['shed', 'cottage', 'treehouse', 'windmill', 'castle']);
  assert.equal(new Set(HOMES.map((h) => h.name)).size, HOMES.length);
});
