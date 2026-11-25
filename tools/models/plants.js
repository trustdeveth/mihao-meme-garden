// Stylized-realistic plant generators: 29 crops x 5 growth stages + fruit models.
// Each builder fills a Builder with geometry per material and returns fruit anchors for stage 4.
import * as THREE from 'three';
import { V3, TAU, GOLDEN, rand, hashStr, col, jitter, leafBlade, stem, path, lathe, blob, cyl, cone, sphere, place, merge, bakeAO, torus, box, cards } from './lib/geo.js';

/** Material slots exported in each mesh's material name. */
export const SLOTS = ['leaf', 'foliage', 'blossom', 'blossomGlow', 'stem', 'bark', 'fruit', 'fruitMatte', 'petal', 'glow', 'soil', 'wood'];

const Y = new V3(0, 1, 0);
const tmpM = new THREE.Matrix4();

/** Quaternion so that local +Y points along dir and local +Z (the leaf's upper face) is as close as possible to `up`. */
export function orient(dir, up = Y) {
  const y = dir.clone().normalize();
  let z = up.clone().sub(y.clone().multiplyScalar(up.dot(y)));
  if (z.lengthSq() < 1e-6) z = new V3(1, 0, 0).sub(y.clone().multiplyScalar(y.x));
  z.normalize();
  const x = new V3().crossVectors(y, z).normalize();
  tmpM.makeBasis(x, y, z);
  return new THREE.Quaternion().setFromRotationMatrix(tmpM);
}

class Builder {
  constructor(detail, seed) { this.detail = detail; this.r = rand(seed); this.parts = {}; this.anchors = []; }
  add(slot, geo) { if (geo) (this.parts[slot] ??= []).push(geo); return geo; }
  /** Leaf at `at`, pointing along `dir`, face toward `up`. */
  leaf(opts, at, dir, up = Y, slot = 'leaf') {
    const lo = this.detail < 0.5;
    const g = leafBlade({ seg: lo ? 4 : 7, wseg: lo ? 1 : 2, seed: Math.floor(this.r() * 1e6), ...opts, ...(lo ? { seg: Math.min(opts.seg ?? 7, 4), wseg: 1 } : {}) });
    place(g, { pos: [at.x, at.y, at.z], quat: orient(dir, up) });
    return this.add(slot, g);
  }
  stem(points, r0, r1, opts = {}, slot = 'stem') {
    const lo = this.detail < 0.5;
    return this.add(slot, stem(points, r0, r1, { radial: lo ? 4 : opts.radial ?? 6, segs: lo ? Math.max(2, points.length) : opts.segs, ...opts, ...(lo ? { radial: 4 } : {}) }));
  }
  /** Foliage card clump centred at p. */
  clump(p, size, color, color2, slot = 'foliage') {
    const g = cards(size, { color, color2, seed: Math.floor(this.r() * 1e6), n: this.detail < 0.5 ? 2 : 3 });
    g.rotateY(this.r() * TAU);
    g.translate(p.x, p.y, p.z);
    return this.add(slot, g);
  }
  anchor(pos, hang = true, scale = 1) { this.anchors.push({ pos: pos.clone(), hang, scale }); }
  n(count) { return Math.max(1, Math.round(count * (this.detail < 0.5 ? 0.5 : 1))); }
}

// ---- Species parameters --------------------------------------------------------

export const SPECIES = {
  carrot: { family: 'root', leaf: '#3f8a2f', tip: '#6fb048', fruit: '#e8731e', h: 0.42 },
  strawberry: { family: 'strawberry', leaf: '#2f7a2c', tip: '#58a23d', fruit: '#d8202c', h: 0.28 },
  blueberry: { family: 'shrub', leaf: '#3d7f45', tip: '#6ea860', fruit: '#3c4f9e', h: 0.85, leafShape: 'elliptic', leafLen: 0.07, wood: '#6b4a35' },
  bamboo: { family: 'bamboo', leaf: '#5d9a3a', tip: '#8fc25a', culm: '#7fae4a', fruit: '#c7c27a', h: 2.3 },
  tomato: { family: 'vine', leaf: '#3c7d30', tip: '#5f9e3f', fruit: '#e0301e', h: 1.15, leafShape: 'ovate', leafLen: 0.12, compound: 5, stake: true },
  eggplant: { family: 'vine', leaf: '#4a7b3c', tip: '#6a9852', fruit: '#4b1f5c', h: 0.85, leafShape: 'ovate', leafLen: 0.22, stemCol: '#5a3a5e', compound: 1 },
  pepper: { family: 'vine', leaf: '#2f7a31', tip: '#4f9a3c', fruit: '#e5301f', h: 0.72, leafShape: 'elliptic', leafLen: 0.13, compound: 1 },
  pumpkin: { family: 'sprawl', leaf: '#3f7f2f', tip: '#5d9c40', fruit: '#ee7a14', leafShape: 'heart', h: 0.45 },
  cauliflower: { family: 'brassica', leaf: '#4f8a6a', tip: '#7fae8e', fruit: '#f3ead2', h: 0.5 },
  beanstalk: { family: 'vine', leaf: '#3f8a35', tip: '#66ad4a', fruit: '#5aa43a', h: 1.9, leafShape: 'heart', leafLen: 0.16, compound: 3, pole: true },
  cacao: { family: 'tree', leaf: '#2f6a34', tip: '#7a9d3e', fruit: '#c8752a', bark: '#6a5242', h: 1.9, leafShape: 'elliptic', leafLen: 0.22, cauliflory: true },
  cactus: { family: 'opuntia', leaf: '#5f8f4a', fruit: '#c9365e', h: 1.15 },
  watermelon: { family: 'sprawl', leaf: '#3c7a35', tip: '#5f9a48', fruit: '#2f7a2c', leafShape: 'lobed', h: 0.35 },
  coconut: { family: 'palm', leaf: '#4f8a2f', tip: '#8cb24a', fruit: '#6b4a2a', bark: '#8a7458', h: 2.7 },
  mango: { family: 'tree', leaf: '#2f6a2c', tip: '#5a8f38', fruit: '#f2a31e', bark: '#5e4636', h: 2.2, leafShape: 'lanceolate', leafLen: 0.24 },
  nectarine: { family: 'tree', leaf: '#3f7f30', tip: '#6aa040', fruit: '#e2543a', bark: '#6b4d3e', h: 2.0, leafShape: 'lanceolate', leafLen: 0.16 },
  pear: { family: 'tree', leaf: '#3c7a33', tip: '#68a145', fruit: '#c6c23c', bark: '#5a4a3e', h: 2.25, leafShape: 'ovate', leafLen: 0.12, upright: true },
  avocado: { family: 'tree', leaf: '#2c5f2c', tip: '#4f8238', fruit: '#3f5a22', bark: '#5c4a3a', h: 2.3, leafShape: 'elliptic', leafLen: 0.2 },
  banana: { family: 'banana', leaf: '#4f9a3a', tip: '#86c25a', fruit: '#f2d23c', h: 2.4 },
  dragonfruit: { family: 'climbCactus', leaf: '#5b9a48', fruit: '#e0306e', h: 1.4 },
  pinklily: { family: 'lily', leaf: '#3f7f35', tip: '#6aa548', petal: '#f07aa8', petal2: '#fbd3e3', h: 0.95 },
  pineapple: { family: 'bromeliad', leaf: '#4f7f4a', tip: '#8a9f4a', fruit: '#d99a2a', h: 0.75 },
  kiwi: { family: 'trellis', leaf: '#3f7f35', tip: '#6b9a40', fruit: '#8a6a3a', wood: '#7a5a3e', h: 1.85 },
  candyblossom: { family: 'blossom', petal: '#ff8fc8', petal2: '#ffe1f1', bark: '#6a4a4a', fruit: '#ff6fb5', h: 2.5 },
  cherryblossom: { family: 'blossom', petal: '#f6b3c8', petal2: '#fff1f5', bark: '#4f3a3a', fruit: '#c0182c', h: 2.7 },
  sugarapple: { family: 'tree', leaf: '#4f8f45', tip: '#79ab5a', fruit: '#9cc46a', bark: '#6a5a48', h: 2.0, leafShape: 'elliptic', leafLen: 0.15 },
  moonblossom: { family: 'blossom', petal: '#cfe0ff', petal2: '#ffffff', bark: '#40405a', fruit: '#dfe8ff', h: 2.6, glow: true },
  orchid: { family: 'orchid', leaf: '#3f7f40', petal: '#c86ae0', petal2: '#fde8ff', h: 0.65 },
  starflower: { family: 'lily', leaf: '#3a6f5a', tip: '#5f9f8a', petal: '#ffe35a', petal2: '#fff8cf', h: 0.8, star: true, glow: true },
};

// ---- Shared pieces ---------------------------------------------------------------

/** Five-petal (or n-petal) flower facing `dir` at `at`. */
function flower(b, at, dir, { n = 5, len = 0.06, wid = 0.045, color = '#fff', center = '#f2c84a', cup = 0.4, shape = 'round', slot = 'petal', droop = -0.2 } = {}) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const side = new V3(Math.cos(a), 0, Math.sin(a));
    const q = orient(dir);
    const out = side.applyQuaternion(q).normalize();
    const pd = out.clone().multiplyScalar(1).add(dir.clone().normalize().multiplyScalar(cup)).normalize();
    b.leaf({ len, wid, shape, fold: 0.15, droop, color, tip: color, seg: 4, wseg: 2 }, at, pd, dir, slot);
  }
  b.add('fruitMatte', place(sphere(len * 0.22, { w: 8, h: 6, color: center }), { pos: [at.x, at.y, at.z] }));
}

/** Soil mound at the base (part of every stage). */
function mound(b, r, h = 0.05) {
  const g = lathe([[r * 1.05, -0.01], [r, 0.004], [r * 0.82, h * 0.55], [r * 0.5, h * 0.92], [r * 0.18, h * 1.02], [0, h * 1.03]], { segs: b.detail < 0.5 ? 10 : 22, bumps: 0.05, color: '#6b4423', color2: '#5a381c', seed: 3, smooth: 10 });
  // radial UVs so the soil texture shows furrow rings
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) * 2 + 0.5, p.getZ(i) * 2 + 0.5);
  b.add('soil', g);
}

/** Stage 0: a little seed mound. Stage 1: a sprout with two seed leaves. */
function seedling(b, sp, stage) {
  mound(b, stage === 0 ? 0.16 : 0.13, stage === 0 ? 0.06 : 0.04);
  if (stage === 0) {
    b.add('fruitMatte', place(blob(0.022, 0.014, 0.016, { detail: 1, color: '#8a6a3a', seed: 9 }), { pos: [0.02, 0.05, -0.01], rot: [0.3, 0.6, 0] }));
    return;
  }
  const h = 0.08;
  b.stem([new V3(0, 0, 0), new V3(0.005, h * 0.6, 0), new V3(0, h, 0)], 0.006, 0.004, { color: '#7cab4a' });
  const top = new V3(0, h, 0);
  for (const s of [-1, 1]) b.leaf({ len: 0.06, wid: 0.04, shape: 'round', fold: 0.1, droop: 0.2, color: '#79b04f', tip: '#9fcf6a', seg: 4 }, top, new V3(s, 0.6, 0), Y);
  b.leaf({ len: 0.035, wid: 0.02, shape: sp.leafShape ?? 'ovate', color: sp.leaf ?? '#4f8f3a', tip: sp.tip ?? '#79b04f', seg: 4 }, top, new V3(0, 1, 0.2), new V3(0, 0, 1));
}

// ---- Families ----------------------------------------------------------------------

const FAMILY = {
  root(b, sp, g) {
    mound(b, 0.22, 0.05);
    const fronds = b.n(4 + g * 8);
    for (let i = 0; i < fronds; i++) {
      const a = i * GOLDEN, el = 1.05 - (i / fronds) * 0.5;
      const dir = new V3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el));
      const len = sp.h * g * (0.75 + b.r() * 0.35);
      const pts = path(new V3(0, 0.03, 0), dir, len, { bend: 0.15, steps: 3, side: new V3(-dir.z, 0, dir.x), gravity: 0.25 });
      b.stem(pts, 0.006, 0.003, { color: '#5f9a3a', radial: 4 });
      const c = new THREE.CatmullRomCurve3(pts);
      const leaflets = b.n(6);
      for (let k = 2; k <= leaflets; k++) {
        const t = k / (leaflets + 0.5), p = c.getPointAt(t), tan = c.getTangentAt(t);
        for (const s of [-1, 1]) {
          const side = new V3().crossVectors(tan, Y).normalize().multiplyScalar(s);
          const d = side.add(tan.clone().multiplyScalar(0.8)).normalize();
          b.leaf({ len: 0.05 * (1.2 - t * 0.6) * (0.6 + g * 0.5), wid: 0.03, shape: 'lanceolate', serr: 0.45, teeth: 6, fold: 0.1, droop: 0.15, color: sp.leaf, tip: sp.tip, seg: 4 }, p, d, Y);
        }
      }
    }
    // the carrot's orange shoulder peeks out of the soil
    b.add('fruit', place(cone(0.035 * g + 0.01, 0.06, { segs: 10, color: sp.fruit }), { pos: [0, 0.02, 0], rot: [Math.PI, 0, 0] }));
    // carrots grow underground: no fruit anchors (the orange shoulder above shows ripeness)
  },

  strawberry(b, sp, g) {
    mound(b, 0.25, 0.04);
    const leaves = b.n(4 + g * 8);
    for (let i = 0; i < leaves; i++) {
      const a = i * GOLDEN, el = 0.75 + b.r() * 0.35;
      const dir = new V3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el));
      const len = sp.h * g * (0.7 + b.r() * 0.4);
      const pts = path(new V3(0, 0.02, 0), dir, len, { bend: 0.1, steps: 3, gravity: 0.35 });
      b.stem(pts, 0.005, 0.004, { color: '#6a8f3a', radial: 4 });
      const end = pts.at(-1), tan = pts.at(-1).clone().sub(pts.at(-2)).normalize();
      const side = new V3().crossVectors(tan, Y).normalize();
      for (const k of [-1, 0, 1]) {
        const d = tan.clone().add(side.clone().multiplyScalar(k * 0.9)).normalize();
        d.y = Math.max(d.y, -0.1);
        b.leaf({ len: 0.075 * (0.6 + g * 0.6), wid: 0.06 * (0.6 + g * 0.6), shape: 'ovate', serr: 0.22, teeth: 9, fold: 0.35, droop: 0.25, color: sp.leaf, tip: sp.tip }, end, d, Y);
      }
    }
    if (g >= 0.75) {
      const n = 4;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + 0.4;
        const out = new V3(Math.cos(a), 0, Math.sin(a));
        const pts = [new V3(0, 0.03, 0), out.clone().multiplyScalar(0.1).add(new V3(0, 0.12, 0)), out.clone().multiplyScalar(0.2).add(new V3(0, 0.09, 0))];
        b.stem(pts, 0.003, 0.002, { color: '#6f9a3f', radial: 4 });
        if (g < 1) flower(b, pts.at(-1), out.clone().add(new V3(0, 0.6, 0)), { color: '#fbfaf2', center: '#f2c84a', len: 0.025, wid: 0.022 });
        else b.anchor(pts.at(-1), true);
      }
    }
  },

  shrub(b, sp, g) {
    mound(b, 0.28, 0.05);
    const canes = b.n(3 + g * 4);
    for (let i = 0; i < canes; i++) {
      const a = (i / canes) * TAU + b.r();
      const dir = new V3(Math.cos(a) * 0.35, 1, Math.sin(a) * 0.35);
      const len = sp.h * g * (0.75 + b.r() * 0.3);
      const pts = path(new V3(Math.cos(a) * 0.03, 0.02, Math.sin(a) * 0.03), dir, len, { bend: 0.3, steps: 4, side: new V3(Math.cos(a), 0, Math.sin(a)) });
      b.stem(pts, 0.014, 0.004, { color: sp.wood, color2: '#8a6a4a', bark: true }, 'bark');
      const c = new THREE.CatmullRomCurve3(pts);
      const nl = b.n(5 + g * 5);
      for (let k = 0; k < nl; k++) {
        const t = 0.25 + (k / nl) * 0.75, p = c.getPointAt(t);
        const aa = k * GOLDEN + a;
        const d = new V3(Math.cos(aa), 0.5, Math.sin(aa)).normalize();
        b.leaf({ len: sp.leafLen * (0.8 + b.r() * 0.4), wid: sp.leafLen * 0.55, shape: sp.leafShape, fold: 0.25, droop: 0.2, color: jitter(col(sp.leaf), b.r).getStyle(), tip: sp.tip }, p, d, Y);
      }
      b.clump(c.getPointAt(0.85), 0.18 + g * 0.12, sp.leaf, sp.tip);
      if (g >= 1) b.anchor(c.getPointAt(0.72).add(new V3(Math.cos(a) * 0.04, -0.03, Math.sin(a) * 0.04)), true);
    }
  },

  bamboo(b, sp, g) {
    mound(b, 0.26, 0.05);
    const culms = b.n(2 + g * 2);
    for (let i = 0; i < culms; i++) {
      const a = (i / culms) * TAU + 0.5;
      const base = new V3(Math.cos(a) * 0.08, 0, Math.sin(a) * 0.08);
      const h = sp.h * g * (0.7 + b.r() * 0.35);
      const lean = new V3(Math.cos(a) * 0.08, 1, Math.sin(a) * 0.08).normalize();
      const nodes = Math.max(3, Math.round(h / 0.4));
      const r0 = 0.028 * (0.6 + g * 0.5);
      for (let k = 0; k < nodes; k++) {
        const p0 = base.clone().add(lean.clone().multiplyScalar((k / nodes) * h));
        const p1 = base.clone().add(lean.clone().multiplyScalar(((k + 1) / nodes) * h * 0.995));
        b.stem([p0, p0.clone().lerp(p1, 0.5), p1], r0 * (1 - k * 0.04), r0 * (1 - k * 0.04) * 0.97, { color: sp.culm, color2: '#9cc062', radial: 7 });
        b.add('stem', place(torus(r0 * (1.02 - k * 0.04), r0 * 0.12, { rs: 4, ts: 10, color: '#c2c98a' }), { pos: [p1.x, p1.y, p1.z], rot: [Math.PI / 2, 0, 0] }));
        if (k >= nodes - 2) b.clump(p1.clone().add(new V3(0, 0.08, 0)), 0.42 * g + 0.1, sp.leaf, sp.tip);
        if (k >= nodes * 0.55 && k % 2 === 0) {
          const sprays = 1;
          for (let s = 0; s < sprays; s++) {
            const aa = k * 2.1 + s * Math.PI;
            const d = new V3(Math.cos(aa), 0.35, Math.sin(aa)).normalize();
            const tip = p1.clone().add(d.clone().multiplyScalar(0.12));
            b.stem([p1, tip], 0.004, 0.002, { color: '#8fb05a', radial: 3 });
            for (let l = 0; l < b.n(2); l++) {
              const ld = d.clone().add(new V3((b.r() - 0.5) * 0.8, -0.1 - b.r() * 0.3, (b.r() - 0.5) * 0.8)).normalize();
              b.leaf({ len: 0.2, wid: 0.035, shape: 'lanceolate', fold: 0.2, droop: 0.5, twist: 0.3, color: sp.leaf, tip: sp.tip }, tip, ld, Y);
            }
          }
        }
      }
    }
    if (g >= 1) for (let i = 0; i < 1; i++) b.anchor(new V3(0.12, 0.0, -0.08), false);
  },

  vine(b, sp, g) {
    mound(b, 0.26, 0.05);
    const h = sp.h * g;
    if (sp.stake && g > 0.4) {
      const sh = h + 0.12;
      b.add('wood', place(box(0.025, sh, 0.025, { color: '#9a7a52' }), { pos: [0.06, sh / 2 - 0.05, 0] }));
      b.add('stem', place(torus(0.035, 0.004, { rs: 3, ts: 8, color: '#d8c79a' }), { pos: [0.045, h * 0.5, 0], rot: [Math.PI / 2, 0, 0] }));
    }
    if (sp.pole && g > 0.3) {
      for (const [x, z] of [[0.18, 0], [-0.09, 0.16], [-0.09, -0.16]]) b.stem([new V3(x, -0.05, z), new V3(x * 0.1, sp.h + 0.1, z * 0.1)], 0.012, 0.009, { color: '#8a6a45', radial: 5 }, 'wood');
    }
    // main stem: twines around the pole for beans, zigzags for the rest
    const pts = [];
    const turns = sp.pole ? 3 : 0.6;
    const steps = 8;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const ang = t * turns * TAU;
      const rad = sp.pole ? 0.05 + 0.02 * Math.sin(t * 9) : 0.025 * Math.sin(t * 5);
      pts.push(new V3(Math.cos(ang) * rad, t * h, Math.sin(ang) * rad));
    }
    b.stem(pts, 0.016 * (0.5 + g * 0.5), 0.006, { color: sp.stemCol ?? '#5a8a35', radial: 6 });
    const c = new THREE.CatmullRomCurve3(pts);
    // side shoots make tomato-type plants bushy
    if (!sp.pole && g > 0.4) {
      for (let s = 0; s < b.n(2 + g * 2); s++) {
        const t0 = 0.2 + s * 0.18, p0 = c.getPointAt(Math.min(0.9, t0));
        const a = s * 2.4 + 0.7;
        const sp2 = path(p0, new V3(Math.cos(a), 0.9, Math.sin(a)), h * 0.35, { steps: 3, bend: 0.2 });
        b.stem(sp2, 0.008, 0.004, { color: sp.stemCol ?? '#5a8a35', radial: 4 });
        const cs = new THREE.CatmullRomCurve3(sp2);
        for (let q = 0; q < b.n(2); q++) {
          const pq = cs.getPointAt(0.4 + q * 0.4);
          const aq = a + q * 1.9;
          const dq = new V3(Math.cos(aq), 0.25, Math.sin(aq)).normalize();
          b.leaf({ len: (sp.leafLen ?? 0.1) * (0.9 + g * 0.5) * (sp.compound > 1 ? 1.3 : 1), wid: (sp.leafLen ?? 0.1) * 0.62, shape: sp.leafShape, serr: sp.compound > 1 ? 0.25 : 0, teeth: 8, fold: 0.3, droop: 0.45, ruffle: 0.5, color: jitter(col(sp.leaf), b.r).getStyle(), tip: sp.tip }, pq, dq, Y);
        }
        b.clump(sp2.at(-1).clone().add(new V3(0, -0.02, 0)), 0.16 + g * 0.12, sp.leaf, sp.tip);
      }
    }
    const nodes = b.n((sp.pole ? 8 : 5) + g * (sp.pole ? 10 : 6));
    for (let k = 0; k < nodes; k++) {
      const t = 0.12 + (k / nodes) * 0.85, p = c.getPointAt(t);
      const a = k * GOLDEN * 1.3;
      const out = new V3(Math.cos(a), 0.15, Math.sin(a)).normalize();
      const plen = (sp.compound > 1 ? 0.2 : 0.08) * (0.7 + g * 0.5) * (1.1 - t * 0.4);
      const end = p.clone().add(out.clone().multiplyScalar(plen)).add(new V3(0, -0.02, 0));
      b.stem([p, p.clone().lerp(end, 0.5).add(new V3(0, 0.02, 0)), end], 0.004, 0.0025, { color: sp.stemCol ?? '#5f8f3a', radial: 3 });
      const leafLen = (sp.leafLen ?? 0.1) * (0.8 + g * 0.55);
      if (sp.compound > 1) {
        const pairs = Math.floor(sp.compound / 2);
        for (let q = 0; q <= pairs; q++) {
          const pp = p.clone().lerp(end, 0.35 + (q / Math.max(1, pairs)) * 0.65);
          if (q === pairs) { b.leaf({ len: leafLen, wid: leafLen * 0.6, shape: sp.leafShape, serr: 0.25, teeth: 8, fold: 0.3, droop: 0.35, color: sp.leaf, tip: sp.tip }, end, out, Y); continue; }
          const side = new V3().crossVectors(out, Y).normalize();
          for (const s of [-1, 1]) b.leaf({ len: leafLen * 0.85, wid: leafLen * 0.5, shape: sp.leafShape, serr: 0.25, teeth: 8, fold: 0.3, droop: 0.35, color: sp.leaf, tip: sp.tip }, pp, side.clone().multiplyScalar(s).add(out.clone().multiplyScalar(0.5)).normalize(), Y);
        }
      } else {
        b.leaf({ len: leafLen, wid: leafLen * 0.6, shape: sp.leafShape, fold: 0.3, droop: 0.4, ruffle: 0.6, color: jitter(col(sp.leaf), b.r).getStyle(), tip: sp.tip }, end, out, Y);
      }
    }
    if (g >= 1) {
      const fruits = { tomato: 3, eggplant: 2, pepper: 3, beanstalk: 4 }[Object.keys(SPECIES).find((k) => SPECIES[k] === sp)] ?? 3;
      for (let i = 0; i < fruits; i++) {
        const t = 0.35 + (i / fruits) * 0.45, p = c.getPointAt(t);
        const a = i * 2.3 + 1;
        b.anchor(p.clone().add(new V3(Math.cos(a) * 0.09, -0.03, Math.sin(a) * 0.09)), true);
      }
    } else if (g >= 0.75 && sp.leafShape !== 'heart') {
      for (let i = 0; i < 3; i++) flower(b, c.getPointAt(0.4 + i * 0.15).add(new V3(0.07, 0, 0)), new V3(0.4, -0.6, 0.2), { color: '#f7e25a', center: '#e0b02a', len: 0.018, wid: 0.012, n: 5 });
    }
  },

  sprawl(b, sp, g) {
    mound(b, 0.22, 0.05);
    const vines = b.n(3 + g * 2);
    const big = sp.leafShape === 'heart';
    for (let i = 0; i < vines; i++) {
      const a = (i / vines) * TAU + 0.3;
      const len = 0.35 + g * 0.55;
      const pts = [];
      for (let k = 0; k <= 6; k++) {
        const t = k / 6;
        const w = a + Math.sin(t * 4 + i) * 0.25;
        pts.push(new V3(Math.cos(w) * len * t, 0.025 + Math.sin(t * Math.PI) * 0.03, Math.sin(w) * len * t));
      }
      b.stem(pts, 0.011, 0.005, { color: '#6a9a3a', radial: 5 });
      const c = new THREE.CatmullRomCurve3(pts);
      const nl = b.n(2 + g * 4);
      for (let k = 0; k < nl; k++) {
        const t = 0.15 + (k / nl) * 0.85, p = c.getPointAt(t);
        const ll = (big ? 0.22 : 0.17) * (0.6 + g * 0.5) * (0.8 + b.r() * 0.4);
        const lift = ll * (0.35 + b.r() * 0.75);
        const la = a + (b.r() - 0.5) * 2.2;
        const top = p.clone().add(new V3(Math.cos(la) * 0.03, lift, Math.sin(la) * 0.03));
        b.stem([p, p.clone().lerp(top, 0.5).add(new V3(0, lift * 0.25, 0)), top], 0.004, 0.003, { color: '#6f9a40', radial: 3 });
        const d = new V3(Math.cos(la), 0.15 + b.r() * 0.35, Math.sin(la)).normalize();
        const face = new V3((b.r() - 0.5) * 0.6, 1, (b.r() - 0.5) * 0.6).normalize();
        b.leaf({ len: ll, wid: ll * (big ? 1.0 : 0.9), shape: sp.leafShape, serr: big ? 0.12 : 0.05, teeth: big ? 7 : 3, fold: 0.28, droop: 0.55, curl: 0.25, ruffle: 1.2, color: jitter(col(sp.leaf), b.r).getStyle(), tip: sp.tip, seg: 7, wseg: 2 }, top, d, face);
      }
      // curly tendril
      const tp = c.getPointAt(0.6);
      const spiral = Array.from({ length: 8 }, (_, k) => tp.clone().add(new V3(Math.cos(k) * 0.02, 0.02 + k * 0.008, Math.sin(k) * 0.02)));
      b.stem(spiral, 0.0018, 0.0012, { color: '#8ab05a', radial: 3 });
    }
    if (g >= 0.75 && g < 1) flower(b, new V3(0.12, 0.08, 0.05), new V3(0, 1, 0), { color: '#f8c21a', center: '#e09a1a', len: 0.05, wid: 0.04, n: 5, cup: 0.8 });
    if (g >= 1) b.anchor(new V3(0.2, 0.0, 0.12), false);
  },

  brassica(b, sp, g) {
    mound(b, 0.26, 0.05);
    const leaves = b.n(6 + g * 8);
    for (let i = 0; i < leaves; i++) {
      const a = i * GOLDEN, t = i / leaves;
      const el = 0.55 + t * 0.7;
      const dir = new V3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el));
      const len = sp.h * g * (1.0 - t * 0.3) * 0.75;
      b.leaf({ len, wid: len * 0.6, shape: 'ovate', fold: 0.35, droop: 0.15 + (1 - t) * 0.4, curl: 0.4, ruffle: 0.9, color: jitter(col(sp.leaf), b.r, 0.08).getStyle(), tip: sp.tip, seg: 8, wseg: 3 }, new V3(0, 0.03, 0), dir, new V3(-dir.x, 0.3, -dir.z).normalize());
    }
    if (g >= 1) b.anchor(new V3(0, 0.1, 0), false);
  },

  tree(b, sp, g) {
    mound(b, 0.24, 0.05);
    const h = sp.h * g;
    const trunkH = h * 0.45;
    const trunk = [new V3(0, 0, 0), new V3(0.02, trunkH * 0.5, 0.01), new V3(0, trunkH, 0)];
    b.stem(trunk, 0.05 * (0.4 + g * 0.6), 0.032 * (0.4 + g * 0.6), { color: sp.bark, color2: sp.bark, bark: true, radial: 8 }, 'bark');
    const top = trunk.at(-1);
    const branches = b.n(3 + g * 2);
    const tips = [];
    for (let i = 0; i < branches; i++) {
      const a = (i / branches) * TAU + b.r() * 0.5;
      const up = sp.upright ? 1.6 : 0.9;
      const dir = new V3(Math.cos(a), up, Math.sin(a)).normalize();
      const len = (h - trunkH) * (0.75 + b.r() * 0.3);
      const pts = path(top, dir, len, { bend: -0.15, steps: 3, side: Y, gravity: 0.1 });
      b.stem(pts, 0.03 * g + 0.006, 0.008, { color: sp.bark, bark: true, radial: 6 }, 'bark');
      tips.push(pts);
      // twigs, dense foliage clumps (cards) and real leaves at the twig tips
      const c = new THREE.CatmullRomCurve3(pts);
      const clusters = b.n(3);
      const canopyR = (h - trunkH) * 0.55;
      for (let k = 0; k < clusters; k++) {
        const t = 0.35 + (k / clusters) * 0.65, p = c.getPointAt(t);
        const ta = a + (k - 1.5) * 0.8;
        const td = new V3(Math.cos(ta), 0.5, Math.sin(ta)).normalize();
        const tp = p.clone().add(td.clone().multiplyScalar(0.14 * g + 0.04));
        b.stem([p, tp], 0.008, 0.003, { color: sp.bark, radial: 4 }, 'bark');
        b.clump(tp.clone().add(new V3(0, 0.04, 0)), canopyR * (0.75 + b.r() * 0.35), sp.leaf, sp.tip);
        const nl = b.n(3);
        for (let l = 0; l < nl; l++) {
          const la = l * GOLDEN + ta;
          const ld = new V3(Math.cos(la), 0.25 + b.r() * 0.5, Math.sin(la)).normalize();
          b.leaf({ len: sp.leafLen * (0.9 + b.r() * 0.35), wid: sp.leafLen * 0.38, shape: sp.leafShape, fold: 0.3, droop: 0.45, twist: (b.r() - 0.5) * 0.6, color: jitter(col(sp.leaf), b.r, 0.08).getStyle(), tip: sp.tip }, tp, ld, Y);
        }
      }
      b.clump(pts.at(-1).clone().add(new V3(0, 0.05, 0)), canopyR * 0.9, sp.leaf, sp.tip);
    }
    // fill the middle of the crown so the canopy reads as one rounded mass
    const crownY = trunkH + (h - trunkH) * (sp.upright ? 0.75 : 0.62);
    for (let i = 0; i < b.n(4); i++) {
      const a = (i / 4) * TAU + 0.4;
      b.clump(new V3(Math.cos(a) * (h - trunkH) * 0.25, crownY + (i % 2) * 0.08, Math.sin(a) * (h - trunkH) * 0.25), (h - trunkH) * 0.62, sp.leaf, sp.tip);
    }
    b.clump(new V3(0, crownY + (h - trunkH) * 0.22, 0), (h - trunkH) * 0.6, sp.leaf, sp.tip);
    if (g >= 1) {
      const count = { cacao: 3, mango: 3, nectarine: 3, pear: 3, avocado: 2, sugarapple: 2 }[Object.keys(SPECIES).find((k) => SPECIES[k] === sp)] ?? 3;
      for (let i = 0; i < count; i++) {
        if (sp.cauliflory) { const a = i * 2.2; b.anchor(new V3(Math.cos(a) * 0.05, trunkH * (0.35 + i * 0.2), Math.sin(a) * 0.05), true); continue; }
        const pts = tips[i % tips.length];
        const c = new THREE.CatmullRomCurve3(pts);
        b.anchor(c.getPointAt(0.55).add(new V3(0, -0.06, 0)), true);
      }
    }
  },

  palm(b, sp, g) {
    mound(b, 0.24, 0.05);
    const h = sp.h * g;
    const pts = [];
    for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push(new V3(Math.sin(t * 1.4) * 0.18 * t, t * h, 0)); }
    b.stem(pts, 0.07 * (0.5 + g * 0.5), 0.05 * (0.5 + g * 0.5), { color: sp.bark, bark: true, radial: 8, segs: 18 }, 'bark');
    const c = new THREE.CatmullRomCurve3(pts);
    for (let i = 1; i < 10; i++) { const p = c.getPointAt(i / 10); b.add('bark', place(torus(0.06 * (0.5 + g * 0.5) * (1 - i * 0.02), 0.008, { rs: 3, ts: 10, color: '#6f5a40' }), { pos: [p.x, p.y, p.z], rot: [Math.PI / 2, 0, 0] })); }
    const crown = pts.at(-1);
    const fronds = b.n(5 + g * 4);
    for (let i = 0; i < fronds; i++) {
      const a = (i / fronds) * TAU;
      const dir = new V3(Math.cos(a), 0.55 - (i % 2) * 0.25, Math.sin(a)).normalize();
      const len = 0.9 * g + 0.15;
      const fp = path(crown, dir, len, { steps: 4, gravity: 0.9 });
      b.stem(fp, 0.012, 0.004, { color: '#9a9a4a', radial: 4 });
      const fc = new THREE.CatmullRomCurve3(fp);
      const leaflets = b.n(6);
      for (let k = 1; k <= leaflets; k++) {
        const t = k / (leaflets + 1), p = fc.getPointAt(t), tan = fc.getTangentAt(t);
        const side = new V3().crossVectors(tan, Y).normalize();
        for (const s of [-1, 1]) {
          const d = side.clone().multiplyScalar(s).add(tan.clone().multiplyScalar(0.7)).add(new V3(0, -0.5, 0)).normalize();
          b.leaf({ len: 0.24 * (1 - Math.abs(t - 0.4) * 0.8), wid: 0.035, shape: 'lanceolate', fold: 0.4, droop: 0.25, color: sp.leaf, tip: sp.tip, seg: 4 }, p, d, Y);
        }
      }
    }
    if (g >= 1) for (let i = 0; i < 2; i++) { const a = i * Math.PI + 0.6; b.anchor(crown.clone().add(new V3(Math.cos(a) * 0.08, -0.08, Math.sin(a) * 0.08)), true); }
  },

  banana(b, sp, g) {
    mound(b, 0.26, 0.05);
    const h = sp.h * g;
    b.stem([new V3(0, 0, 0), new V3(0.01, h * 0.5, 0), new V3(0, h * 0.75, 0)], 0.075 * (0.5 + g * 0.5), 0.05, { color: '#7a8a4a', color2: '#9aa45a', radial: 9 });
    const leaves = b.n(7 + g * 4);
    for (let i = 0; i < leaves; i++) {
      const a = i * GOLDEN;
      const el = 0.9 - (i / leaves) * 0.6;
      const dir = new V3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el));
      const len = (0.6 + g * 0.8) * (0.8 + b.r() * 0.25);
      const base = new V3(0, h * 0.72, 0);
      const pp = base.clone().add(dir.clone().multiplyScalar(0.15));
      b.stem([base, pp], 0.012, 0.01, { color: '#8a9a4a', radial: 4 });
      b.leaf({ len, wid: len * 0.34, shape: 'paddle', fold: 0.12, droop: 0.9, ruffle: 1.6, serr: 0.06, teeth: 22, color: jitter(col(sp.leaf), b.r).getStyle(), tip: sp.tip, seg: 10, wseg: 3 }, pp, dir, Y);
    }
    if (g >= 1) {
      const hang = [new V3(0, h * 0.72, 0), new V3(0.16, h * 0.68, 0.05), new V3(0.22, h * 0.48, 0.07)];
      b.stem(hang, 0.012, 0.01, { color: '#7a8a4a', radial: 5 });
      b.add('fruitMatte', place(lathe([[0, -0.12], [0.04, -0.06], [0.05, 0], [0.03, 0.05], [0, 0.07]], { segs: 10, color: '#7a2a4a', color2: '#9a3a5a' }), { pos: [0.23, h * 0.4, 0.07] }));
      for (let i = 0; i < 4; i++) b.anchor(new V3(0.22 + Math.cos(i * 1.6) * 0.05, h * 0.5 - 0.02 - i * 0.05, 0.07 + Math.sin(i * 1.6) * 0.05), true);
    }
  },

  opuntia(b, sp, g) {
    mound(b, 0.24, 0.05);
    const pads = [];
    const add = (p, rot, s, depth) => {
      const pad = blob(0.13 * s, 0.17 * s, 0.035 * s, { detail: b.detail < 0.5 ? 1 : 2, noise: 0.08, color: sp.leaf, seed: pads.length + 3 });
      place(pad, { pos: [p.x, p.y + 0.15 * s, p.z], rot });
      b.add('stem', pad);
      pads.push({ p: p.clone().add(new V3(0, 0.3 * s, 0)), s, rot });
      // spine dots
      if (b.detail >= 0.5) for (let k = 0; k < 6; k++) {
        const sp2 = place(cone(0.004, 0.02, { segs: 3, color: '#e8e0b0' }), { pos: [p.x + (b.r() - 0.5) * 0.12 * s, p.y + 0.15 * s + (b.r() - 0.5) * 0.2 * s, p.z + 0.035 * s], rot: [Math.PI / 2, 0, 0] });
        b.add('fruitMatte', sp2);
      }
      if (depth > 0) for (const side of [-1, 1]) if (b.r() < 0.85) add(p.clone().add(new V3(side * 0.09 * s, 0.28 * s, 0)), [rot[0], rot[1] + side * 0.4, side * 0.45], s * 0.8, depth - 1);
    };
    add(new V3(0, 0, 0), [0, 0.3, 0], 0.6 + g * 0.6, g > 0.7 ? 2 : g > 0.4 ? 1 : 0);
    if (g >= 1) for (let i = 0; i < 2; i++) { const pd = pads[pads.length - 1 - i]; b.anchor(pd.p.clone(), false); }
  },

  climbCactus(b, sp, g) {
    mound(b, 0.24, 0.05);
    b.add('wood', place(box(0.07, sp.h + 0.1, 0.07, { color: '#9a8a72' }), { pos: [0, (sp.h + 0.1) / 2 - 0.05, 0] }));
    const top = sp.h * g;
    b.stem([new V3(0.045, 0.02, 0), new V3(0.05, top * 0.5, 0.01), new V3(0.04, top, 0)], 0.04, 0.035, { color: sp.leaf, color2: '#6a9a4a', radial: 3, segs: 10 });
    const arms = b.n(4 + g * 5);
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * TAU + b.r() * 0.4;
      const out = new V3(Math.cos(a), 0, Math.sin(a));
      const reach = 0.25 + g * 0.22 + b.r() * 0.1;
      const pts = [new V3(0, top, 0), out.clone().multiplyScalar(reach * 0.45).add(new V3(0, top + 0.14, 0)), out.clone().multiplyScalar(reach * 0.85).add(new V3(0, top - 0.02, 0)), out.clone().multiplyScalar(reach).add(new V3(0, top - 0.32 * g, 0))];
      b.stem(pts, 0.034, 0.024, { color: jitter(col(sp.leaf), b.r).getStyle(), color2: '#7aaa5a', radial: 3, segs: 12 });
      if (g >= 1 && i < 2) b.anchor(pts.at(-1).clone().add(new V3(0, -0.03, 0)), true);
    }
  },

  lily(b, sp, g) {
    mound(b, 0.2, 0.05);
    const stems = sp.star ? 3 : 2;
    for (let s = 0; s < stems; s++) {
      const a = s * 2.4;
      const h = sp.h * g * (0.85 + s * 0.1);
      const pts = path(new V3(Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04), new V3(Math.cos(a) * 0.15, 1, Math.sin(a) * 0.15), h, { steps: 4, bend: 0.1 });
      b.stem(pts, 0.008, 0.005, { color: '#4f8f3a', radial: 5 });
      const c = new THREE.CatmullRomCurve3(pts);
      for (let k = 0; k < b.n(6 + g * 6); k++) {
        const t = 0.1 + (k / (6 + g * 6)) * 0.7, p = c.getPointAt(t);
        const la = k * GOLDEN;
        b.leaf({ len: 0.13 * (1.1 - t * 0.5), wid: 0.025, shape: 'lanceolate', fold: 0.3, droop: 0.35, color: sp.leaf, tip: sp.tip, seg: 5 }, p, new V3(Math.cos(la), 0.7, Math.sin(la)).normalize(), Y);
      }
      const top = pts.at(-1);
      if (g >= 0.75 && g < 1) b.add('petal', place(blob(0.025, 0.06, 0.025, { detail: 1, color: '#7fae5a' }), { pos: [top.x, top.y + 0.04, top.z] }));
      if (g >= 1) b.anchor(top.clone(), true);
    }
  },

  orchid(b, sp, g) {
    b.add('wood', place(lathe([[0.1, 0], [0.12, 0.14], [0.13, 0.16], [0, 0.16]], { segs: 16, color: '#d9d2c5' }), { pos: [0, -0.02, 0] }));
    for (let i = 0; i < b.n(3 + g * 3); i++) {
      const a = i * 2.4;
      b.leaf({ len: 0.2 * (0.6 + g * 0.5), wid: 0.07, shape: 'strap', fold: 0.3, droop: 0.7, color: sp.leaf, tip: '#5f9f5a', seg: 6 }, new V3(0, 0.15, 0), new V3(Math.cos(a), 0.6, Math.sin(a)).normalize(), Y);
    }
    if (g > 0.5) {
      const pts = [new V3(0, 0.15, 0), new V3(0.02, 0.15 + sp.h * g * 0.6, 0), new V3(0.12, 0.15 + sp.h * g * 0.85, 0)];
      b.stem(pts, 0.004, 0.003, { color: '#5a7a3a', radial: 4 });
      if (g >= 1) b.anchor(pts.at(-1).clone(), true);
    }
  },

  bromeliad(b, sp, g) {
    mound(b, 0.24, 0.05);
    const leaves = b.n(10 + g * 12);
    for (let i = 0; i < leaves; i++) {
      const a = i * GOLDEN, t = i / leaves;
      const el = 0.35 + t * 0.9;
      const dir = new V3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el));
      b.leaf({ len: sp.h * g * (0.75 - t * 0.25), wid: 0.05, shape: 'strap', serr: 0.12, teeth: 26, fold: 0.6, droop: 0.45, color: jitter(col(sp.leaf), b.r).getStyle(), tip: sp.tip, seg: 6 }, new V3(0, 0.04, 0), dir, Y);
    }
    if (g >= 1) b.anchor(new V3(0, 0.22, 0), false);
  },

  trellis(b, sp, g) {
    mound(b, 0.22, 0.05);
    const H = sp.h;
    b.stem([new V3(0, -0.05, 0), new V3(0, H, 0)], 0.022, 0.02, { color: sp.wood, radial: 6 }, 'wood');
    b.add('wood', place(box(0.9, 0.04, 0.05, { color: '#8a6a48' }), { pos: [0, H, 0] }));
    for (const x of [-0.4, -0.13, 0.13, 0.4]) b.stem([new V3(x, H, -0.03), new V3(x, H, 0.03)], 0.002, 0.002, { color: '#b0b0a0', radial: 3 }, 'wood');
    const vine = [new V3(0.03, 0, 0), new V3(0.04, H * g * 0.5, 0.02), new V3(0.03, H * g * 0.95, 0)];
    b.stem(vine, 0.018, 0.01, { color: '#6a5038', bark: true, radial: 6 }, 'bark');
    if (g > 0.5) {
      for (const s of [-1, 1]) {
        const arm = [vine.at(-1), new V3(s * 0.2, H * g + 0.02, 0.03), new V3(s * 0.42 * g, H * g - 0.02, 0)];
        b.stem(arm, 0.01, 0.006, { color: '#6a5038', radial: 5 }, 'bark');
        const c = new THREE.CatmullRomCurve3(arm);
        for (let k = 0; k < b.n(8); k++) {
          const p = c.getPointAt(0.1 + k / 9);
          const la = k * 2.3 + s;
          b.leaf({ len: 0.13, wid: 0.12, shape: 'round', fold: 0.15, droop: 0.4, color: jitter(col(sp.leaf), b.r).getStyle(), tip: sp.tip, seg: 6 }, p, new V3(Math.cos(la), 0.25, Math.sin(la)).normalize(), Y);
        }
        for (let k = 0; k < 3; k++) b.clump(c.getPointAt(0.2 + k * 0.35).add(new V3(0, 0.06, 0)), 0.32 * g + 0.08, sp.leaf, sp.tip);
        if (g >= 1) for (let k = 0; k < 2; k++) b.anchor(c.getPointAt(0.35 + k * 0.4).add(new V3(0, -0.08, 0.06)), true);
      }
    }
  },

  blossom(b, sp, g) {
    mound(b, 0.25, 0.05);
    const h = sp.h * g;
    const trunk = [new V3(0, 0, 0), new V3(0.05, h * 0.25, 0.02), new V3(-0.02, h * 0.45, 0)];
    b.stem(trunk, 0.055 * (0.4 + g * 0.6), 0.035, { color: sp.bark, bark: true, radial: 8 }, 'bark');
    const top = trunk.at(-1);
    const branches = b.n(4 + g);
    const tips = [];
    for (let i = 0; i < branches; i++) {
      const a = (i / branches) * TAU + 0.3;
      const dir = new V3(Math.cos(a), 0.7, Math.sin(a)).normalize();
      const pts = path(top, dir, h * 0.55, { steps: 3, bend: 0.2, side: new V3(-Math.sin(a), 0, Math.cos(a)), gravity: 0.1 });
      b.stem(pts, 0.025 * g + 0.005, 0.006, { color: sp.bark, bark: true, radial: 5 }, 'bark');
      tips.push(pts);
      const c = new THREE.CatmullRomCurve3(pts);
      const clusters = b.n(g < 1 ? 2 : 4);
      const slot = g < 0.75 ? 'foliage' : sp.glow ? 'blossomGlow' : 'blossom';
      for (let k = 0; k < clusters + 1; k++) {
        const p = c.getPointAt(0.35 + (k / clusters) * 0.65);
        b.clump(p.clone().add(new V3(0, 0.05, 0)), h * 0.32, g < 0.75 ? '#5a8a3a' : sp.petal, g < 0.75 ? '#8ab05a' : sp.petal2, slot);
      }
      for (let k = 0; k < 1; k++) {
        const p = c.getPointAt(0.75);
        const fl = g < 0.75 ? 2 : 1;
        for (let f = 0; f < fl; f++) {
          const d = new V3(b.r() - 0.5, 0.4 + b.r() * 0.6, b.r() - 0.5).normalize();
          const at = p.clone().add(d.clone().multiplyScalar(0.05 + b.r() * 0.05));
          if (g < 0.75) b.leaf({ len: 0.07, wid: 0.03, shape: 'ovate', color: '#5a8a3a', tip: '#8ab05a', seg: 4 }, at, d, Y);
          else flower(b, at, d, { n: 5, len: 0.04, wid: 0.035, color: jitter(col(sp.petal), b.r, 0.05).getStyle(), center: sp.glow ? '#ffffff' : '#f5d35a', cup: 0.3, slot: sp.glow ? 'glow' : 'petal' });
        }
      }
    }
    const crownY = h * 0.78;
    const cslot = g < 0.75 ? 'foliage' : sp.glow ? 'blossomGlow' : 'blossom';
    for (let i = 0; i < b.n(4); i++) {
      const a = (i / 4) * TAU + 0.8;
      b.clump(new V3(Math.cos(a) * h * 0.14, crownY + (i % 2) * 0.1, Math.sin(a) * h * 0.14), h * 0.4, g < 0.75 ? '#5a8a3a' : sp.petal, g < 0.75 ? '#8ab05a' : sp.petal2, cslot);
    }
    b.clump(new V3(0, crownY + h * 0.14, 0), h * 0.38, g < 0.75 ? '#5a8a3a' : sp.petal, g < 0.75 ? '#8ab05a' : sp.petal2, cslot);
    if (g >= 1) {
      const count = { candyblossom: 3, cherryblossom: 4, moonblossom: 3 }[Object.keys(SPECIES).find((k) => SPECIES[k] === sp)] ?? 3;
      for (let i = 0; i < count; i++) b.anchor(new THREE.CatmullRomCurve3(tips[i % tips.length]).getPointAt(0.6).add(new V3(0, -0.07, 0)), true);
    }
  },
};

/** Build one crop at a stage (0-4) and detail (1 = LOD0, 0.35 = LOD1). */
export function buildPlant(cropId, stage, detail = 1) {
  const sp = SPECIES[cropId];
  const b = new Builder(detail, hashStr(cropId) + stage * 7919);
  if (stage <= 1) seedling(b, sp, stage);
  else FAMILY[sp.family](b, sp, [0, 0, 0.45, 0.75, 1][stage]);
  const meshes = {};
  for (const [slot, list] of Object.entries(b.parts)) {
    const g = merge(list);
    if (!g) continue;
    bakeAO(g, { floor: 0, height: Math.max(0.3, (sp.h ?? 1) * 0.6), strength: 0.35 });
    meshes[slot] = g;
  }
  return { meshes, anchors: b.anchors };
}

// ---- Fruit models (the harvested item and what hangs on the plant) ---------------

const F = {
  carrot: (s) => lathe([[0, -0.2], [0.012, -0.17], [0.03, -0.08], [0.04, 0], [0.038, 0.02], [0.02, 0.03], [0, 0.03]], { segs: 12, color: '#d9631a', color2: '#f08a2c', bumps: 0.015 }),
  strawberry: () => lathe([[0, -0.045], [0.018, -0.035], [0.028, -0.01], [0.027, 0.012], [0.016, 0.022], [0, 0.024]], { segs: 14, color: '#c9141f', color2: '#e8323a', bumps: 0.02 }),
  blueberry: () => blob(0.016, 0.014, 0.016, { detail: 4, color: '#3a4a92' }),
  bamboo: () => lathe([[0.04, -0.12], [0.045, -0.06], [0.035, 0.02], [0.015, 0.09], [0, 0.11]], { segs: 12, ribs: 8, ribDepth: 0.06, color: '#b8b06a', color2: '#d8d39a' }),
  tomato: () => lathe([[0, -0.04], [0.03, -0.035], [0.045, -0.01], [0.044, 0.01], [0.03, 0.03], [0, 0.032]], { segs: 18, ribs: 6, ribDepth: 0.07, color: '#c81e14', color2: '#e8402a' }),
  eggplant: () => lathe([[0, -0.15], [0.035, -0.13], [0.05, -0.07], [0.042, 0], [0.025, 0.04], [0.016, 0.05], [0, 0.052]], { segs: 16, color: '#3a1546', color2: '#5a2a6a' }),
  pepper: () => lathe([[0, -0.07], [0.03, -0.065], [0.045, -0.02], [0.045, 0.02], [0.035, 0.04], [0, 0.042]], { segs: 18, ribs: 4, ribDepth: 0.14, color: '#c81a14', color2: '#e8321a' }),
  pumpkin: () => lathe([[0, -0.13], [0.12, -0.12], [0.2, -0.05], [0.2, 0.04], [0.12, 0.1], [0.03, 0.11], [0, 0.1]], { segs: 24, ribs: 10, ribDepth: 0.1, color: '#d9620a', color2: '#f2902a' }),
  cauliflower: () => { const g = blob(0.13, 0.08, 0.13, { detail: 4, noise: 0.18, color: '#f0e6c8', seed: 21 }); return g; },
  beanstalk: () => { const pts = [new V3(0, 0, 0), new V3(0.02, -0.06, 0), new V3(0.01, -0.13, 0.01), new V3(-0.02, -0.19, 0)]; return stem(pts, 0.012, 0.007, { radial: 7, color: '#4f9a35', color2: '#6ab248' }); },
  cacao: () => lathe([[0, -0.12], [0.04, -0.1], [0.06, -0.03], [0.058, 0.03], [0.035, 0.08], [0, 0.1]], { segs: 18, ribs: 10, ribDepth: 0.1, color: '#a8521a', color2: '#d8922a' }),
  cactus: () => blob(0.035, 0.05, 0.035, { detail: 4, noise: 0.06, color: '#b8285a', seed: 4 }),
  watermelon: () => lathe([[0, -0.15], [0.12, -0.13], [0.17, -0.05], [0.17, 0.05], [0.12, 0.13], [0, 0.15]], { segs: 22, color: '#2f6a28', stripes: 8, stripeColor: '#9acb6a' }),
  coconut: () => blob(0.08, 0.09, 0.075, { detail: 4, noise: 0.05, color: '#6a4a2a', seed: 8 }),
  mango: () => { const g = blob(0.055, 0.075, 0.045, { detail: 4, noise: 0.03, color: '#e8a01e', seed: 6 }); return g; },
  nectarine: () => lathe([[0, -0.05], [0.035, -0.045], [0.052, -0.01], [0.05, 0.02], [0.03, 0.045], [0, 0.048]], { segs: 18, ribs: 1, ribDepth: 0.05, color: '#d8402a', color2: '#f0a03a' }),
  pear: () => lathe([[0, -0.07], [0.04, -0.065], [0.055, -0.035], [0.045, 0.005], [0.025, 0.035], [0.018, 0.06], [0, 0.068]], { segs: 18, color: '#b8b02a', color2: '#d8d05a' }),
  avocado: () => lathe([[0, -0.07], [0.042, -0.06], [0.05, -0.025], [0.04, 0.015], [0.022, 0.05], [0, 0.058]], { segs: 16, bumps: 0.03, color: '#2f4a1a', color2: '#4a6a2a' }),
  banana: () => { const pts = [new V3(0, 0, 0), new V3(0.035, -0.05, 0), new V3(0.06, -0.13, 0), new V3(0.05, -0.21, 0), new V3(0.035, -0.235, 0)]; return stem(pts, 0.022, 0.012, { radial: 5, segs: 14, color: '#b8a02a', color2: '#f2d84a' }); },
  dragonfruit: () => { const g = lathe([[0, -0.07], [0.04, -0.06], [0.055, -0.01], [0.05, 0.03], [0.025, 0.06], [0, 0.065]], { segs: 16, color: '#d82a6a', color2: '#e84a8a', bumps: 0.06 }); return g; },
  pinklily: () => null,
  pineapple: () => lathe([[0, -0.1], [0.055, -0.09], [0.07, -0.03], [0.065, 0.04], [0.045, 0.08], [0, 0.085]], { segs: 18, bumps: 0.1, color: '#c8862a', color2: '#d8a23a' }),
  kiwi: () => blob(0.032, 0.042, 0.03, { detail: 4, noise: 0.03, color: '#7a5a32', seed: 12 }),
  candyblossom: () => null,
  cherryblossom: () => blob(0.022, 0.021, 0.022, { detail: 4, color: '#b0101f' }),
  sugarapple: () => blob(0.06, 0.06, 0.06, { detail: 4, noise: 0.22, color: '#8ab45a', seed: 31 }),
  moonblossom: () => null,
  orchid: () => null,
  starflower: () => null,
};

/** Flower-type "fruits" (blooms): built with petals. */
function bloomFruit(cropId) {
  const sp = SPECIES[cropId];
  const b = new Builder(1, hashStr(cropId) + 99);
  const at = new V3(0, 0, 0), up = new V3(0, 1, 0);
  if (cropId === 'pinklily') {
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; b.leaf({ len: 0.11, wid: 0.045, shape: 'lanceolate', fold: 0.35, droop: -0.6, color: sp.petal, tip: sp.petal2, seg: 6, wseg: 2 }, at, new V3(Math.cos(a), 1.1, Math.sin(a)).normalize(), up, 'petal'); }
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + 0.3; b.stem([new V3(0, 0, 0), new V3(Math.cos(a) * 0.02, 0.07, Math.sin(a) * 0.02)], 0.0015, 0.001, { color: '#e8d8a0', radial: 3 }); b.add('fruitMatte', place(blob(0.004, 0.009, 0.004, { detail: 1, color: '#a8522a' }), { pos: [Math.cos(a) * 0.02, 0.075, Math.sin(a) * 0.02] })); }
  } else if (cropId === 'orchid') {
    flower(b, at, new V3(0, 0.3, 1).normalize(), { n: 5, len: 0.06, wid: 0.05, color: sp.petal, center: '#ffe060', cup: 0.1 });
    b.leaf({ len: 0.05, wid: 0.06, shape: 'round', fold: 0.6, droop: 0.4, color: '#a03ac0', tip: '#e8b0ff' }, at, new V3(0, -0.6, 1).normalize(), up, 'petal');
  } else if (cropId === 'starflower') {
    for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; b.leaf({ len: 0.07, wid: 0.04, shape: 'lanceolate', fold: 0.3, droop: -0.2, color: sp.petal, tip: sp.petal2, seg: 5 }, at, new V3(Math.cos(a), 0.5, Math.sin(a)).normalize(), up, 'glow'); }
    b.add('glow', sphere(0.015, { color: '#fff6c0' }));
  } else {
    const slot = sp.glow ? 'glow' : 'petal';
    const centres = cropId === 'candyblossom' ? 5 : 3;
    for (let k = 0; k < centres; k++) {
      const a = (k / centres) * TAU;
      const c = new V3(Math.cos(a) * 0.035, (k % 2) * 0.02, Math.sin(a) * 0.035);
      flower(b, c, c.clone().add(new V3(0, 0.6, 0)).normalize(), { n: 5, len: 0.04, wid: 0.035, color: sp.petal, center: sp.glow ? '#ffffff' : '#f5d35a', cup: 0.3, slot });
    }
  }
  const meshes = {};
  for (const [slot, list] of Object.entries(b.parts)) meshes[slot] = merge(list);
  return meshes;
}

/** Fruit meshes by material slot, origin at the attachment point (stalk top). */
export function buildFruit(cropId) {
  const make = F[cropId];
  const g = make ? make() : null;
  if (!g) return bloomFruit(cropId);
  const geo = merge([g]);
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const matte = ['kiwi', 'coconut', 'cauliflower', 'pineapple', 'cacao', 'bamboo', 'avocado', 'sugarapple'].includes(cropId);
  // hang from the top: move the top of the fruit to the origin
  geo.translate(0, -bb.max.y, 0);
  const out = { [matte ? 'fruitMatte' : 'fruit']: geo };
  // calyx / stalk / crown details
  const extras = [];
  const top = 0;
  if (['tomato', 'eggplant', 'pepper', 'strawberry', 'nectarine', 'pear', 'mango', 'avocado', 'cherryblossom'].includes(cropId)) {
    extras.push(place(cyl(0.003, 0.004, 0.025, { segs: 5, color: '#5a7a2a' }), { pos: [0, top + 0.01, 0] }));
    if (['tomato', 'eggplant', 'strawberry', 'pepper'].includes(cropId)) {
      for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; extras.push(place(leafBlade({ len: cropId === 'eggplant' ? 0.04 : 0.025, wid: 0.012, shape: 'lanceolate', fold: 0.2, droop: -0.4, color: '#4f7a2a', tip: '#6a9a3a', seg: 3, wseg: 1 }), { pos: [0, top - 0.004, 0], quat: orient(new V3(Math.cos(a), -0.35, Math.sin(a)).normalize()) })); }
    }
    if (cropId === 'pear' || cropId === 'nectarine' || cropId === 'mango') extras.push(place(leafBlade({ len: 0.05, wid: 0.022, shape: 'lanceolate', color: '#3f7a30', tip: '#5f9a40', seg: 4, wseg: 1 }), { pos: [0, top + 0.015, 0], quat: orient(new V3(0.8, 0.5, 0).normalize()) }));
  }
  if (cropId === 'pineapple') {
    for (let i = 0; i < 12; i++) { const a = i * GOLDEN; extras.push(place(leafBlade({ len: 0.08 - (i / 12) * 0.03, wid: 0.018, shape: 'strap', fold: 0.5, droop: 0.2, color: '#4f7f4a', tip: '#7a9f4a', seg: 4, wseg: 1 }), { pos: [0, top, 0], quat: orient(new V3(Math.cos(a) * 0.5, 1, Math.sin(a) * 0.5).normalize()) })); }
  }
  if (cropId === 'carrot') {
    for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; extras.push(place(leafBlade({ len: 0.09, wid: 0.02, shape: 'lanceolate', serr: 0.4, teeth: 6, color: '#3f8a2f', tip: '#6fb048', seg: 4, wseg: 1 }), { pos: [0, top, 0], quat: orient(new V3(Math.cos(a) * 0.4, 1, Math.sin(a) * 0.4).normalize()) })); }
  }
  if (extras.length) out.stem = merge(extras);
  return out;
}
