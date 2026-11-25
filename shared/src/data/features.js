// @ts-check
// Data for the Phase 2/3 features: pets, homes, decor, collections, reputation, orders, contracts,
// seasons, festivals, Sky Island, rebirth, daily challenges, surprises and avatars.

export const PETS = Object.freeze({
  dog: { name: 'Patch the Pup', ability: 'harvest', interval: 30, color: '#c98e5a' },
  bunny: { name: 'Clover Bunny', ability: 'harvest', interval: 24, color: '#f2ead8' },
  capybara: { name: 'Bean the Capybara', ability: 'harvest', interval: 18, color: '#9a6a42' },
  bee: { name: 'Bumble Buddy', ability: 'water', interval: 20, color: '#f2c84a' },
  turtle: { name: 'Moss Turtle', ability: 'harvest', interval: 15, color: '#5a8a4a' },
});

export const EGGS = Object.freeze({
  common: { name: 'Common Egg', cost: 1_200, hatch: 60, color: '#f3ead6', odds: [['dog', 0.6], ['bunny', 0.3], ['bee', 0.1]] },
  rare: { name: 'Rare Egg', cost: 18_000, hatch: 180, color: '#9DD3FF', odds: [['capybara', 0.5], ['bee', 0.3], ['turtle', 0.2]] },
  legendary: { name: 'Legendary Egg', cost: 120_000, hatch: 360, color: '#FFD84A', odds: [['turtle', 0.6], ['capybara', 0.4]] },
});
export const PET_LIMITS = { incubators: 2, equipped: 3, owned: 20 };
export const PET_TRAINING = Object.freeze([
  { level: 1, name: 'Trusted Helper', bond: 5, cost: 10_000 },
  { level: 2, name: 'Garden Partner', bond: 20, cost: 100_000 },
  { level: 3, name: 'Best Friend', bond: 60, cost: 1_000_000 },
]);
export const PET_OFFLINE = { maxActions: 24, maxMs: 8 * 3_600_000 };

/** Homes at the back of the plot with a permanent sell bonus (gametokenomics.md 6.8.6). */
export const HOMES = Object.freeze([
  { tier: 1, id: 'shed', name: "Clerk's Hut", cost: 250_000, bonus: 0.02 },
  { tier: 2, id: 'cottage', name: "Scholar's Courtyard", cost: 5_000_000, bonus: 0.04 },
  { tier: 3, id: 'treehouse', name: "Magistrate's Treehouse", cost: 75_000_000, bonus: 0.07 },
  { tier: 4, id: 'windmill', name: "Minister's Windmill", cost: 400_000_000, bonus: 0.10 },
  { tier: 5, id: 'castle', name: 'Imperial Sky Palace', cost: 2_000_000_000, bonus: 0.15 },
]);
export const HOME_SPOT = { x: 0, z: -12.2 }; // plot-local, behind the soil (clear of even the largest soil)
/** Egg nests sit in a row to the right of the home. */
export const NEST_SPOT = { x: 4.9, z: -11.2, step: 1.15 };

/** Decorations (coin sink, free placement). model = prop file id. */
export const DECOR = Object.freeze({
  crate: { name: 'Farm Crate', price: 1_000, tier: 'common', model: 'crate', r: 0.5 },
  rockpile: { name: 'Mossy Rock', price: 1_200, tier: 'common', model: 'rock0', r: 0.7 },
  flowerbed: { name: 'Flower Patch', price: 1_500, tier: 'common', model: 'flowers', r: 0.8 },
  shrub: { name: 'Round Shrub', price: 1_800, tier: 'common', model: 'bush', r: 0.7 },
  bench: { name: 'Garden Bench', price: 2_500, tier: 'uncommon', model: 'bench', r: 0.9 },
  lamp: { name: 'Lamp Post', price: 3_000, tier: 'uncommon', model: 'lamp', r: 0.4 },
  gnome: { name: 'Garden Gnome', price: 8_000, tier: 'uncommon', model: 'gnome', r: 0.4 },
  birdbath: { name: 'Bird Bath', price: 12_000, tier: 'rare', model: 'birdbath', r: 0.6 },
  scarecrow: { name: 'Scarecrow', price: 20_000, tier: 'rare', model: 'scarecrow', r: 0.6 },
  arch: { name: 'Flower Arch', price: 35_000, tier: 'rare', model: 'arch', r: 1.2 },
  oak: { name: 'Shade Tree', price: 60_000, tier: 'legendary', model: 'tree_round', r: 1.4 },
  minimill: { name: 'Little Windmill', price: 150_000, tier: 'legendary', model: 'minimill', r: 1.0 },
  fountain: { name: 'Stone Fountain', price: 400_000, tier: 'mythical', model: 'fountain', r: 3.0, scale: 0.45 },
  goldgnome: { name: 'Golden Gnome', price: 5_000_000, tier: 'prismatic', model: 'goldgnome', r: 0.45 },
  // $MGRD only: limited drop and Garden Club perk
  s1_golden_gnome: { name: 'Season 1 Golden Gnome', price: null, tier: 'prismatic', model: 'goldgnome', scale: 1.25, r: 0.55, limited: true },
  club_lantern: { name: 'Garden Club Lantern', price: null, tier: 'legendary', model: 'lamp', scale: 1.15, r: 0.45 },
  // earned only (surprises, festivals, contracts)
  feather: { name: 'Crow Feather Totem', price: null, tier: 'rare', model: 'feathertotem', r: 0.4 },
  festivalflag: { name: 'Festival Bunting', price: null, tier: 'rare', model: 'bunting', r: 1.0 },
  trophy: { name: 'Contract Trophy', price: null, tier: 'legendary', model: 'trophy', r: 0.5 },
});
export const DECOR_LIMIT = 40;

/** Collection badges: one-time rewards and titles. */
export const COLLECTIONS = Object.freeze([
  { id: 'first', name: 'First Harvest', need: { harvested: 1 }, gems: 5, title: null },
  { id: 'botanist', name: 'Curious Botanist', need: { species: 10 }, gems: 20, title: 'Curious Botanist' },
  { id: 'curator', name: 'Mutation Curator', need: { variants: ['silver', 'golden', 'rainbow'] }, gems: 35, title: 'Mutation Curator' },
  { id: 'weather', name: 'Weather Watcher', need: { envs: ['wet', 'moonlit', 'chilled', 'sunbaked'] }, gems: 35, title: 'Weather Watcher' },
  { id: 'giant', name: 'Something Enormous', need: { big: 1 }, gems: 15, title: 'Gentle Giant' },
  { id: 'pets', name: 'A Friend of Every Kind', need: { petSpecies: 5 }, gems: 30, title: 'Friend of the Garden' },
  { id: 'master', name: 'The Complete Garden', need: { species: 27 }, gems: 60, title: 'Master Botanist' },
  { id: 'stickers', name: 'Sticker Fan', need: { stickers: 100 }, gems: 40, title: 'Sticker Fan' },
  { id: 'home', name: 'Home Sweet Home', need: { home: 1 }, gems: 20, title: null },
  { id: 'decorator', name: 'Decorator', need: { decorPlaced: 10 }, gems: 20, title: 'Garden Designer' },
  { id: 'island', name: 'Island Explorer', need: { islandDays: 5 }, gems: 25, title: 'Sky Explorer' },
  { id: 'hero', name: 'Village Hero', need: { reputation: 10 }, gems: 50, title: 'Village Hero' },
]);

/** Reputation: endless levels. Points needed to go from level k to k+1. */
export const repNeeded = (level) => Math.round(60 * Math.pow(level + 1, 1.35));

export const VILLAGERS = ['Granny Plum', 'Farmer Joe', 'Little Pip', 'Chef Basil', 'Mayor Turnip', 'Professor Sprout', 'Auntie Fig', 'Captain Puff'];
export const ORDER_SLOTS = 3;
export const ORDER_MS = 2 * 3_600_000;

/** Seasons: 6 weeks each, 30 tiers of free rewards. */
export const SEASON_MS = 42 * 86_400_000;
export const SEASON_NAMES = ['Garden Party', 'Space Garden', 'Haunted Harvest', 'Beach Party', 'Candy Kingdom', 'Moonlight Picnic'];
export const SEASON_TIER_XP = 250;
export const SEASON_TIERS = 30;
export function seasonReward(tier) {
  if (tier === SEASON_TIERS) return { gems: 50, title: 'Season Champion', decor: { trophy: 1 } };
  if (tier % 10 === 0) return { gems: 25, gadgets: { rocketSprinkler: 2 } };
  if (tier % 5 === 0) return { gems: 15, decor: { gnome: 1 } };
  if (tier % 3 === 0) return { gadgets: { mysteryBox: 1 } };
  if (tier % 2 === 0) return { gems: 5 };
  return { coinsStage: 1 };
}

/** Weekly festivals (48 h, Friday-Sunday UTC). */
export const FESTIVALS = Object.freeze([
  { id: 'capybara', name: 'Capybara Cloudburst', env: 'chill', sky: '#9fd0ef', particle: 'rain' },
  { id: 'popcorn', name: 'Popcorn Blizzard', env: 'buttered', sky: '#f6e6b8', particle: 'popcorn' },
  { id: 'disco', name: 'Disco Fog', env: 'groovy', sky: '#c8a8f2', particle: 'disco' },
  { id: 'boba', name: 'Bubble Tea Monsoon', env: 'boba', sky: '#e8c8a8', particle: 'boba' },
  { id: 'moonlight', name: 'Moonlight Bloom', env: 'starlit', sky: '#3a3f80', particle: 'stars' },
]);
export const FESTIVAL_MUTATION_CHANCE = 0.15;
export const FESTIVAL_BONUS = 3; // added to the environment factor while the festival runs
export const FESTIVAL_SHOP = Object.freeze({
  festivalflag: { kind: 'decor', price: 25 },
  cap_gold: { kind: 'wear', price: 40 },
  plaid_pink: { kind: 'wear', price: 30 },
  growJuice: { kind: 'gadget', price: 12 },
  mysteryBox: { kind: 'gadget', price: 15 },
});

/** Sky Island (6.8.9). */
export const ISLAND = {
  center: { x: 0, z: -270 }, radius: 30,
  unlock: { pumpkin: 10, bamboo: 5 },
  acornsPerDay: 10, acornCap: 500,
  shop: { growJuice: 4, mysteryBox: 6, capyHorn: 10, rocketSprinkler: 15, seed_kiwi: 60, seed_cherryblossom: 300 },
};

/** Promotion (the game's prestige reset; ids and state still call it rebirth). */
export const REBIRTH = { soil: 6, home: 3, bonusPerStar: 0.05, maxStars: 10 };

/** Daily Silly Challenge: three formats rotating by day; equal resources for everyone. */
export const TRIALS = Object.freeze([
  { id: 'speed', name: 'Small Plot, Big Plans', beds: 3, seeds: { carrot: 6 }, coins: 0, goal: { harvest: 6 }, secs: 120 },
  { id: 'mix', name: 'A Little of Everything', beds: 2, seeds: { carrot: 1, strawberry: 1, blueberry: 1 }, coins: 0, goal: { species: 3 }, secs: 150 },
  { id: 'market', name: 'Market-Day Mindset', beds: 2, seeds: {}, coins: 40, goal: { coins: 100 }, secs: 180, buy: 10, sell: 16 },
]);
export const TRIAL_GROW = { carrot: 10, strawberry: 14, blueberry: 18 };
export const TRIAL_REWARD = { gems: 10, reputation: 30 };

/** Silly surprises: one every 6-12 minutes while online. */
export const SURPRISES = Object.freeze({
  crow: { name: 'Crow Heist', secs: 60, reward: { decor: { feather: 1 }, reputation: 10 } },
  gnome: { name: 'Gnome Parade', secs: 60, reward: { decor: { gnome: 1 }, reputation: 10 } },
  alien: { name: 'Lost Alien', secs: 120, reward: { gems: 8, reputation: 20 } },
});

/**
 * Avatar: the farmer's skin and hair colours, and wardrobe items for four slots.
 * Colour null = the model's own painted colour. Items with `gems` cost gems; `special` items have a finish
 * (gold, rainbow, glow, galaxy) and are the expensive show-off pieces. price null = festival tickets only.
 */
export const AVATAR = {
  // fur colours shown in the wardrobe (null = the original ginger face)
  fur: [null, '#f4efe6', '#ecd3a6', '#e0701f', '#a0612e', '#5a3a26', '#9a9ca6', '#2c2a2e', '#f2a8c0', '#86b2e8', '#c3a0ee', '#8fd6a0', '#f2c94c'],
  // every fur colour that may be saved: the ones above, plus those saved before the cat had fur colours
  skin: [null, '#f4efe6', '#ecd3a6', '#e0701f', '#a0612e', '#5a3a26', '#9a9ca6', '#2c2a2e', '#f2a8c0', '#86b2e8', '#c3a0ee', '#8fd6a0', '#f2c94c', '#f6d2b5', '#e8b48e', '#c98e6a', '#a86a48', '#7a4a32', '#55311f'],
  hair: [null, '#2b1a12', '#7a4a26', '#b8763a', '#e8c070', '#c0392b', '#f2ead8', '#aeb4c0', '#ff8a2a', '#2e9b5e', '#c8202a', '#3a4a9a', '#17151b'],
  beards: [
    { id: 'classic', name: 'Classic Mihao' }, { id: 'long', name: 'Grand Master' }, { id: 'bushy', name: 'Wise Cloud' },
    { id: 'curly', name: 'Smug Curls' }, { id: 'braid', name: 'Gold Braids' }, { id: 'short', name: 'Short and Tidy' },
  ],
  premiumHair: { '#ff8fc8': 60, '#5fb8ff': 60, '#7ddc5a': 60, '#b07aff': 80 },
};
export const WEAR_SLOTS = ['hat', 'shirt', 'pants', 'shoes'];
export const WEAR = Object.freeze({
  // hats (model = which hat mesh; 'bare' shows none, so the ears and eyebrows are in full view)
  bare: { slot: 'hat', name: 'No Hat', price: 0, model: 'bare', color: null },
  straw: { slot: 'hat', name: 'Official Hat', price: 0, model: 'straw', color: null },
  cap_red: { slot: 'hat', name: 'Red Cap', price: 600, model: 'cap', color: '#d93a3a' },
  cap_blue: { slot: 'hat', name: 'Blue Cap', price: 600, model: 'cap', color: '#2f6fd0' },
  beanie: { slot: 'hat', name: 'Cozy Beanie', price: 1_500, model: 'beanie', color: '#7c3aed' },
  bucket: { slot: 'hat', name: 'Bucket Hat', price: 2_500, model: 'bucket', color: '#5a9a4a' },
  cowboy: { slot: 'hat', name: 'Ranger Hat', price: 8_000, model: 'cowboy', color: '#B8925A' },
  tophat: { slot: 'hat', name: 'Fancy Top Hat', price: 40_000, model: 'tophat', color: '#26222a' },
  sunflower: { slot: 'hat', name: 'Sunflower Sunhat', price: 150_000, model: 'sunflower', color: '#f6e7b4', special: true },
  cap_gold: { slot: 'hat', name: 'Golden Festival Cap', price: null, model: 'cap', color: '#ffcf40', finish: 'gold', special: true },
  crown: { slot: 'hat', name: 'Royal Crown', gems: 600, model: 'crown', color: '#ffcf40', finish: 'gold', special: true },
  mandarin: { slot: 'hat', name: 'Red Dome Cap', price: 0, model: 'mandarin', color: null },
  ghost_hood: { slot: 'hat', name: 'Ghost Hood', price: 1_500, model: 'ghost', color: null },
  lime_hood: { slot: 'hat', name: 'Lime Zigzag Hood', price: 2_500, model: 'lime', color: null },
  headband: { slot: 'hat', name: 'Shadow Headband', price: 3_000, model: 'headband', color: null },
  sailor_hat: { slot: 'hat', name: 'Sailor Hat', price: 4_000, model: 'sailor', color: null },
  mohawk: { slot: 'hat', name: 'Pink Mohawk', price: 6_000, model: 'mohawk', color: null },
  monkey_hood: { slot: 'hat', name: 'Monkey Hood', price: 8_000, model: 'monkey', color: null, coversEars: true },
  red_hood: { slot: 'hat', name: 'Snug Red Hood', price: 12_000, model: 'redhood', color: null, coversEars: true },
  captain_cap: { slot: 'hat', name: "Captain's Cap", price: 25_000, model: 'captain', color: null },
  phoenix_hood: { slot: 'hat', name: 'Phoenix Hood', price: 120_000, model: 'phoenix', color: null, coversEars: true, special: true },
  // meme outfits: each has its own shape (model); the colour-only items keep the red jacket's shape
  top_ghost: { slot: 'shirt', name: 'Ghost Hoodie', price: 1_500, model: 'ghost', color: null },
  top_lime: { slot: 'shirt', name: 'Lime Zigzag Hoodie', price: 2_500, model: 'lime', color: null },
  top_sailor: { slot: 'shirt', name: 'Sailor Stripes', price: 4_000, model: 'sailor', color: null },
  top_aloha: { slot: 'shirt', name: 'Punk Aloha Vest', price: 6_000, model: 'aloha', color: null },
  top_lastwords: { slot: 'shirt', name: 'Last Words Camo', price: 8_000, model: 'lastwords', color: null },
  top_tactical: { slot: 'shirt', name: 'Tactical Vest', price: 9_000, model: 'tactical', color: null },
  top_snug: { slot: 'shirt', name: 'Snug Red Suit', price: 12_000, model: 'snug', color: null },
  top_shadow: { slot: 'shirt', name: 'Shadow Paw Cloak', price: 15_000, model: 'shadow', color: null },
  top_captain: { slot: 'shirt', name: "Captain's Coat", price: 40_000, model: 'captain', color: null },
  top_phoenix: { slot: 'shirt', name: 'Phoenix Wings', price: 150_000, model: 'phoenix', color: null, special: true },
  // meme trousers
  legs_navy: { slot: 'pants', name: 'Navy Court Trousers', price: 0, model: 'navy', color: null },
  legs_jeans: { slot: 'pants', name: 'Blue Jeans', price: 800, model: 'jeans', color: null },
  legs_pyjama: { slot: 'pants', name: 'Paw Pyjamas', price: 1_500, model: 'pyjama', color: null },
  legs_sailor: { slot: 'pants', name: 'Sailor Shorts', price: 2_000, model: 'sailor', color: null },
  legs_track: { slot: 'pants', name: 'Lime Track Pants', price: 2_500, model: 'track', color: null },
  legs_cargo: { slot: 'pants', name: 'Camo Cargo Pants', price: 3_000, model: 'cargo', color: null },
  legs_captain: { slot: 'pants', name: "Captain's Trousers", price: 20_000, model: 'captain', color: null },
  // meme shoes
  feet_court: { slot: 'shoes', name: 'Black Court Boots', price: 0, model: 'court', color: null },
  feet_sandal: { slot: 'shoes', name: 'Beach Sandals', price: 600, model: 'sandal', color: null },
  feet_sneaker: { slot: 'shoes', name: 'Red Sneakers', price: 800, model: 'sneaker', color: null },
  feet_rain: { slot: 'shoes', name: 'Yellow Rain Boots', price: 1_500, model: 'rain', color: null },
  feet_bunny: { slot: 'shoes', name: 'Bunny Slippers', price: 2_000, model: 'bunny', color: null },
  feet_combat: { slot: 'shoes', name: 'Combat Boots', price: 4_000, model: 'combat', color: null },
  feet_rocket: { slot: 'shoes', name: 'Rocket Boots', price: 90_000, model: 'rocket', color: null, special: true },
  // shirts (the gold badge and buttons stay, the jacket colour changes)
  plaid_red: { slot: 'shirt', name: 'Official Red Jacket', price: 0, color: null },
  plaid_blue: { slot: 'shirt', name: 'Blue Camo Jacket', price: 400, color: '#2f72d8' },
  plaid_green: { slot: 'shirt', name: 'Jade Jacket', price: 400, color: '#36a04a' },
  plaid_yellow: { slot: 'shirt', name: 'Imperial Yellow Jacket', price: 700, color: '#f2c230' },
  plaid_purple: { slot: 'shirt', name: 'Plum Jacket', price: 700, color: '#8a4ad8' },
  plaid_pink: { slot: 'shirt', name: 'Party Pink Shirt', price: null, color: '#ff7ab6' },
  plaid_black: { slot: 'shirt', name: 'Midnight Shirt', price: 5_000, color: '#2a2a33' },
  silk_gold: { slot: 'shirt', name: 'Golden Silk Shirt', price: 300_000, color: '#ffcf40', finish: 'gold', special: true },
  rainbow: { slot: 'shirt', name: 'Rainbow Shirt', gems: 350, color: '#ff5a5a', finish: 'rainbow', special: true },
  // trousers
  denim: { slot: 'pants', name: 'Red Silk Shorts', price: 0, color: null },
  denim_light: { slot: 'pants', name: 'Sky Denim Overalls', price: 500, color: '#5a9ae8' },
  denim_green: { slot: 'pants', name: 'Moss Overalls', price: 500, color: '#3f7a3a' },
  denim_brown: { slot: 'pants', name: 'Cocoa Overalls', price: 800, color: '#7a4a2a' },
  denim_black: { slot: 'pants', name: 'Night Overalls', price: 3_000, color: '#26262e' },
  denim_white: { slot: 'pants', name: 'Cloud Overalls', price: 6_000, color: '#f0ece2' },
  galaxy: { slot: 'pants', name: 'Galaxy Overalls', gems: 450, color: '#3a2a8a', finish: 'galaxy', special: true },
  pants_gold: { slot: 'pants', name: 'Golden Overalls', price: 400_000, color: '#ffcf40', finish: 'gold', special: true },
  // shoes
  boots: { slot: 'shoes', name: 'White Paws', price: 0, color: null },
  boots_black: { slot: 'shoes', name: 'Black Boots', price: 400, color: '#26222a' },
  boots_red: { slot: 'shoes', name: 'Red Boots', price: 600, color: '#c0392b' },
  boots_white: { slot: 'shoes', name: 'Clean White Boots', price: 2_000, color: '#f2efe8' },
  boots_gold: { slot: 'shoes', name: 'Golden Boots', price: 200_000, color: '#ffcf40', finish: 'gold', special: true },
  boots_glow: { slot: 'shoes', name: 'Glow Boots', gems: 300, color: '#5fe0ff', finish: 'glow', special: true },
  // $MGRD shop exclusives (fixed $MGRD prices). Cosmetic only.
  cap_aurora: { slot: 'hat', name: 'Aurora Cap', mgrd: 1_500, model: 'cap', color: '#9945FF', finish: 'glow', special: true },
  shirt_aurora: { slot: 'shirt', name: 'Aurora Shirt', mgrd: 3_000, color: '#14F195', finish: 'glow', special: true },
  overalls_aurora: { slot: 'pants', name: 'Aurora Overalls', mgrd: 4_000, color: '#6a3aff', finish: 'galaxy', special: true },
  // limited drop (numbered, fixed supply): sold only through the $MGRD shop's Limited tab
  founder_crown: { slot: 'hat', name: "Founder's Crown", limited: true, model: 'crown', color: '#ffcf40', finish: 'gold', special: true },
});
/** Price discount for paying with MGRD (on the item price only). */
export const MGRD_DISCOUNT = 0.05;
export const DEFAULT_AVATAR = { skin: null, hair: null, hat: 'bare', shirt: 'plaid_red', pants: 'denim', shoes: 'boots', beard: 'classic', height: 1 };
