// Village props: stalls, trees, bushes, fences, rocks, flowers, fountain, signs, lamps, benches.
import * as THREE from 'three';
import { balloonProp } from './balloon.js';
import { V3, TAU, GOLDEN, rand, col, jitter, finish, merge, place, blob, cyl, cone, box, roundedBox, lathe, stem, path, cards, sphere, torus, triCount, leafBlade, bakeAO } from './lib/geo.js';

const GOLD = '#E8B53A', RED = '#B3181B', RED_D = '#8E1118', JADE = '#2E8B57', DARK = '#17171A';

function group(id, parts) {
  const root = new THREE.Group();
  root.name = id;
  let tris = 0;
  for (const [slot, list] of Object.entries(parts)) {
    const g = merge(list);
    if (!g) continue;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    mat.name = `mg_${slot}`;
    const m = new THREE.Mesh(g, mat);
    m.name = `${id}_${slot}`;
    root.add(m);
    tris += triCount(g);
  }
  return { id, root, tris: Math.round(tris) };
}
const P = (g, pos, rot = [0, 0, 0], scale = 1) => place(g, { pos, rot, scale });

/** Market stall: counter, posts, striped awning, crates with produce. */
function stall(id, stripe, goods) {
  const r = rand(id.length * 31);
  const parts = { wood: [], fabric: [], fruit: [], fruitMatte: [], plain: [] };
  parts.wood.push(P(roundedBox(3.2, 0.95, 1.1, 0.04, { color: '#a07a52' }), [0, 0.475, 0]));
  parts.wood.push(P(roundedBox(3.4, 0.07, 1.3, 0.02, { color: '#8a6440' }), [0, 0.98, 0]));
  for (const x of [-1.55, 1.55]) for (const z of [-0.5, 0.55]) parts.wood.push(P(cyl(0.06, 0.07, 2.6, { segs: 8, color: RED_D }), [x, 1.3, z]));
  for (const s of [1, -1]) parts.wood.push(P(roundedBox(0.5, 0.07, 0.12, 0.02, { color: GOLD }), [s * 1.8, 2.42, 0.9], [0, 0, s * 0.45]));
  parts.wood.push(P(roundedBox(3.6, 0.06, 0.1, 0.02, { color: GOLD }), [0, 2.3, 0.88]));
  // striped awning: scalloped edge
  const stripes = 10;
  for (let i = 0; i < stripes; i++) {
    const x0 = -1.7 + (i / stripes) * 3.4, w = 3.4 / stripes;
    const c = i % 2 ? '#FFE9A8' : stripe;
    // sloped canvas strip from the back (high) to the front edge (low), slightly billowing
    const panel = new THREE.PlaneGeometry(w, 1.55, 1, 6);
    panel.rotateX(-Math.PI / 2);
    const p = panel.attributes.position;
    for (let k = 0; k < p.count; k++) { const z = p.getZ(k); p.setY(k, -(z + 0.775) * 0.28 + Math.sin(((z + 0.775) / 1.55) * Math.PI) * 0.06); }
    panel.computeVertexNormals();
    parts.fabric.push(P(finish(panel, col(c)), [x0 + w / 2, 2.72, 0.05]));
    parts.fabric.push(P(finish(new THREE.CircleGeometry(w / 2, 10, Math.PI, Math.PI), col(c)), [x0 + w / 2, 2.29, 0.83], [0, 0, 0]));
  }
  // crates with produce
  for (let i = 0; i < 4; i++) {
    const x = -1.15 + i * 0.77;
    parts.wood.push(P(roundedBox(0.62, 0.22, 0.45, 0.02, { color: '#b88a5a' }), [x, 1.12, 0.12]));
    const g = goods[i % goods.length];
    for (let k = 0; k < 7; k++) {
      const fx = x + (r() - 0.5) * 0.45, fz = 0.12 + (r() - 0.5) * 0.3;
      const fr = blob(g.r, g.r * (g.tall ?? 1), g.r, { detail: 2, color: jitter(col(g.c), r).getStyle(), seed: k });
      parts[g.matte ? 'fruitMatte' : 'fruit'].push(P(fr, [fx, 1.25 + g.r * 0.6, fz]));
    }
  }
  // hanging sign board
  parts.wood.push(P(roundedBox(1.1, 0.35, 0.05, 0.02, { color: '#7a5434' }), [0, 2.05, 0.82], [-0.25, 0, 0]));
  return group(`stall_${id}`, parts);
}

function tree(id, { h = 5, leaf = '#4fae3a', tip = '#86d04f', bark = '#5e4636', crown = 1.8, seed = 1 }) {
  const r = rand(seed);
  const parts = { bark: [], foliage: [] };
  const trunk = [new V3(0, 0, 0), new V3(0.08, h * 0.25, 0.04), new V3(-0.05, h * 0.5, 0)];
  parts.bark.push(stem(trunk, 0.26, 0.17, { color: bark, bark: true, radial: 10, segs: 10 }));
  // roots
  for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; parts.bark.push(stem([new V3(0, 0.25, 0), new V3(Math.cos(a) * 0.35, 0.05, Math.sin(a) * 0.35), new V3(Math.cos(a) * 0.55, -0.05, Math.sin(a) * 0.55)], 0.12, 0.03, { color: bark, radial: 6 })); }
  const top = trunk.at(-1);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + r();
    const pts = path(top, new V3(Math.cos(a), 0.9, Math.sin(a)), h * 0.42, { steps: 3, bend: 0.15, side: new V3(-Math.sin(a), 0, Math.cos(a)) });
    parts.bark.push(stem(pts, 0.11, 0.03, { color: bark, bark: true, radial: 6 }));
    for (let k = 0; k < 3; k++) {
      const p = new THREE.CatmullRomCurve3(pts).getPointAt(0.5 + k * 0.25);
      const c = cards(crown * (0.8 + r() * 0.4), { color: leaf, color2: tip, seed: Math.floor(r() * 1e6), n: 3 });
      c.rotateY(r() * TAU);
      c.translate(p.x, p.y + 0.2, p.z);
      parts.foliage.push(c);
    }
  }
  for (let i = 0; i < 6; i++) {
    const a = i * GOLDEN;
    const c = cards(crown * 1.2, { color: leaf, color2: tip, seed: i + seed * 9, n: 3 });
    c.translate(Math.cos(a) * crown * 0.45, h * (0.72 + (i % 3) * 0.08), Math.sin(a) * crown * 0.45);
    parts.foliage.push(c);
  }
  return group(id, parts);
}

function pine(id, { h = 6, seed = 3 }) {
  const parts = { bark: [], leaf: [] };
  parts.bark.push(stem([new V3(0, 0, 0), new V3(0, h * 0.5, 0), new V3(0, h, 0)], 0.2, 0.05, { color: '#5a4030', bark: true, radial: 8 }));
  const tiers = 7;
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const y = h * (0.22 + t * 0.72), rad = (1 - t) * 1.5 + 0.3;
    const g = lathe([[rad, -0.15], [rad * 0.8, 0.12], [rad * 0.35, 0.55], [0, 0.75]], { segs: 14, bumps: 0.14, color: '#2f8a3f', color2: '#52b455', seed: seed + i, smooth: 6 });
    parts.leaf.push(P(g, [0, y, 0], [0, i, 0]));
  }
  return group(id, parts);
}

function bush(id, seed) {
  const r = rand(seed);
  const parts = { foliage: [], leaf: [] };
  for (let i = 0; i < 5; i++) {
    const c = cards(0.9 + r() * 0.3, { color: '#3fa03a', color2: '#74c455', seed: seed * 7 + i, n: 3 });
    c.translate((r() - 0.5) * 0.6, 0.45 + r() * 0.2, (r() - 0.5) * 0.6);
    parts.foliage.push(c);
  }
  parts.leaf.push(blob(0.55, 0.42, 0.55, { detail: 2, noise: 0.2, color: '#3a9a34', seed }).translate(0, 0.38, 0));
  return group(id, parts);
}

function fence() {
  const parts = { wood: [] };
  // one 2 m panel: two rails + pickets
  for (const y of [0.32, 0.72]) parts.wood.push(P(roundedBox(2.0, 0.07, 0.04, 0.012, { color: GOLD }), [0, y, 0]));
  for (let i = 0; i < 9; i++) {
    const x = -0.9 + i * 0.225;
    const shape = new THREE.Shape();
    shape.moveTo(-0.045, 0); shape.lineTo(0.045, 0); shape.lineTo(0.045, 0.85); shape.lineTo(0, 0.95); shape.lineTo(-0.045, 0.85); shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 1 });
    g.computeVertexNormals();
    parts.wood.push(P(finish(g, col(i % 2 ? '#C8202A' : '#A81820')), [x, 0, 0.03]));
  }
  for (const x of [-1, 1]) { parts.wood.push(P(roundedBox(0.1, 1.05, 0.1, 0.02, { color: RED_D }), [x, 0.52, 0])); parts.wood.push(P(roundedBox(0.14, 0.06, 0.14, 0.02, { color: GOLD }), [x, 1.08, 0])); }
  return group('fence', parts);
}

function rocks() {
  return [0, 1, 2].map((i) => group(`rock${i}`, { stone: [blob(0.5 + i * 0.25, 0.32 + i * 0.12, 0.42 + i * 0.2, { detail: 3, noise: 0.35, color: ['#9a958a', '#a8a294', '#8f8a80'][i], seed: 40 + i, flatBottom: true })] }));
}

function flowers() {
  const r = rand(77);
  const parts = { leaf: [], petal: [], stem: [] };
  const palette = ['#f2c84a', '#f07aa8', '#ffffff', '#9a7af0', '#ff8a4a'];
  for (let i = 0; i < 14; i++) {
    const x = (r() - 0.5) * 1.4, z = (r() - 0.5) * 1.4, h = 0.18 + r() * 0.22;
    parts.stem.push(stem([new V3(x, 0, z), new V3(x + 0.02, h * 0.6, z), new V3(x, h, z)], 0.006, 0.004, { radial: 4, color: '#5a8f3a' }));
    const c = palette[i % palette.length];
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU;
      const pg = leafBlade({ len: 0.045, wid: 0.035, shape: 'round', fold: 0.1, droop: -0.2, color: c, tip: c, seg: 3, wseg: 1 });
      parts.petal.push(place(pg, { pos: [x, h, z], quat: new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), new V3(Math.cos(a), 0.35, Math.sin(a)).normalize()) }));
    }
    parts.stem.push(sphere(0.012, { w: 6, h: 4, color: '#f5d35a' }).translate(x, h + 0.005, z));
    for (let k = 0; k < 2; k++) parts.leaf.push(place(leafBlade({ len: 0.09, wid: 0.03, shape: 'lanceolate', color: '#4f8a3a', tip: '#7aaa50', seg: 4, wseg: 1 }), { pos: [x, 0.02, z], quat: new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), new V3(Math.cos(i + k * 3), 0.6, Math.sin(i + k * 3)).normalize()) }));
  }
  return group('flowers', parts);
}

function fountain() {
  const parts = { stone: [], water: [], metal: [], plain: [] };
  parts.stone.push(lathe([[3.2, 0], [3.2, 0.5], [2.95, 0.55], [2.9, 0.25], [0, 0.22]], { segs: 8, color: '#C93A30', color2: '#A82A22', smooth: 8 }));
  parts.metal.push(lathe([[3.28, 0.46], [3.28, 0.58], [2.88, 0.6], [2.88, 0.5]], { segs: 8, color: GOLD, smooth: 4 }));
  parts.water.push(finish(new THREE.CylinderGeometry(2.92, 2.92, 0.05, 8), col('#3FA9E0')).translate(0, 0.42, 0));
  parts.stone.push(lathe([[0.45, 0.2], [0.35, 0.6], [0.28, 1.4], [0.9, 1.55], [1.1, 1.75], [1.0, 1.8], [0, 1.68]], { segs: 8, color: '#C93A30', color2: '#E8B53A', smooth: 12 }));
  parts.water.push(finish(new THREE.CylinderGeometry(0.98, 0.98, 0.04, 8), col('#5ab8e8')).translate(0, 1.74, 0));
  parts.stone.push(lathe([[0.12, 1.7], [0.1, 2.2], [0.35, 2.35], [0.3, 2.45], [0, 2.42]], { segs: 8, color: '#8E1118', smooth: 8 }));
  // a golden Mihao on top, in the official hat, of course
  const K = 1.8, Y0 = 2.45; // the statue is scaled up about the top of the pedestal
  const at = (pos) => [pos[0] * K, Y0 + (pos[1] - Y0) * K, pos[2] * K];
  const M = (g, pos, rot) => parts.metal.push(P(g, at(pos), rot, K));
  const Pl = (g, pos, rot) => parts.plain.push(P(g, at(pos), rot, K));
  M(roundedBox(0.56, 0.5, 0.42, 0.03, { color: GOLD }), [0, 2.72, 0]);
  M(roundedBox(0.56, 0.44, 0.46, 0.03, { color: GOLD }), [0, 3.2, 0.02]);
  for (const s of [1, -1]) {
    M(roundedBox(0.14, 0.18, 0.08, 0.02, { color: GOLD }), [0.2 * s, 3.5, 0], [0, 0, -0.3 * s]);
    M(roundedBox(0.15, 0.4, 0.15, 0.02, { color: GOLD }), [0.16 * s, 2.7, 0.27]);
    Pl(roundedBox(0.09, 0.1, 0.02, 0.01, { color: DARK }), [0.12 * s, 3.26, 0.255]);
    Pl(roundedBox(0.07, 0.24, 0.05, 0.01, { color: '#FFF3DE' }), [0.19 * s, 3.0, 0.26]);
  }
  Pl(roundedBox(0.34, 0.07, 0.05, 0.01, { color: '#FFF3DE' }), [0, 3.1, 0.26]);
  Pl(roundedBox(0.07, 0.05, 0.03, 0.01, { color: '#E9788A' }), [0, 3.17, 0.27]);
  Pl(roundedBox(0.46, 0.08, 0.4, 0.02, { color: DARK }), [0, 3.47, 0.02]);
  Pl(roundedBox(0.36, 0.08, 0.3, 0.02, { color: RED }), [0, 3.55, 0.02]);
  Pl(roundedBox(0.22, 0.07, 0.2, 0.02, { color: RED }), [0, 3.62, 0.02]);
  M(roundedBox(0.08, 0.08, 0.08, 0.01, { color: GOLD }), [0, 3.7, 0.02]);
  return group('fountain', parts);
}

/**
 * Garden gate: two stout posts with lanterns, a curved arch with climbing leaves and flowers, and two picket
 * doors swung open inward (the opening is 4.6 m wide, from x = -2.3 to 2.3).
 */
function gate() {
  const parts = { wood: [], metal: [], glass: [], glow: [], plain: [] };
  const X = 2.55;
  for (const s of [1, -1]) {
    const x = X * s;
    parts.wood.push(P(roundedBox(0.4, 2.7, 0.4, 0.04, { color: RED }), [x, 1.35, 0]));
    parts.metal.push(P(roundedBox(0.54, 0.16, 0.54, 0.03, { color: GOLD }), [x, 2.74, 0]));
    parts.metal.push(P(roundedBox(0.52, 0.2, 0.52, 0.03, { color: GOLD }), [x, 0.1, 0]));
    // a red lantern hanging inside each post
    parts.plain.push(P(roundedBox(0.3, 0.34, 0.3, 0.02, { color: '#E0312B' }), [x - s * 0.5, 2.25, 0]));
    parts.metal.push(P(roundedBox(0.34, 0.05, 0.34, 0.01, { color: GOLD }), [x - s * 0.5, 2.45, 0]));
    parts.metal.push(P(roundedBox(0.34, 0.05, 0.34, 0.01, { color: GOLD }), [x - s * 0.5, 2.06, 0]));
    parts.glow.push(P(box(0.14, 0.2, 0.14, { color: '#ffe28a' }), [x - s * 0.5, 2.25, 0]));
    parts.plain.push(P(box(0.03, 0.2, 0.03, { color: RED }), [x - s * 0.5, 1.9, 0]));
    // open picket door (red lacquer), hinged on the post, swung 70 degrees into the garden
    const door = [];
    for (const y of [0.35, 0.95]) door.push(P(roundedBox(1.95, 0.08, 0.05, 0.015, { color: GOLD }), [0.975, y, 0]));
    for (let i = 0; i < 8; i++) door.push(P(roundedBox(0.13, 1.12 + (i % 2 ? 0 : 0.08), 0.045, 0.02, { color: i % 2 ? '#C8202A' : '#A81820' }), [0.13 + i * 0.245, 0.62, 0.03]));
    door.push(P(roundedBox(1.9, 0.07, 0.04, 0.015, { color: RED_D }), [0.98, 0.65, 0.01], [0, 0, Math.atan2(0.6, 1.9)]));
    for (const g of door) { place(g, { rot: [0, s > 0 ? Math.PI - 1.22 : 1.22, 0] }); g.translate(x - s * 0.18, 0, -0.05); parts.wood.push(g); }
  }
  // lintel, gold trim, plaque and three tiers of green tile roof with upturned corners
  parts.wood.push(P(roundedBox(6.0, 0.3, 0.5, 0.03, { color: RED_D }), [0, 2.98, 0]));
  parts.metal.push(P(roundedBox(6.1, 0.06, 0.56, 0.02, { color: GOLD }), [0, 2.8, 0]));
  parts.metal.push(P(roundedBox(1.3, 0.46, 0.08, 0.02, { color: GOLD }), [0, 3.45, 0.05]));
  parts.plain.push(P(roundedBox(1.12, 0.32, 0.1, 0.02, { color: RED_D }), [0, 3.45, 0.05]));
  parts.metal.push(P(cyl(0.11, 0.11, 0.12, { segs: 8, color: GOLD }), [0, 3.45, 0.13], [Math.PI / 2, 0, 0]));
  for (let i = 0; i < 3; i++) {
    const w = 6.9 - i * 1.7, y = 3.2 + i * 0.26, d = 1.0 - i * 0.18;
    parts.plain.push(P(roundedBox(w, 0.2, d, 0.03, { color: i % 2 ? '#3FA56B' : JADE }), [0, y, 0]));
    parts.metal.push(P(roundedBox(w + 0.04, 0.04, d + 0.04, 0.01, { color: GOLD }), [0, y - 0.11, 0]));
    for (const s of [1, -1]) parts.plain.push(P(roundedBox(0.5, 0.16, d, 0.03, { color: i % 2 ? '#3FA56B' : JADE }), [s * (w / 2 + 0.2), y + 0.1, 0], [0, 0, s * 0.45]));
  }
  parts.metal.push(P(roundedBox(0.2, 0.34, 0.2, 0.02, { color: GOLD }), [0, 4.0, 0]));
  return group('gate', parts);
}

function sign() {
  const parts = { wood: [] };
  parts.wood.push(P(cyl(0.07, 0.08, 1.6, { segs: 8, color: RED_D }), [0, 0.8, 0]));
  parts.wood.push(P(roundedBox(1.3, 0.62, 0.07, 0.03, { color: '#C9A35A' }), [0, 1.35, 0.06]));
  parts.wood.push(P(roundedBox(1.38, 0.07, 0.1, 0.02, { color: GOLD }), [0, 1.69, 0.06]));
  return group('sign', parts);
}

function lamp() {
  const parts = { metal: [], glass: [], glow: [], plain: [] };
  parts.plain.push(lathe([[0.16, 0], [0.12, 0.12], [0.05, 0.2], [0.05, 2.35], [0, 2.37]], { segs: 8, color: RED_D, smooth: 6 }));
  parts.metal.push(P(roundedBox(0.2, 0.08, 0.2, 0.02, { color: GOLD }), [0, 0.1, 0]));
  // a red paper lantern: four red posts around a pale glass core, gold roof and base, a tassel
  for (const [x, z] of [[-0.15, -0.15], [0.15, -0.15], [-0.15, 0.15], [0.15, 0.15]]) parts.plain.push(P(box(0.05, 0.4, 0.05, { color: '#E0312B' }), [x, 2.6, z]));
  parts.glass.push(P(box(0.26, 0.36, 0.26, { color: '#fff1c0' }), [0, 2.6, 0]));
  parts.metal.push(P(roundedBox(0.4, 0.06, 0.4, 0.015, { color: GOLD }), [0, 2.8, 0]));
  parts.metal.push(P(roundedBox(0.4, 0.06, 0.4, 0.015, { color: GOLD }), [0, 2.4, 0]));
  parts.plain.push(P(cone(0.32, 0.22, { segs: 4, color: '#E0312B' }), [0, 2.94, 0], [0, Math.PI / 4, 0]));
  parts.metal.push(P(box(0.07, 0.07, 0.07, { color: GOLD }), [0, 3.1, 0]));
  parts.plain.push(P(box(0.04, 0.2, 0.04, { color: '#E0312B' }), [0, 2.25, 0]));
  return group('lamp', parts);
}

function bench() {
  const parts = { wood: [], metal: [] };
  for (let i = 0; i < 3; i++) parts.wood.push(P(roundedBox(1.6, 0.05, 0.13, 0.015, { color: '#C8202A' }), [0, 0.45, -0.15 + i * 0.15]));
  for (let i = 0; i < 2; i++) parts.wood.push(P(roundedBox(1.6, 0.12, 0.04, 0.015, { color: '#C8202A' }), [0, 0.72 + i * 0.17, -0.27], [-0.2, 0, 0]));
  for (const x of [-0.7, 0.7]) { parts.metal.push(P(roundedBox(0.06, 0.45, 0.45, 0.02, { color: GOLD }), [x, 0.22, -0.05])); parts.metal.push(P(roundedBox(0.05, 0.5, 0.05, 0.015, { color: GOLD }), [x, 0.7, -0.26], [-0.2, 0, 0])); }
  return group('bench', parts);
}

function crate() {
  const parts = { wood: [] };
  parts.wood.push(roundedBox(0.6, 0.45, 0.6, 0.03, { color: '#b88a5a' }).translate(0, 0.225, 0));
  for (const y of [0.08, 0.37]) parts.wood.push(roundedBox(0.63, 0.06, 0.63, 0.015, { color: '#8a6440' }).translate(0, y, 0));
  return group('crate', parts);
}


// ---- Homes, decorations and village features (Phase 2) ----------------------------------------

function gableRoof(w, d, h, color, overhang = 0.25) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 - overhang, 0); s.lineTo(0, h); s.lineTo(w / 2 + overhang, 0); s.lineTo(w / 2 + overhang, -0.12); s.lineTo(0, h - 0.16); s.lineTo(-w / 2 - overhang, -0.12); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: d + overhang * 2, bevelEnabled: false });
  g.translate(0, 0, -(d + overhang * 2) / 2);
  g.computeVertexNormals();
  return finish(g, col(color));
}
function windowsOn(parts, w, y, z, n, color = '#bfe8ff') {
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + ((i + 0.5) / n) * w;
    parts.wood.push(P(roundedBox(0.62, 0.62, 0.08, 0.02, { color: '#5a3a22' }), [x, y, z]));
    parts.glass.push(P(box(0.5, 0.5, 0.02, { color }), [x, y, z + 0.045]));
    parts.wood.push(P(box(0.04, 0.5, 0.03, { color: '#f2ead8' }), [x, y, z + 0.06]));
    parts.wood.push(P(box(0.5, 0.04, 0.03, { color: '#f2ead8' }), [x, y, z + 0.06]));
  }
}

function home(id) {
  const parts = { wood: [], stone: [], glass: [], fabric: [], plain: [], leaf: [], foliage: [], bark: [], metal: [], glow: [] };
  if (id === 'shed') {
    parts.wood.push(P(roundedBox(3.2, 2.2, 2.4, 0.04, { color: '#b08458' }), [0, 1.1, 0]));
    parts.plain.push(P(gableRoof(3.2, 2.4, 0.9, '#2E8B57', 0.45), [0, 2.2, 0]));
    parts.wood.push(P(roundedBox(0.9, 1.6, 0.08, 0.02, { color: RED }), [0, 0.8, 1.22]));
    windowsOn(parts, 2.2, 1.4, 1.22, 2);
    parts.wood.push(P(box(3.4, 0.1, 2.6, { color: '#8a6440' }), [0, 0.05, 0]));
  } else if (id === 'cottage') {
    parts.stone.push(P(roundedBox(4.6, 2.8, 3.6, 0.05, { color: '#f2ead8' }), [0, 1.4, 0]));
    parts.plain.push(P(gableRoof(4.6, 3.6, 1.8, '#2E8B57', 0.5), [0, 2.8, 0]));
    parts.stone.push(P(box(0.6, 1.6, 0.6, { color: '#9a958a' }), [1.3, 3.6, -0.6]));
    parts.wood.push(P(roundedBox(1.0, 1.9, 0.1, 0.03, { color: RED }), [0, 0.95, 1.82]));
    windowsOn(parts, 3.6, 1.6, 1.82, 2);
    parts.foliage.push(P(cards(1.1, { color: '#4f8a3a', color2: '#7fb04f', seed: 4 }), [-1.9, 0.5, 2.0]));
    parts.foliage.push(P(cards(1.1, { color: '#4f8a3a', color2: '#7fb04f', seed: 5 }), [1.9, 0.5, 2.0]));
  } else if (id === 'treehouse') {
    parts.bark.push(stem([new V3(0, 0, 0), new V3(0.2, 2.2, 0.1), new V3(0, 4.2, 0)], 0.55, 0.38, { color: '#6a4a32', bark: true, radial: 10, segs: 10 }));
    parts.wood.push(P(cyl(2.4, 2.4, 0.2, { segs: 16, color: '#a07a52' }), [0, 3.2, 0]));
    parts.wood.push(P(roundedBox(2.8, 1.9, 2.6, 0.04, { color: '#b08458' }), [0, 4.2, 0]));
    parts.plain.push(P(gableRoof(2.8, 2.6, 1.2, RED, 0.45), [0, 5.15, 0]));
    windowsOn(parts, 2.0, 4.3, 1.32, 2);
    for (let i = 0; i < 8; i++) parts.wood.push(P(box(0.6, 0.06, 0.18, { color: '#8a6440' }), [1.4, 0.3 + i * 0.38, 1.4], [0, 0.6, 0]));
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; parts.foliage.push(P(cards(2.4, { color: '#4f8a3a', color2: '#8ab05a', seed: 10 + i }), [Math.cos(a) * 1.4, 6.3 + (i % 2) * 0.4, Math.sin(a) * 1.4])); }
  } else if (id === 'windmill') {
    parts.stone.push(P(lathe([[2.2, 0], [1.9, 2], [1.5, 5], [1.4, 5.4], [0, 5.4]], { segs: 20, color: '#efe2c4', smooth: 6 }), [0, 0, 0]));
    parts.plain.push(P(cone(1.9, 2.0, { segs: 20, color: RED }), [0, 6.4, 0]));
    parts.wood.push(P(roundedBox(1.1, 2.0, 0.1, 0.03, { color: '#7a5434' }), [0, 1.0, 2.15]));
    windowsOn(parts, 1.2, 3.4, 1.75, 1);
    parts.wood.push(P(cyl(0.18, 0.18, 0.6, { segs: 10, color: '#5a3a22' }), [0, 5.2, 1.6], [Math.PI / 2, 0, 0]));
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.4; parts.fabric.push(P(box(0.9, 3.4, 0.05, { color: '#f2ead8' }), [Math.sin(a) * 1.8, 5.2 + Math.cos(a) * 1.8, 1.92], [0, 0, -a])); }
  } else if (id === 'castle') {
    parts.stone.push(P(roundedBox(5.6, 4.2, 4.4, 0.06, { color: '#E9D9B5' }), [0, 2.1, 0]));
    for (const [x, z] of [[-2.8, -2.2], [2.8, -2.2], [-2.8, 2.2], [2.8, 2.2]]) {
      parts.stone.push(P(cyl(0.9, 1.0, 6.2, { segs: 16, color: '#E9D9B5' }), [x, 3.1, z]));
      parts.plain.push(P(cone(1.15, 2.0, { segs: 16, color: RED }), [x, 7.2, z]));
      parts.fabric.push(P(box(0.6, 0.35, 0.02, { color: '#FFC233' }), [x + 0.3, 8.7, z]));
      parts.metal.push(P(cyl(0.025, 0.025, 1.0, { segs: 5, color: '#8a8a90' }), [x, 8.5, z]));
    }
    for (let i = -2; i <= 2; i++) parts.stone.push(P(box(0.6, 0.6, 0.6, { color: '#d8d1c3' }), [i * 1.1, 4.5, 2.2]));
    parts.wood.push(P(roundedBox(1.4, 2.4, 0.12, 0.05, { color: '#6a4a32' }), [0, 1.2, 2.24]));
    windowsOn(parts, 4.0, 3.0, 2.24, 3, '#ffe9a0');
    parts.glow.push(P(sphere(0.3, { color: '#fff3b0' }), [0, 9.2, 0]));
  }
  return group(`home_${id}`, parts);
}

function gnome(gold = false) {
  const parts = { plain: [], skin: [], fabric: [], metal: [] };
  const c = (x) => (gold ? '#e0b84a' : x);
  const slot = gold ? 'metal' : 'plain';
  parts[slot].push(P(lathe([[0.2, 0], [0.22, 0.12], [0.18, 0.35], [0.12, 0.45], [0, 0.46]], { segs: 16, color: c('#3d6ea8'), smooth: 8 }), [0, 0, 0]));
  parts[slot].push(P(blob(0.12, 0.11, 0.12, { detail: 3, color: c('#f3c9a8') }), [0, 0.55, 0]));
  parts[slot].push(P(blob(0.13, 0.12, 0.09, { detail: 3, color: c('#f2ead8'), noise: 0.15 }), [0, 0.47, 0.05]));
  parts[slot].push(P(cone(0.14, 0.42, { segs: 16, color: c('#d93a3a') }), [0, 0.82, -0.02], [-0.15, 0, 0]));
  parts[slot].push(P(sphere(0.035, { color: c('#e89a8a') }), [0, 0.56, 0.12]));
  return group(gold ? 'goldgnome' : 'gnome', parts);
}

function birdbath() {
  const parts = { stone: [], water: [] };
  parts.stone.push(lathe([[0.3, 0], [0.12, 0.1], [0.08, 0.6], [0.45, 0.75], [0.5, 0.85], [0.42, 0.86], [0, 0.78]], { segs: 24, color: '#d2cbbd', smooth: 10 }));
  parts.water.push(finish(new THREE.CylinderGeometry(0.42, 0.42, 0.02, 24), col('#3FA9E0')).translate(0, 0.83, 0));
  return group('birdbath', parts);
}

function scarecrow() {
  const parts = { wood: [], fabric: [], plain: [] };
  parts.wood.push(P(cyl(0.05, 0.05, 2.2, { segs: 8, color: '#8a6440' }), [0, 1.1, 0]));
  parts.wood.push(P(cyl(0.04, 0.04, 1.6, { segs: 8, color: '#8a6440' }), [0, 1.55, 0], [0, 0, Math.PI / 2]));
  parts.fabric.push(P(roundedBox(0.6, 0.7, 0.3, 0.08, { color: '#c0392b' }), [0, 1.4, 0]));
  parts.fabric.push(P(blob(0.2, 0.22, 0.2, { detail: 3, color: '#e8d08a' }), [0, 2.0, 0]));
  parts.plain.push(P(cyl(0.34, 0.36, 0.04, { segs: 20, color: '#c9a35a' }), [0, 2.17, 0]));
  parts.plain.push(P(cone(0.18, 0.3, { segs: 16, color: '#c9a35a' }), [0, 2.32, 0]));
  for (const s of [1, -1]) parts.plain.push(P(sphere(0.03, { color: '#2b1a0e' }), [0.07 * s, 2.04, 0.18]));
  return group('scarecrow', parts);
}

function arch() {
  const parts = { wood: [], petal: [], leaf: [] };
  const pts = Array.from({ length: 13 }, (_, i) => { const a = (i / 12) * Math.PI; return new V3(Math.cos(a) * 1.1, Math.sin(a) * 1.1 + 1.2, 0); });
  for (const z of [-0.3, 0.3]) {
    parts.wood.push(stem([new V3(-1.1, 0, z), new V3(-1.1, 1.2, z)], 0.05, 0.05, { color: '#f2ead8', radial: 6 }));
    parts.wood.push(stem([new V3(1.1, 0, z), new V3(1.1, 1.2, z)], 0.05, 0.05, { color: '#f2ead8', radial: 6 }));
    parts.wood.push(stem(pts.map((p) => new V3(p.x, p.y, z)), 0.04, 0.04, { color: '#f2ead8', radial: 6, segs: 24 }));
  }
  const r = rand(12);
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI, rr = 1.1;
    const p = new V3(Math.cos(a) * rr, Math.sin(a) * rr + 1.2, (r() - 0.5) * 0.6);
    parts.petal.push(P(blob(0.09, 0.07, 0.09, { detail: 2, color: ['#f07aa8', '#fff4dc', '#f2c84a'][i % 3] }), [p.x, p.y, p.z]));
    parts.leaf.push(P(leafBlade({ len: 0.16, wid: 0.08, color: '#4f8a3a', tip: '#7aaa50', seg: 3, wseg: 1 }), [p.x, p.y - 0.05, p.z], [r(), r() * 6, r()]));
  }
  return group('arch', parts);
}

function minimill() {
  const parts = { wood: [], fabric: [], plain: [] };
  parts.wood.push(P(lathe([[0.7, 0], [0.55, 1.6], [0.45, 2.0], [0, 2.0]], { segs: 8, color: '#b08458', smooth: 4 }), [0, 0, 0]));
  parts.plain.push(P(cone(0.6, 0.6, { segs: 8, color: RED }), [0, 2.3, 0]));
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; parts.fabric.push(P(box(0.25, 1.2, 0.03, { color: '#fff4dc' }), [Math.sin(a) * 0.62, 1.9 + Math.cos(a) * 0.62, 0.55], [0, 0, -a])); }
  return group('minimill', parts);
}

function feathertotem() {
  const parts = { wood: [], plain: [] };
  parts.wood.push(P(cyl(0.06, 0.08, 1.2, { segs: 8, color: '#7a5434' }), [0, 0.6, 0]));
  for (let i = 0; i < 3; i++) parts.plain.push(P(leafBlade({ len: 0.5, wid: 0.12, shape: 'lanceolate', fold: 0.1, droop: 0.2, color: '#2b2b3a', tip: '#4a4a6a', seg: 5, wseg: 1 }), [0, 1.15, 0], [0.3, (i / 3) * Math.PI * 2, 0.4]));
  return group('feathertotem', parts);
}

function bunting() {
  const parts = { wood: [], fabric: [] };
  for (const x of [-1, 1]) parts.wood.push(P(cyl(0.04, 0.05, 2.2, { segs: 8, color: '#8a6440' }), [x, 1.1, 0]));
  const cols = ['#C8202A', GOLD, JADE, '#C8202A', GOLD, JADE];
  for (let i = 0; i < 9; i++) { const x = -0.9 + i * 0.225; const y = 2.0 - Math.sin(((i + 0.5) / 9) * Math.PI) * 0.25; parts.fabric.push(P(cone(0.09, 0.2, { segs: 3, color: cols[i % cols.length] }), [x, y - 0.1, 0], [Math.PI, 0, 0])); }
  return group('bunting', parts);
}

function trophy() {
  const parts = { metal: [], stone: [] };
  parts.stone.push(P(roundedBox(0.4, 0.2, 0.4, 0.03, { color: '#5a3a22' }), [0, 0.1, 0]));
  parts.metal.push(lathe([[0.12, 0.2], [0.05, 0.3], [0.05, 0.5], [0.22, 0.62], [0.26, 0.85], [0.22, 0.86], [0, 0.6]], { segs: 20, color: '#e0b84a', smooth: 10 }));
  for (const s of [1, -1]) parts.metal.push(P(torus(0.08, 0.018, { rs: 5, ts: 12, arc: Math.PI, color: '#e0b84a' }), [0.25 * s, 0.72, 0], [0, 0, (s > 0 ? -1 : 1) * Math.PI / 2]));
  return group('trophy', parts);
}

function balloon() {
  const parts = { fabric: [], wood: [], plain: [], glow: [] };
  const stripes = ['#d93a3a', '#FFC233'];
  for (let i = 0; i < 12; i++) {
    const g = lathe([[0.01, 0], [1.0, 0.6], [1.6, 1.8], [1.5, 2.8], [0.9, 3.5], [0.01, 3.7]], { segs: 3, color: stripes[i % 2], smooth: 12 });
    g.rotateY((i / 12) * Math.PI * 2 * 1.0);
    // a 3-segment lathe is a wedge; scale it to a 1/12 slice by squeezing around Y
    parts.fabric.push(P(g, [0, 3.4, 0]));
  }
  parts.wood.push(P(roundedBox(1.2, 0.8, 1.2, 0.08, { color: '#a07a52' }), [0, 0.4, 0]));
  for (const [x, z] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) parts.plain.push(stem([new V3(x, 0.8, z), new V3(x * 1.6, 3.5, z * 1.6)], 0.012, 0.012, { radial: 3, color: '#5a3a22' }));
  parts.glow.push(P(cone(0.25, 0.4, { segs: 8, color: '#ffb84a' }), [0, 3.1, 0], [Math.PI, 0, 0]));
  return group('balloon', parts);
}

function board() {
  const parts = { wood: [], plain: [] };
  for (const x of [-0.9, 0.9]) parts.wood.push(P(cyl(0.07, 0.08, 2.4, { segs: 8, color: '#7a5434' }), [x, 1.2, 0]));
  parts.wood.push(P(roundedBox(2.2, 1.4, 0.1, 0.04, { color: '#b08458' }), [0, 1.6, 0.03]));
  parts.plain.push(P(gableRoof(2.4, 0.5, 0.4, '#7a4a32', 0.1), [0, 2.35, 0]));
  const notes = ['#fff4dc', '#ffe9a0', '#d7f0ff', '#f2d0e0'];
  for (let i = 0; i < 6; i++) parts.plain.push(P(box(0.42, 0.34, 0.01, { color: notes[i % 4] }), [-0.65 + (i % 3) * 0.65, 1.85 - Math.floor(i / 3) * 0.5, 0.09], [0, 0, (i % 2 ? 0.08 : -0.06)]));
  return group('board', parts);
}

function island() {
  const parts = { stone: [], grass: [], foliage: [], bark: [] };
  parts.stone.push(lathe([[0.5, -16], [6, -12], [16, -6], [27, -2], [30, -0.3], [30.2, 0.02], [0, 0.03]], { segs: 40, bumps: 0.08, color: '#8a7a6a', color2: '#a89a88', smooth: 10 }));
  parts.grass.push(finish(new THREE.CylinderGeometry(29.6, 29.6, 0.08, 48), col('#7dc456')).translate(0, 0.06, 0));
  const r = rand(31);
  for (let i = 0; i < 14; i++) {
    const a = r() * Math.PI * 2, d = 18 + r() * 9;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    parts.bark.push(stem([new V3(x, 0, z), new V3(x, 2.4, z)], 0.18, 0.12, { color: '#6a4a32', bark: true, radial: 6 }));
    parts.foliage.push(P(cards(2.6, { color: '#3f8a3a', color2: '#9ac25a', seed: 40 + i }), [x, 3.0, z]));
  }
  return group('island', parts);
}

function acorn() {
  const parts = { fruit: [], wood: [] };
  parts.fruit.push(P(blob(0.12, 0.15, 0.12, { detail: 3, color: '#c98e3a' }), [0, 0.15, 0]));
  parts.wood.push(P(lathe([[0.13, 0], [0.14, 0.05], [0.08, 0.1], [0, 0.11]], { segs: 14, color: '#7a5434', bumps: 0.12 }), [0, 0.22, 0]));
  parts.wood.push(P(cyl(0.012, 0.012, 0.06, { segs: 5, color: '#5a3a22' }), [0, 0.35, 0]));
  return group('acorn', parts);
}

function crow() {
  const parts = { plain: [], eye: [] };
  parts.plain.push(P(blob(0.14, 0.12, 0.22, { detail: 3, color: '#2b2b3a' }), [0, 0.25, 0]));
  parts.plain.push(P(blob(0.09, 0.09, 0.09, { detail: 3, color: '#2b2b3a' }), [0, 0.38, 0.18]));
  parts.plain.push(P(cone(0.035, 0.12, { segs: 6, color: '#e0a02a' }), [0, 0.37, 0.3], [Math.PI / 2, 0, 0]));
  for (const s of [1, -1]) {
    parts.plain.push(P(leafBlade({ len: 0.32, wid: 0.16, color: '#20202c', tip: '#3a3a4a', seg: 4, wseg: 1 }), [0.12 * s, 0.3, 0], [Math.PI / 2, 0, -1.2 * s]));
    parts.eye.push(P(sphere(0.02, { color: '#ffffff' }), [0.045 * s, 0.41, 0.25]));
  }
  return group('crow', parts);
}

function ufo() {
  const parts = { metal: [], glass: [], glow: [], skin: [] };
  parts.metal.push(lathe([[0.01, -0.12], [0.9, 0], [0.95, 0.04], [0.4, 0.14], [0.01, 0.15]], { segs: 32, color: '#b8c0cc', smooth: 8 }));
  parts.skin.push(P(blob(0.18, 0.2, 0.18, { detail: 3, color: '#7ae07a' }), [0, 0.32, 0]));
  for (const s of [1, -1]) parts.skin.push(P(sphere(0.05, { color: '#111111' }), [0.07 * s, 0.38, 0.14]));
  parts.glass.push(P(sphere(0.38, { w: 20, h: 12, color: '#dff3ff' }), [0, 0.2, 0]));
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; parts.glow.push(P(sphere(0.06, { color: ['#ffd84a', '#ff8fc8', '#9DD3FF'][i % 3] }), [Math.cos(a) * 0.75, 0.0, Math.sin(a) * 0.75])); }
  return group('ufo', parts);
}

function eggNest() {
  const parts = { plain: [], fabric: [] };
  parts.plain.push(P(torus(0.32, 0.12, { rs: 8, ts: 20, color: '#c9a35a' }), [0, 0.1, 0], [Math.PI / 2, 0, 0]));
  parts.fabric.push(P(cyl(0.3, 0.25, 0.08, { segs: 16, color: '#e8d08a' }), [0, 0.05, 0]));
  return group('nest', parts);
}

export function buildExtraProps() {
  return [
    ...['shed', 'cottage', 'treehouse', 'windmill', 'castle'].map(home),
    gnome(false), gnome(true), birdbath(), scarecrow(), arch(), minimill(), feathertotem(), bunting(), trophy(),
    balloon(), board(), island(), acorn(), crow(), ufo(), eggNest(),
  ];
}

export function buildProps(headImage) {
  const list = [
    stall('seeds', '#C8202A', [{ c: '#d9a35a', r: 0.05, matte: true }, { c: '#8a6a3a', r: 0.04, matte: true }, { c: '#e8d0a0', r: 0.045, matte: true }]),
    stall('market', '#2E8B57', [{ c: '#e0301e', r: 0.06 }, { c: '#f2a31e', r: 0.065 }, { c: '#3c4f9e', r: 0.03 }, { c: '#2f7a2c', r: 0.09, tall: 1.2 }]),
    stall('gadgets', '#2A4FA0', [{ c: '#b8b8c0', r: 0.05 }, { c: '#3FA9E0', r: 0.055 }, { c: '#d93a3a', r: 0.05 }]),
    stall('pets', '#F25C9C', [{ c: '#f2ead8', r: 0.05, tall: 1.3, matte: true }, { c: '#9DD3FF', r: 0.05, tall: 1.3 }, { c: '#FFD84A', r: 0.05, tall: 1.3 }, { c: '#c8f0c0', r: 0.05, tall: 1.3, matte: true }]),
    tree('tree_oak', { h: 5.2, crown: 2.0, seed: 3 }),
    tree('tree_round', { h: 4.2, leaf: '#5ab83f', tip: '#9ad85a', bark: '#6a5242', crown: 1.6, seed: 8 }),
    tree('tree_birch', { h: 5.5, leaf: '#6ac048', tip: '#b8e070', bark: '#e8e2d6', crown: 1.4, seed: 12 }),
    pine('tree_pine', { h: 6.2 }),
    bush('bush', 5),
    fence(),
    ...rocks(),
    flowers(),
    fountain(),
    sign(),
    lamp(),
    gate(),
    bench(),
    crate(),
    ...buildExtraProps(),
  ];
  // the Sky Balloon wears the player's face, so it is built from the head picture
  return list.map((p) => (p.id === 'balloon' ? balloonProp(headImage) : p));
}
