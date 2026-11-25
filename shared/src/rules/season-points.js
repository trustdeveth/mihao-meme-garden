// @ts-check
// Season Points: the only thing the weekly MGRD reward pools are computed from (gametokenomics.md 11 and 11.1).
// Points come from standardized activities only, with a daily cap per source and 100 per day in total.
// Coins, gems, purchases, pets, gadgets, home tier and garden size never add points.
import { dayKey, weekKey } from './state.js';

/** Daily caps per source (sum = 100). */
export const SP_CAPS = Object.freeze({
  challenge: 40, // Daily Silly Challenge: equal resources for everyone
  tasks: 25, // villager orders and the weekly contract
  coop: 20, // festival co-op: harvests during a village festival
  discover: 15, // Sky Acorn discoveries
});
export const SP_DAY_CAP = 100;
/** Points for one event of each kind (before the caps). */
export const SP_AWARD = Object.freeze({ challenge: 40, order: 8, contract: 25, festivalHarvest: 2, acorn: 3 });
export const SP_LABEL = Object.freeze({ challenge: 'Daily Challenge', tasks: 'Village orders & contract', coop: 'Festival co-op', discover: 'Sky Island discoveries' });

function ensure(state, now) {
  const wk = weekKey(now), dk = dayKey(now);
  const sp = (state.sp ??= { week: wk, points: 0, day: dk, today: {} });
  if (sp.week !== wk) { state.spPrev = { week: sp.week, points: sp.points }; sp.week = wk; sp.points = 0; }
  if (sp.day !== dk) { sp.day = dk; sp.today = {}; }
  return sp;
}

/** Award points from one source, respecting both caps. Returns the points actually added. */
export function addSeasonPoints(state, source, n, now) {
  if (!(source in SP_CAPS) || !(n > 0)) return 0;
  const sp = ensure(state, now);
  const used = sp.today[source] ?? 0;
  const dayUsed = Object.values(sp.today).reduce((a, b) => a + b, 0);
  const add = Math.max(0, Math.min(n, SP_CAPS[source] - used, SP_DAY_CAP - dayUsed));
  if (!add) return 0;
  sp.today[source] = used + add;
  sp.points += add;
  return add;
}

/** This week's and today's points (view model for the rewards panel). */
export function seasonPointsView(state, now) {
  const sp = ensure(state, now);
  return { week: sp.week, points: sp.points, today: { ...sp.today }, dayTotal: Object.values(sp.today).reduce((a, b) => a + b, 0) };
}
