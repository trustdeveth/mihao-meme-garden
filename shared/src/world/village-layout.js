// @ts-check
// Village layout shared by server (reach/movement checks) and client (rendering).
// Twelve large garden plots sit in a ring far out from the central market plaza, separated by woods.
// Garden coordinates are plot-local: x right, z toward the plot's gate (which faces the plaza).
import { unit, mulberry32 } from '../util/rng.js';
import { ISLAND, HOME_SPOT } from '../data/features.js';

export const ROOM_SIZE = 12;
export const PLOT_RING_RADIUS = 88;
export const PLOT = { w: 30, d: 32, gateZ: 16 }; // fenced plot footprint (local), gate on +z side
export const WORLD_RADIUS = 140;
export const PLAZA_RADIUS = 18;
export const PATH_HALF = 3.2; // half width of the cleared path from the plaza to each garden gate

const PLOT_MIN_GAP = 50;          // centre-to-centre distance between gardens (fence diagonal is ~44 m)
const PLOT_MIN_R = 68, PLOT_MAX_R = 114;

/**
 * Garden plots at irregular, natural-looking positions: each one gets its own distance from the plaza,
 * a jittered angle and a slightly tilted facing. Deterministic, so every player and the server agree.
 * @type {{index:number, x:number, z:number, rotY:number, angle:number}[]}
 */
export const PLOT_SLOTS = (() => {
  const rng = mulberry32(20261110);
  const out = [];
  for (let i = 0; i < ROOM_SIZE; i++) {
    let best = null;
    for (let tries = 0; tries < 400; tries++) {
      const a = ((i + 0.5) / ROOM_SIZE) * Math.PI * 2 + (rng() - 0.5) * 0.42;
      const r = PLOT_MIN_R + rng() * (PLOT_MAX_R - PLOT_MIN_R);
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      const gap = Math.min(...out.map((o) => Math.hypot(o.x - x, o.z - z)), Infinity);
      if (gap >= PLOT_MIN_GAP) { best = { x, z, a }; break; }
      if (!best || gap > best.gap) best = { x, z, a, gap };
    }
    // the gate (local +z) roughly faces the plaza, with a little tilt so rows do not look regular
    const face = Math.atan2(best.x, best.z) + Math.PI + (rng() - 0.5) * 0.5;
    out.push({ index: i, x: best.x, z: best.z, rotY: face, angle: best.a });
  }
  return out;
})();

/** Vendor stalls around the fountain. */
export const STALLS = Object.freeze([
  { id: 'seeds', x: 0, z: -10, rotY: 0, reach: 4 },
  { id: 'market', x: 8.66, z: 5, rotY: (-2 * Math.PI) / 3, reach: 4 },
  { id: 'gadgets', x: -8.66, z: 5, rotY: (2 * Math.PI) / 3, reach: 4 },
  { id: 'pets', x: 0, z: 11, rotY: Math.PI, reach: 4 },
]);
export const FOUNTAIN = { x: 0, z: 0, r: 3.2 };
/** Hot-air balloon to Sky Island and the village notice board (orders, contract, season). */
export const BALLOON = { x: -10.5, z: -6.5, reach: 6 };
export const BOARD = { x: 10.5, z: -6.5, reach: 4.5 };
export { ISLAND };
export const onIsland = (x, z) => Math.hypot(x - ISLAND.center.x, z - ISLAND.center.z) <= ISLAND.radius;
export const SPAWN = { x: 0, z: 6 };

/** Plot-local sign positions (front of the plot, next to the gate). */
export const SIGNS = Object.freeze({
  expand: { x: -7.2, z: 15.6 },
  growAll: { x: 7.2, z: 15.6 },
  owner: { x: 4.3, z: 17.1 }, // beside the gate, outside the fence
});

export const REACH = 3.5;

/** Plot-local -> world. */
export function toWorld(slot, x, z) {
  const s = PLOT_SLOTS[slot];
  const c = Math.cos(s.rotY), n = Math.sin(s.rotY);
  return { x: s.x + x * c + z * n, z: s.z - x * n + z * c };
}

/** World -> plot-local. */
export function toLocal(slot, x, z) {
  const s = PLOT_SLOTS[slot];
  const dx = x - s.x, dz = z - s.z;
  const c = Math.cos(s.rotY), n = Math.sin(s.rotY);
  return { x: dx * c - dz * n, z: dx * n + dz * c };
}

/** Which plot (if any) contains a world point (with an optional margin around it). */
export function plotAt(x, z, margin = 0) {
  for (const s of PLOT_SLOTS) {
    const l = toLocal(s.index, x, z);
    if (Math.abs(l.x) <= PLOT.w / 2 + margin && Math.abs(l.z) <= PLOT.d / 2 + margin) return s.index;
  }
  return -1;
}

/** Path segments: from the plaza edge straight to each garden gate. */
export const PATHS = PLOT_SLOTS.map((s) => {
  const gate = toWorld(s.index, 0, PLOT.gateZ + 0.5);
  const len = Math.hypot(gate.x, gate.z);
  const start = { x: (gate.x / len) * (PLAZA_RADIUS - 1), z: (gate.z / len) * (PLAZA_RADIUS - 1) };
  return { slot: s.index, a: start, b: gate };
});

/** Distance from a point to the nearest cleared path. */
function pathDistance(x, z) {
  let best = Infinity;
  for (const { a, b } of PATHS) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)));
  }
  return best;
}

/** Circle obstacles in world space (fountain and stalls). */
export const OBSTACLES = Object.freeze([
  { x: FOUNTAIN.x, z: FOUNTAIN.z, r: FOUNTAIN.r },
  ...STALLS.map((s) => ({ x: s.x, z: s.z, r: 2.2 })),
  { x: -10.5, z: -6.5, r: 1.6 },
  { x: 10.5, z: -6.5, r: 0.8 },
]);

/**
 * The woods: deterministic tree, bush and rock positions filling the space between the plaza and the
 * gardens, the gaps between gardens, and a deep forest around the edge. Paths, plots and the plaza stay clear.
 * @returns {{trees:{x:number,z:number,type:number,s:number,ry:number}[], bushes:{x:number,z:number,s:number,ry:number}[], rocks:{x:number,z:number,type:number,s:number,ry:number}[]}}
 */
export const FOREST = (() => {
  const trees = [], bushes = [], rocks = [];
  const clear = (x, z, pad) => {
    const r = Math.hypot(x, z);
    if (r < PLAZA_RADIUS + 5 + pad || r > WORLD_RADIUS - 3) return false;
    if (pathDistance(x, z) < PATH_HALF + 1.8 + pad) return false;
    if (plotAt(x, z, 3.5 + pad) >= 0) return false;
    return true;
  };
  const step = 5.2;
  for (let gx = -WORLD_RADIUS; gx <= WORLD_RADIUS; gx += step) {
    for (let gz = -WORLD_RADIUS; gz <= WORLD_RADIUS; gz += step) {
      const x = gx + (unit('fx', gx, gz) - 0.5) * step * 0.8;
      const z = gz + (unit('fz', gx, gz) - 0.5) * step * 0.8;
      const r = Math.hypot(x, z);
      const outer = r > PLOT_MAX_R + PLOT.d / 2 + 2;
      const density = outer ? 0.7 : 0.62;
      const roll = unit('fd', gx, gz);
      if (!clear(x, z, 0)) {
        // bushes and flowers soften the edges of paths and plots
        if (roll < 0.12 && clear(x, z, -2.2)) bushes.push({ x, z, s: 0.7 + unit('bs', gx, gz) * 0.6, ry: unit('br', gx, gz) * 6.28 });
        continue;
      }
      if (roll < density) {
        const t = unit('ft', gx, gz);
        trees.push({ x, z, type: outer ? (t < 0.45 ? 3 : t < 0.7 ? 0 : t < 0.88 ? 1 : 2) : (t < 0.38 ? 0 : t < 0.62 ? 1 : t < 0.82 ? 2 : 3), s: 0.85 + unit('fs', gx, gz) * 0.55, ry: unit('fr', gx, gz) * 6.28 });
      } else if (roll < density + 0.14) bushes.push({ x, z, s: 0.7 + unit('bs', gx, gz) * 0.7, ry: unit('br', gx, gz) * 6.28 });
      else if (roll < density + 0.2) rocks.push({ x, z, type: Math.floor(unit('rt', gx, gz) * 3), s: 0.7 + unit('rs', gx, gz) * 0.9, ry: unit('rr', gx, gz) * 6.28 });
    }
  }
  return { trees, bushes, rocks };
})();

export const TREE_TRUNK_RADIUS = 0.55;

// spatial hash of tree trunks for fast collision checks
const CELL = 8;
const treeGrid = new Map();
for (const t of FOREST.trees) {
  const k = `${Math.floor(t.x / CELL)},${Math.floor(t.z / CELL)}`;
  if (!treeGrid.has(k)) treeGrid.set(k, []);
  treeGrid.get(k).push(t);
}

/** True if a trunk blocks the point. */
export function treeAt(x, z, radius = 0.35) {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  for (let i = cx - 1; i <= cx + 1; i++) for (let j = cz - 1; j <= cz + 1; j++) {
    for (const t of treeGrid.get(`${i},${j}`) ?? []) if (Math.hypot(x - t.x, z - t.z) < TREE_TRUNK_RADIUS * t.s + radius) return true;
  }
  return false;
}

/**
 * True when a world point can be stood on. The server checks bounds and buildings; the client also
 * avoids tree trunks (withTrees) so players walk around them.
 */
/** Half-width of the gate opening in the front fence of every garden (between the gate posts). */
export const GATE_HALF = 2.3;
/** Footprint (half sizes, plot-local, around HOME_SPOT) of each home tier: shed, cottage, treehouse trunk, windmill, castle. */
export const HOME_FOOT = [{ hx: 1.75, hz: 1.35 }, { hx: 2.4, hz: 1.95 }, { hx: 0.7, hz: 0.7 }, { hx: 2.2, hz: 2.2 }, { hx: 3.8, hz: 3.25 }];
/**
 * Which gardens of the room you are in have a home (slot -> tier). Kept by the client from what it sees;
 * the server does not use it (rooms share slot numbers), so homes are solid for walking on the client only.
 */
export const HOMES_AT = new Map();

/** Fences (with the gate gap) and homes of the gardens. */
function blockedByGarden(x, z, radius, fences = true) {
  for (const s of PLOT_SLOTS) {
    const dx = x - s.x, dz = z - s.z;
    if (dx * dx + dz * dz > 28 * 28) continue;
    const l = toLocal(s.index, x, z);
    const hw = PLOT.w / 2, hd = PLOT.d / 2, pad = radius + 0.15;
    const alongX = Math.abs(l.x) <= hw + pad, alongZ = Math.abs(l.z) <= hd + pad;
    if (fences && alongZ && Math.abs(Math.abs(l.x) - hw) < pad) return true; // side fences
    if (fences && alongX && Math.abs(l.z + hd) < pad) return true; // back fence
    if (fences && alongX && Math.abs(l.z - hd) < pad && Math.abs(l.x) > GATE_HALF - radius) return true; // front fence, gate left open
    const tier = HOMES_AT.get(s.index);
    if (tier) {
      const f = HOME_FOOT[tier - 1];
      if (Math.abs(l.x - HOME_SPOT.x) < f.hx + radius && Math.abs(l.z - HOME_SPOT.z) < f.hz + radius) return true;
    }
  }
  return false;
}

/** fences = false while jumping: a jump clears the knee-high picket fence (but not houses or trees). */
export function walkable(x, z, radius = 0.35, withTrees = false, fences = true) {
  if (onIsland(x, z)) return Math.hypot(x - ISLAND.center.x, z - ISLAND.center.z) <= ISLAND.radius - 1.2 - radius;
  if (Math.hypot(x, z) > WORLD_RADIUS - radius) return false;
  for (const o of OBSTACLES) if (Math.hypot(x - o.x, z - o.z) < o.r + radius) return false;
  if (blockedByGarden(x, z, radius, fences)) return false;
  if (withTrees && treeAt(x, z, radius)) return false;
  return true;
}

export const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
