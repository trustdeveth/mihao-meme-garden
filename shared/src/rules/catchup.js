// @ts-check
// Offline progress on login and periodic upkeep while online.
import { applyStrikes } from './ripening.js';
import { settle } from './garden.js';
import { refreshPeriods } from './quests.js';
import { petActions } from './pets.js';
import { refreshOrders, refreshContract } from './progress.js';

const MAX_OFFLINE_MS = 8 * 3_600_000;

/** Bring a state from `from` to ctx.now. Returns a "While you were away" summary. */
export function catchUp(state, from, ctx) {
  refreshPeriods(state, ctx.now, ctx.seed);
  const start = Math.max(from, ctx.now - MAX_OFFLINE_MS);
  const strikes = start < ctx.now ? applyStrikes(state, start, ctx.now, ctx) : 0;
  const ripened = settle(state, ctx);
  const helped = petActions(state, ctx, true);
  refreshOrders(state, ctx);
  refreshContract(state, ctx);
  state.effects = state.effects.filter((e) => e.to > ctx.now - 60_000);
  const away = ctx.now - from;
  state.lastSeen = ctx.now;
  return { away, ripened: ripened.filter((p) => p.fruit).map((p) => ({ id: p.id, crop: p.crop, fruit: p.fruit.length })), strikes, helped: helped.length };
}

/** Called by the room tick for online players: strikes since last tick, new ripenings, period resets. */
export function upkeep(state, from, ctx) {
  refreshPeriods(state, ctx.now, ctx.seed);
  const strikes = applyStrikes(state, from, ctx.now, ctx);
  const ripened = settle(state, ctx);
  const helped = petActions(state, ctx, false);
  refreshOrders(state, ctx);
  refreshContract(state, ctx);
  const before = state.effects.length;
  state.effects = state.effects.filter((e) => e.to > ctx.now - 60_000);
  state.lastSeen = ctx.now;
  return { strikes, ripened, helped, effectsChanged: before !== state.effects.length };
}
