// @ts-check
// Crop table v3 (gametokenomics.md section 6.8.1). Times in seconds. Frozen: never mutated at import.

/**
 * @typedef {Object} Crop
 * @property {string} id
 * @property {string} name
 * @property {'common'|'uncommon'|'rare'|'legendary'|'mythical'|'prismatic'|'ornamental'} tier
 * @property {number} seed     seed price in coins
 * @property {number} radius   planting radius in metres
 * @property {number} grow     first grow, seconds
 * @property {number|null} regrow  regrow after harvest, seconds (null = single harvest)
 * @property {number} fruits   fruits per harvest
 * @property {number} value    base value per fruit
 * @property {string} family   model family used by the art pipeline
 * @property {number} baseHourly  base coins per hour per plant (before mutations)
 * @property {number} perM2       base coins per hour per square metre of soil
 * @property {string|null} unlock project needed to buy the seed
 */

const R = { common: 0.6, uncommon: 0.6, rare: 0.65, legendary: 0.7, mythical: 0.8, prismatic: 0.9, ornamental: 0.8 };

// id, name, tier, seed, grow, regrow, fruits, value, family
const ROWS = [
  ['carrot', 'Mihao Carrot', 'common', 10, 40, null, 1, 26, 'root'],
  ['strawberry', 'Whisker Strawberry', 'common', 910, 60, 30, 2, 10, 'berryBush'],
  ['blueberry', 'Scholar Blueberry', 'uncommon', 1800, 90, 45, 3, 13, 'berryBush'],
  ['bamboo', 'Lucky Bamboo', 'uncommon', 330, 120, null, 1, 440, 'grass'],
  ['tomato', 'Lantern Tomato', 'rare', 5600, 180, 90, 3, 41, 'vineFruit'],
  ['eggplant', 'Magistrate Eggplant', 'rare', 7400, 195, 95, 2, 86, 'vineFruit'],
  ['pepper', 'Firecracker Pepper', 'rare', 8400, 210, 100, 3, 68, 'vineFruit'],
  ['pumpkin', 'Fortune Pumpkin', 'rare', 2100, 270, null, 1, 2809, 'ground'],
  ['cauliflower', 'Beard Cauliflower', 'rare', 12000, 225, 105, 1, 299, 'brassica'],
  ['beanstalk', 'Whisker Beanstalk', 'rare', 12000, 240, 110, 4, 83, 'vineFruit'],
  ['cacao', 'Imperial Cacao', 'rare', 14000, 255, 115, 3, 132, 'tree'],
  ['cactus', 'Grumpy Cactus', 'rare', 18000, 270, 120, 2, 268, 'cactus'],
  ['watermelon', 'Banquet Watermelon', 'legendary', 9000, 480, null, 1, 11987, 'ground'],
  ['coconut', 'Official Coconut', 'legendary', 53000, 360, 180, 2, 576, 'palm'],
  ['mango', 'Golden Mango', 'legendary', 66000, 390, 190, 3, 507, 'tree'],
  ['nectarine', 'Courtyard Nectarine', 'legendary', 79000, 420, 200, 3, 640, 'tree'],
  ['pear', 'Longbeard Pear', 'legendary', 92000, 450, 210, 3, 784, 'tree'],
  ['avocado', 'Inspector Avocado', 'legendary', 110000, 480, 220, 2, 1408, 'tree'],
  ['banana', 'Mihao Banana', 'legendary', 120000, 510, 230, 4, 828, 'palm'],
  ['dragonfruit', 'Mandarin Dragonfruit', 'legendary', 130000, 540, 240, 2, 1920, 'cactus'],
  ['pinklily', 'Meow Lily', 'mythical', 610000, 720, 300, 2, 3712, 'flower'],
  ['pineapple', 'Crown Pineapple', 'mythical', 710000, 780, 330, 1, 9504, 'bromeliad'],
  ['kiwi', 'Furball Kiwi', 'mythical', 890000, 900, 360, 4, 3240, 'climber'],
  ['candyblossom', 'Paw Candy Blossom', 'prismatic', 3900000, 1080, 480, 3, 9600, 'blossom'],
  ['cherryblossom', 'Mihao Cherry Blossom', 'prismatic', 5300000, 1260, 540, 4, 10800, 'blossom'],
  ['sugarapple', 'Jade Sugar Apple', 'prismatic', 6600000, 1500, 600, 2, 30000, 'tree'],
  ['moonblossom', 'Moon Mihao Blossom', 'prismatic', 8200000, 1800, 720, 3, 30000, 'blossom'],
  ['orchid', "Minister's Orchid", 'ornamental', 100000, 900, 480, 1, 1500, 'flower'],
  ['starflower', 'Emperor Starflower', 'ornamental', 500000, 1800, 900, 1, 6000, 'flower'],
];

const UNLOCK = { orchid: 'greenhouse', starflower: 'observatory' };

/** @type {readonly Crop[]} */
export const CROPS = Object.freeze(ROWS.map(([id, name, tier, seed, grow, regrow, fruits, value, family]) => {
  const radius = R[tier];
  const area = 2 * Math.sqrt(3) * radius * radius; // hexagonal packing area per plant
  const baseHourly = regrow ? (fruits * value / regrow) * 3600 : ((value - seed) / grow) * 3600;
  return Object.freeze({ id, name, tier, seed, radius, grow, regrow, fruits, value, family, baseHourly, perM2: baseHourly / area, unlock: UNLOCK[id] ?? null });
}));

export const CROP = Object.freeze(Object.fromEntries(CROPS.map((c) => [c.id, c])));
export const TIER_ORDER = ['common', 'uncommon', 'rare', 'legendary', 'mythical', 'prismatic'];
export const tierIndex = (tier) => TIER_ORDER.indexOf(tier);

/** Neighbor buddies: within 2 m both grow 10% faster. Rivals only argue (no effect). */
export const BUDDY_PAIRS = [
  ['mango', 'banana'], ['beanstalk', 'tomato'], ['carrot', 'strawberry'], ['blueberry', 'pear'],
  ['cacao', 'coconut'], ['pumpkin', 'watermelon'], ['pepper', 'eggplant'], ['kiwi', 'pineapple'],
  ['cherryblossom', 'candyblossom'], ['moonblossom', 'pinklily'], ['avocado', 'nectarine'],
  ['cactus', 'dragonfruit'], ['bamboo', 'cauliflower'], ['sugarapple', 'orchid'],
];
export const RIVAL_PAIRS = [['tomato', 'eggplant'], ['cactus', 'watermelon']];
export const BUDDY_RANGE = 2;
export const BUDDY_BONUS = 1.1;

export const isBuddy = (a, b) => BUDDY_PAIRS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
