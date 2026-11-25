// @ts-check
// Stats, generated daily/weekly quests (6.8.8), the 7-day gift and period resets.
import { CROPS, CROP, tierIndex } from '../data/crops.js';
import { GIFT7, GADGETS } from '../data/tables.js';
import { keyed, randInt } from '../util/rng.js';
import { ok, fail, dayKey, weekKey } from './state.js';

/** Progress stage 0..5 from the best tier the player has planted. */
export const stageOf = (state) => Math.max(0, Math.min(5, state.stats.tierMax ?? 0));

const STAGE_COINS = [80, 400, 3_000, 25_000, 200_000, 1_500_000];
const EARN_TARGET = [300, 2_000, 20_000, 200_000, 2_000_000, 20_000_000];

/** Record a stat and advance matching quests. */
export function stat(state, key, n = 1, crop = null) {
  state.stats[key] = (state.stats[key] ?? 0) + n;
  for (const period of [state.daily, state.weekly]) {
    period.stats[key] = (period.stats[key] ?? 0) + n;
    for (const q of period.quests ?? []) {
      if (q.claimed || q.kind !== key) continue;
      if (q.crop && q.crop !== crop) continue;
      q.progress = Math.min(q.target, q.progress + n);
    }
  }
}

function questReward(stage, rng, weekly) {
  const coins = STAGE_COINS[stage] * (weekly ? 5 : 1);
  const gems = weekly ? 10 : randInt(rng, 1, 3);
  const pool = weekly ? ['rocketSprinkler', 'mysteryBox', 'capyHorn', 'growJuice'] : ['growJuice', 'bubbleSprinkler', 'mysteryBox'];
  const gadget = rng() < (weekly ? 1 : 0.45) ? pool[Math.floor(rng() * pool.length)] : null;
  return { coins, gems, gadgets: gadget ? { [gadget]: weekly ? 2 : 1 } : {} };
}

/** Three daily quests, deterministic for (seed, day, stage). */
export function genDaily(seed, key, stage) {
  const rng = keyed(seed, 'daily', key, stage);
  const crops = CROPS.filter((c) => c.tier !== 'ornamental' && tierIndex(c.tier) <= Math.max(0, stage));
  const crop = crops[Math.floor(rng() * crops.length)] ?? CROP.carrot;
  const a = ['harvest', 'water', 'bought'][Math.floor(rng() * 3)];
  const b = ['sold', 'earned', 'liked'][Math.floor(rng() * 3)];
  const targets = {
    harvest: 8 + stage * 4, water: 4 + stage * 2, bought: 5 + stage * 2,
    sold: 10 + stage * 6, earned: EARN_TARGET[stage], liked: 2,
  };
  return [
    { id: 'd1', kind: 'planted', crop: crop.id, target: randInt(rng, 3, 6), progress: 0, claimed: false, reward: questReward(stage, rng, false) },
    { id: 'd2', kind: a === 'harvest' ? 'harvested' : a === 'water' ? 'watered' : 'bought', crop: null, target: targets[a], progress: 0, claimed: false, reward: questReward(stage, rng, false) },
    { id: 'd3', kind: b, crop: null, target: targets[b], progress: 0, claimed: false, reward: questReward(stage, rng, false) },
  ];
}

export function genWeekly(seed, key, stage) {
  const rng = keyed(seed, 'weekly', key, stage);
  const mid = ['mutated', 'gadgets'][Math.floor(rng() * 2)];
  return [
    { id: 'w1', kind: 'harvested', crop: null, target: 60 + stage * 40, progress: 0, claimed: false, reward: questReward(stage, rng, true) },
    { id: 'w2', kind: mid, crop: null, target: mid === 'mutated' ? 8 + stage * 3 : 3, progress: 0, claimed: false, reward: questReward(stage, rng, true) },
    { id: 'w3', kind: 'earned', crop: null, target: EARN_TARGET[stage] * 6, progress: 0, claimed: false, reward: questReward(stage, rng, true) },
  ];
}

/** Daily/weekly resets (UTC). Stock and weather are global and not stored per player. */
export function refreshPeriods(state, now, seed) {
  const d = dayKey(now), w = weekKey(now), stage = stageOf(state);
  if (state.daily.key !== d) state.daily = { key: d, stats: {}, quests: genDaily(seed, d, stage) };
  if (state.weekly.key !== w) state.weekly = { key: w, stats: {}, quests: genWeekly(seed, w, stage) };
}

export function grant(state, reward) {
  state.coins += reward.coins ?? 0;
  state.gems += reward.gems ?? 0;
  for (const [kind, n] of Object.entries(reward.gadgets ?? {})) {
    const g = GADGETS[kind];
    if (g?.permanent) state.tools[kind] = true;
    else state.gadgets[kind] = (state.gadgets[kind] ?? 0) + n * (g?.uses ?? 1);
  }
}

export function claimQuest(state, id, weekly) {
  const q = (weekly ? state.weekly : state.daily).quests.find((x) => x.id === id);
  if (!q) return fail('no_quest', 'Quest not found.');
  if (q.claimed) return fail('claimed', 'Already claimed.');
  if (q.progress < q.target) return fail('not_done', 'Not finished yet.');
  q.claimed = true;
  grant(state, q.reward);
  state.xp += weekly ? 120 : 30;
  return ok('Quest reward claimed!', { reward: q.reward });
}

/** Seven-day gift: once per UTC day; a missed day restarts the streak. */
export function claimGift(state, now) {
  const today = dayKey(now), yesterday = dayKey(now - 86_400_000);
  if (state.gift.last === today) return fail('claimed', 'Today’s gift is already claimed. Come back tomorrow!');
  state.gift.streak = state.gift.last === yesterday ? (state.gift.streak % 7) + 1 : 1;
  state.gift.last = today;
  const reward = GIFT7[state.gift.streak - 1];
  grant(state, reward);
  return ok(`Day ${state.gift.streak} gift claimed!`, { reward, day: state.gift.streak });
}
