// @ts-check
// Meme Points, pose unlocks, the Official Inspection and the weekly challenge. Pure functions on player state.
// This module must never change coins, gems, reputation, Season Points or anything the token layer reads.
import { POSE, MEME_AWARD, MEME_DAY_CAP, INSPECTION, CHALLENGES } from '../data/memes.js';
import { ok, fail, dayKey, weekKey } from './state.js';
import { toLocal } from '../world/village-layout.js';

/** The player's meme data, created on first use. */
export function ensureMeme(state, now) {
  const m = (state.meme ??= { points: 0, total: 0, day: '', today: 0, unlocked: [], inspection: null, inspectAt: 0, inspections: 0, wins: 0 });
  if (now !== undefined && m.day !== dayKey(now)) { m.day = dayKey(now); m.today = 0; }
  return m;
}

/** Give Meme Points for one event, within the daily cap. Returns the points actually added. */
export function awardMeme(state, kind, now) {
  const n = MEME_AWARD[kind] ?? 0;
  if (!n) return 0;
  const m = ensureMeme(state, now);
  const add = Math.max(0, Math.min(n, MEME_DAY_CAP - m.today));
  m.today += add;
  m.points += add;
  m.total += add;
  return add;
}

export const hasPose = (state, id) => !!POSE[id] && (POSE[id].cost === 0 || !!state.meme?.unlocked?.includes(id));

export function unlockPose(state, id, ctx) {
  const p = POSE[id];
  if (!p) return fail('no_item', 'Unknown pose.');
  if (hasPose(state, id)) return fail('owned', 'You already have that pose.');
  const m = ensureMeme(state, ctx.now);
  if (m.points < p.cost) return fail('no_points', `That pose costs ${p.cost} Meme Points. You have ${m.points}.`);
  m.points -= p.cost;
  m.unlocked.push(id);
  return ok(`${p.name} unlocked. mihao.`);
}

/** Start or expire the Official Inspection for an online player. Returns true if a new one started. */
export function maybeInspection(state, ctx) {
  const m = ensureMeme(state, ctx.now);
  if (m.inspection && m.inspection.until <= ctx.now) m.inspection = null;
  if (m.inspection) return false;
  if (!m.inspectAt) { m.inspectAt = ctx.now + INSPECTION.firstGapMs; return false; }
  // never at the same time as a crow, gnome or alien
  if (ctx.now < m.inspectAt || (state.surprise && state.surprise.until > ctx.now)) return false;
  const rng = ctx.rng('inspection', Math.floor(ctx.now / 60_000));
  const x = (rng() - 0.5) * 12, z = 7 + rng() * 3;
  m.inspection = { x, z, until: ctx.now + INSPECTION.secs * 1000 };
  m.inspectAt = ctx.now + INSPECTION.minGapMs + rng() * (INSPECTION.maxGapMs - INSPECTION.minGapMs);
  return true;
}

/** Show the inspector your garden. */
export function inspect(state, slot, pos, ctx) {
  const m = ensureMeme(state, ctx.now);
  const s = m.inspection;
  if (!s || s.until < ctx.now) return fail('none', 'The inspector has left.');
  const l = toLocal(slot, pos.x, pos.z);
  if (Math.hypot(l.x - s.x, l.z - s.z) > INSPECTION.reach) return fail('far', 'Walk up to the inspector first.');
  m.inspection = null;
  const pass = (state.plants?.length ?? 0) >= INSPECTION.minPlants;
  if (!pass) return ok(`Inspection FAILED: fewer than ${INSPECTION.minPlants} plants. "Very not mihao."`, { pass: false });
  m.inspections += 1;
  const got = awardMeme(state, 'inspection', ctx.now);
  return ok(`Inspection passed! "mihao."${got ? ` +${got} Meme Points.` : ''}`, { pass: true });
}

/** This week's challenge. */
export function challengeOfWeek(now) {
  const week = weekKey(now);
  const n = Math.floor(Date.parse(`${week}T00:00:00Z`) / (7 * 86_400_000));
  return { week, ends: Date.parse(`${week}T00:00:00Z`) + 7 * 86_400_000, ...CHALLENGES[((n % CHALLENGES.length) + CHALLENGES.length) % CHALLENGES.length] };
}
