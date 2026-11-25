// @ts-check
// Tiers, weather, mutations, variants, ripeness, soil, gadgets, gifts and vendors (gametokenomics.md 6.8).

export const TIERS = Object.freeze({
  common: { color: '#8C9AAB', stars: 1, restock: { p: 1, min: 2, max: 6 } },
  uncommon: { color: '#2FB463', stars: 2, restock: { p: 0.85, min: 2, max: 5 } },
  rare: { color: '#2F80ED', stars: 3, restock: { p: 0.6, min: 1, max: 4 } },
  legendary: { color: '#F2A20C', stars: 4, restock: { p: 0.3, min: 1, max: 2 } },
  mythical: { color: '#E0479E', stars: 5, restock: { p: 0.15, min: 1, max: 1 } },
  prismatic: { color: 'rainbow', stars: 6, restock: { p: 0.06, min: 1, max: 1 } },
  ornamental: { color: '#E0479E', stars: 5, restock: { p: 0.15, min: 1, max: 1 } },
});
/** Carrots are always in stock so nobody gets stuck. */
export const CARROT_STOCK = { min: 10, max: 20 };

export const WINDOW_MS = 240_000;   // weather window
export const RESTOCK_MS = 300_000;  // shop restock
export const WORLD_EPOCH = Date.UTC(2026, 0, 1);

/** Weather v3. roll = rolled at ripening; strikes = hit random growing plants during the window. */
export const WEATHER = Object.freeze([
  { id: 'sunny', name: 'Sunny', weight: 34, growth: 1, roll: null, strikes: null },
  { id: 'rain', name: 'Rain', weight: 20, growth: 1.3, roll: { env: 'wet', chance: 0.4 }, strikes: null },
  { id: 'night', name: 'Starry Night', weight: 15, growth: 1, roll: { env: 'moonlit', chance: 0.3 }, strikes: null },
  { id: 'frosty', name: 'Frosty', weight: 13, growth: 1, roll: { env: 'chilled', chance: 0.3 }, strikes: null },
  { id: 'heatwave', name: 'Heatwave', weight: 10, growth: 1.2, roll: { env: 'sunbaked', chance: 0.4 }, strikes: null },
  { id: 'storm', name: 'Beard Storm', weight: 5, growth: 1.3, roll: null, strikes: { n: 3, env: 'zapped' } },
  { id: 'stars', name: 'Shooting Stars', weight: 3, growth: 1, roll: null, strikes: { n: 2, env: 'starstruck' } },
]);
export const WEATHER_BY_ID = Object.freeze(Object.fromEntries(WEATHER.map((w) => [w.id, w])));

/** Environment bonuses added to the price factor (1 + sum). Slushy replaces Wet + Chilled. */
export const ENV = Object.freeze({ wet: 1, moonlit: 2, chilled: 2, sunbaked: 1, slushy: 5, zapped: 4, starstruck: 8, chill: 3, buttered: 3, groovy: 3, boba: 3, starlit: 3 });

export const VARIANTS = Object.freeze([
  { id: 'normal', p: 0.912, factor: 1 },
  { id: 'silver', p: 0.07, factor: 2 },
  { id: 'golden', p: 0.015, factor: 8 },
  { id: 'rainbow', p: 0.003, factor: 25 },
]);
export const VARIANT_FACTOR = Object.freeze(Object.fromEntries(VARIANTS.map((v) => [v.id, v.factor])));
export const BIG = { p: 0.025, mass: 2.5 };
export const MASS = { min: 0.8, max: 1.4 };

export const RIPENESS = Object.freeze([
  { id: 'fresh', m: 1 },
  { id: 'juicy', m: 1.15 },
  { id: 'peak', m: 1.3 },
]);

export const WATER_FACTOR = 0.65;
export const COPPER_WATER_FACTOR = 0.55;
export const BASKET_CAPACITY = 100;

/** Soil levels: rectangles centred on the plot origin (plot-local metres). Each contains the previous one. */
export const SOIL_LEVELS = Object.freeze([
  { area: 30, w: 6.0, d: 5.0, price: 0 },
  { area: 52, w: 8.0, d: 6.5, price: 5_000 },
  { area: 84, w: 10.5, d: 8.0, price: 50_000, requires: { species: 6, harvested: 40, items: { carrot: 3, strawberry: 3 }, name: 'South Orchard' } },
  { area: 130, w: 13.0, d: 10.0, price: 500_000 },
  { area: 192, w: 16.0, d: 12.0, price: 5_000_000, requires: { species: 12, items: { pumpkin: 3, eggplant: 3 }, name: 'Blossom Terrace' } },
  { area: 275.5, w: 19.0, d: 14.5, price: 50_000_000 },
  { area: 374, w: 22.0, d: 17.0, price: 250_000_000 },
]);

/** Garden gadgets (6.8.5). price null = reward only. */
export const GADGETS = Object.freeze({
  bubbleSprinkler: { name: 'Bubble Sprinkler', price: 12_000, tier: 'uncommon', place: true, radius: 2.5, mult: 1.5, dur: 240, kind: 'sprinkler' },
  rocketSprinkler: { name: 'Rocket Sprinkler', price: 50_000, tier: 'rare', place: true, radius: 4, mult: 2, dur: 240, kind: 'sprinkler' },
  capyHorn: { name: 'Capybara Horn', price: 30_000, tier: 'rare', uses: 2 },
  growJuice: { name: 'Grow Juice', price: null, tier: 'rare' },
  mysteryBox: { name: 'Mystery Seed Box', price: null, tier: 'rare' },
  oopsShovel: { name: 'Oops Shovel', price: 150_000, tier: 'legendary' },
  magnifier: { name: 'Nosy Magnifier', price: 400_000, tier: 'legendary', permanent: true },
  rainJar: { name: 'Rain Cloud in a Jar', price: 100_000, tier: 'legendary', dur: 120 },
});
export const SPRINKLER_OCCUPANT_RADIUS = 0.8;

/** Seven-day gift (6.8.8). */
export const GIFT7 = Object.freeze([
  { coins: 60, gems: 1 },
  { gadgets: { growJuice: 1 } },
  { gadgets: { bubbleSprinkler: 1 } },
  { coins: 180, gems: 4 },
  { gadgets: { mysteryBox: 1 } },
  { gadgets: { capyHorn: 1 } },
  { coins: 600, gems: 10, gadgets: { mysteryBox: 3 } },
]);

export const GROW_ALL_FACTOR = 2.5;
export const GROW_ALL_MIN = 5;
export const PITY = { maxCoins: 20, seeds: 3, coins: 30, cooldownMs: 3_600_000 };

export const MOOD = { dropPerBedHour: 0.017, recoverPerMin: 0.01, floor: 0.5 };

/** Vendors and their stalls (dialogue options are keyed for the client copy). */
export const VENDORS = Object.freeze({
  seeds: { name: 'Mo the Mihao', stall: 'seeds', options: ['browse', 'restock', 'bye'] },
  market: { name: 'Gus the Mihao', stall: 'market', options: ['appraise', 'sellHeld', 'sellAll', 'snacks', 'bye'] },
  gadgets: { name: 'Tinker Tess', stall: 'gadgets', options: ['browse', 'bye'] },
  pets: { name: 'Penny Paws', stall: 'pets', options: ['browse', 'bye'] },
});
