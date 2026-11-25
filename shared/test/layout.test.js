// Walking rules: garden fences are solid except for the gate, and homes are solid once built.
import test from 'node:test';
import assert from 'node:assert/strict';
import { walkable, toWorld, PLOT, HOMES_AT, HOME_FOOT } from '../src/world/village-layout.js';
import { HOME_SPOT } from '../src/data/features.js';

const at = (slot, lx, lz) => { const w = toWorld(slot, lx, lz); return walkable(w.x, w.z); };

test('fences: sides, back and front are solid, the gate is open', () => {
  const hw = PLOT.w / 2, hd = PLOT.d / 2;
  assert.equal(at(0, 0, 0), true, 'middle of the garden');
  assert.equal(at(0, hw, 0), false, 'right fence');
  assert.equal(at(0, -hw, 3), false, 'left fence');
  assert.equal(at(0, 4, -hd), false, 'back fence');
  assert.equal(at(0, 6, hd), false, 'front fence beside the gate');
  assert.equal(at(0, 0, hd), true, 'the gate');
  assert.equal(at(0, 1.2, hd), true, 'inside the gate gap');
  assert.equal(at(0, hw + 3, 0), true, 'outside the fence');
});

test('walking straight out through a side fence is blocked at the fence line', () => {
  let blocked = false;
  for (let lx = 0; lx <= PLOT.w / 2 + 2; lx += 0.1) if (!at(3, lx, 2)) { blocked = true; break; }
  assert.ok(blocked);
});

test('a home is solid once built', () => {
  assert.equal(at(5, HOME_SPOT.x, HOME_SPOT.z), true);
  HOMES_AT.set(5, 5); // castle
  assert.equal(at(5, HOME_SPOT.x, HOME_SPOT.z), false);
  assert.equal(at(5, HOME_SPOT.x + HOME_FOOT[4].hx - 0.5, HOME_SPOT.z), false);
  assert.equal(at(5, HOME_SPOT.x + HOME_FOOT[4].hx + 1, HOME_SPOT.z + 4), true);
  HOMES_AT.delete(5);
  assert.equal(at(5, HOME_SPOT.x, HOME_SPOT.z), true);
});

test('a jump clears a fence, but not a house', () => {
  const w = toWorld(2, PLOT.w / 2, 0);
  assert.equal(walkable(w.x, w.z, 0.35, false, true), false, 'on the ground the fence blocks');
  assert.equal(walkable(w.x, w.z, 0.35, false, false), true, 'in the air the fence is cleared');
  HOMES_AT.set(2, 1);
  const h = toWorld(2, HOME_SPOT.x, HOME_SPOT.z);
  assert.equal(walkable(h.x, h.z, 0.35, false, false), false, 'a house is too high to jump');
  HOMES_AT.delete(2);
});
