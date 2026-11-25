// @ts-check
// Mihao meme layer: poses, speech lines, moments, Meme Points, the Official Inspection, duels and the weekly
// challenge. Cosmetic only: nothing here gives coins, gems, reputation, Season Points or $MGRD.

/**
 * Poses. an = the animation code sent to other players (0-7 are the game's own actions). clip = model clip name.
 * cost = Meme Points needed to unlock (0 = free for everyone).
 */
export const POSES = Object.freeze([
  { id: 'stance', an: 8, clip: 'stance', name: 'Official Stance', cost: 0 },
  { id: 'point', an: 9, clip: 'point', name: 'Point', cost: 0 },
  { id: 'sit', an: 10, clip: 'sit', name: 'Sit', cost: 0 },
  { id: 'shock', an: 11, clip: 'shock', name: 'Shocked', cost: 0 },
  { id: 'flex', an: 12, clip: 'flex', name: 'Count Money', cost: 30 },
  { id: 'dance', an: 13, clip: 'dance', name: 'Mihao Dance', cost: 60 },
]);
export const POSE = Object.freeze(Object.fromEntries(POSES.map((p) => [p.id, p])));
export const poseByAn = (an) => POSES.find((p) => p.an === an) ?? null;

/** Speech bubbles. Players pick from this list (no free text, so nothing needs moderating). */
export const LINES = Object.freeze([
  'mihao', 'any last words?', 'still mihao', 'mihao?', 'MIHAO!!', 'respect the official', 'i am inspecting', 'my beard is longer',
]);

/** Short scenes. pose = pose id, line = index into LINES, prop = something held or shown for a few seconds. */
export const MOMENTS = Object.freeze({
  rare: { pose: 'stance', line: 0, prop: null },
  rain: { pose: 'stance', line: 2, prop: 'umbrella' },
  storm: { pose: 'shock', line: 4, prop: 'umbrella' },
  stars: { pose: 'point', line: 3, prop: null },
  night: { pose: 'sit', line: 0, prop: null },
  heatwave: { pose: 'shock', line: 3, prop: null },
  frosty: { pose: 'shock', line: 2, prop: null },
  sale: { pose: 'flex', line: 5, prop: 'coins' },
  idle: { pose: 'point', line: 1, prop: null },
  stare: { pose: 'stance', line: 3, prop: null },
});
export const MOMENT_MS = 3_200;
export const MOMENT_COOLDOWN_MS = 45_000;
export const IDLE_MOMENT_MS = 60_000;
/** Selling at least this many fruit at once counts as "selling a lot". */
export const BIG_SALE_COUNT = 15;

/** Meme Points: how many each event gives, and the most one player can earn per UTC day. */
export const MEME_AWARD = Object.freeze({ rare: 3, stamp: 2, inspection: 15, duelWin: 5, duelWinBot: 2 });
export const MEME_DAY_CAP = 60;

/** Official Inspection: an inspector visits now and then. Pass with enough plants. */
export const INSPECTION = Object.freeze({ secs: 90, minGapMs: 15 * 60_000, maxGapMs: 25 * 60_000, firstGapMs: 4 * 60_000, minPlants: 3, reach: 4.5 });

/** Beard Battle and Pointing Contest. Results are luck or reaction time; nothing bought can affect them. */
export const DUEL = Object.freeze({
  kinds: Object.freeze({ beard: 'Beard Battle', point: 'Pointing Contest' }),
  range: 7, inviteMs: 15_000, cooldownMs: 45_000, goMinMs: 1_800, goMaxMs: 4_500, windowMs: 4_000,
});

/** Weekly meme challenge prompts (the same for everyone in a week). */
export const CHALLENGES = Object.freeze([
  { id: 'pose', title: 'Best garden pose', how: 'Pose mihao somewhere in your garden and take a photo.' },
  { id: 'harvest', title: 'Best harvest reaction', how: 'Record a clip of your reaction to a rare harvest.' },
  { id: 'weather', title: 'Worst weather, best face', how: 'Film mihao during rain or a Beard Storm.' },
  { id: 'duel', title: 'Funniest beard battle', how: 'Record a Beard Battle with a friend or with Gus.' },
  { id: 'inspect', title: 'Inspection fail', how: 'Capture the moment an Official Inspection goes wrong.' },
  { id: 'crew', title: 'Many mihao', how: 'Get as many mihao as you can into one picture.' },
]);
export const CHALLENGE_TAG = '#MihaoGarden';
