// @ts-check
// $MGRD payments for in-game items. Prices are fixed amounts of $MGRD (they do not follow the token's market price);
// change them here. Pet eggs and decorations are $MGRD-only; coins and gems still work for everything else.

/** Pet eggs. */
export const MGRD_EGG = Object.freeze({ common: 500, rare: 2_000, legendary: 6_000 });
/** Decorations by tier (decorations that are earned stay earned). */
export const MGRD_DECOR = Object.freeze({ common: 300, uncommon: 600, rare: 1_200, legendary: 3_000, mythical: 6_000, prismatic: 12_000 });
/** Gem-priced special avatar items and special hair colours: 10 $MGRD per gem. */
export const MGRD_PER_GEM = 10;
/** Expand Soil: replaces only the coin price; crop and harvest requirements still apply. Index = target level. */
export const MGRD_SOIL = Object.freeze([500, 1_000, 2_000, 4_000, 8_000, 15_000, 25_000]);
/** Grow All: from its coin quote, with a floor and ceiling, at most a few times a day. */
export const MGRD_GROWALL = Object.freeze({ coinsPerMgrd: 200, min: 250, max: 5_000, perDay: 3 });
/** Community: Fireworks Pot contributions, naming the fountain, tip amounts. */
export const MGRD_POT = Object.freeze([1_000, 5_000, 10_000]);
export const MGRD_NAME = 5_000;
export const MGRD_TIPS = Object.freeze([100, 500, 1_000]);

/**
 * Limited drops: numbered, $MGRD-only, a fixed supply per season. kind: 'wear' (WEAR id) or 'decor' (DECOR id).
 */
export const LIMITED = Object.freeze({
  s1_golden_gnome: { kind: 'decor', item: 's1_golden_gnome', name: 'Season 1 Golden Gnome', mgrd: 5_000, supply: 1000 },
  founder_crown: { kind: 'wear', item: 'founder_crown', name: "Founder's Crown", mgrd: 10_000, supply: 500 },
});

/** Holder tiers from the wallet's $MGRD (wallet balance + Garden Club lock). Shown next to the player's name. */
export const HOLDER_TIERS = Object.freeze([
  { id: 'golden', name: 'Golden Tree', min: 100_000 },
  { id: 'bloom', name: 'Bloom', min: 10_000 },
  { id: 'sprout', name: 'Sprout', min: 1_000 },
]);
export const holderTier = (mgrd) => HOLDER_TIERS.find((t) => mgrd >= t.min) ?? null;

/**
 * Garden Club: lock $MGRD for 30 days (tokens come back afterwards; no interest). While the lock is active:
 * a club badge, a golden name, the Club Lantern decoration and more decoration slots. Cosmetic only.
 */
export const CLUB = Object.freeze({ minLock: 5_000, days: 30, extraDecor: 10, perk: 'club_lantern' });
