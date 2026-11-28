// The Mihao admin looks and Ansem's, built on the game's own player cat (client/public/models/characters/farmer.glb).
// Every new part is hung on a bone while the skeleton is in its rest pose, so all the game's animations still work.
// Coordinates are the player model's: feet at y=0, facing +z, so the viewer's left is -x.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { lock, HEAD } from '../mihao.js';
import { place, roundedBox } from '../lib/geo.js';

const Y = HEAD.y; // centre of the head
const CREAM = '#F1E2C4', FUR = '#E9D6B8', WHITE = '#F4F1EA', BLACK = '#17151A';
const TAU = Math.PI * 2;
const V = (a) => new THREE.Vector3(...a);

/** Depth of the face surface at (x, y from the head centre); the eyes sit at about (±0.15, +0.055). */
const faceZ = (x, y) => HEAD.d * Math.max(0, 1 - Math.abs(x / HEAD.w) ** HEAD.n - Math.abs(y / HEAD.h) ** HEAD.n) ** (1 / HEAD.n);

const mats = new Map();
function M(color, { rough = 0.8, metal = 0, glow = 0, double = false, map = null, name = null } = {}) {
  const k = [color, rough, metal, glow, double, map?.uuid, name].join('|');
  if (!mats.has(k)) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, map, side: double ? THREE.DoubleSide : THREE.FrontSide });
    if (glow) { m.emissive = new THREE.Color(color); m.emissiveIntensity = glow; if (map) m.emissiveMap = map; }
    m.name = name ?? `admin_${mats.size}`;
    mats.set(k, m);
  }
  return mats.get(k);
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
let rs = 7;
const rnd = () => ((rs = (rs * 16807) % 2147483647) - 1) / 2147483646;

// ---------------------------------------------------------------- a small kit for hanging parts on bones
function kit(rig) {
  const bone = (n) => { const b = rig.getObjectByName(n); if (!b) throw new Error(`no bone ${n}`); return b; };
  const hang = (obj, on) => { rig.add(obj); obj.updateMatrixWorld(true); bone(on).attach(obj); return obj; };
  const mesh = (on, geo, mat, pos = [0, 0, 0], rot = [0, 0, 0], scale = null) => {
    const m = new THREE.Mesh(geo, typeof mat === 'string' ? M(mat) : mat);
    m.position.set(...pos); m.rotation.set(...rot);
    if (scale) m.scale.set(...scale);
    m.castShadow = true; m.receiveShadow = true;
    return hang(m, on);
  };
  const box = (on, w, h, d, mat, pos, rot, r = 0.025) => mesh(on, roundedBox(w, h, d, Math.min(r, w / 3, h / 3, d / 3)), mat, pos, rot);
  const ball = (on, r, mat, pos, scale, rot) => mesh(on, new THREE.SphereGeometry(r, 28, 20), mat, pos, rot, scale);
  const cyl = (on, r0, r1, h, mat, pos, rot, seg = 24) => mesh(on, new THREE.CylinderGeometry(r0, r1, h, seg), mat, pos, rot);
  const torus = (on, r, t, mat, pos, rot, scale, arc = TAU) => mesh(on, new THREE.TorusGeometry(r, t, 12, 48, arc), mat, pos, rot, scale);
  const tube = (on, pts, r, mat, seg = 32) => mesh(on, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(V)), seg, r, 10), mat);
  /** A tapering strand (hair, whisker, drip) along a curve. widths: [[t, radius], ...] */
  const strand = (on, pts, widths, mat, flat = 0.55) => {
    const g = lock(pts, widths, { flat, segs: 24, radial: 10 });
    const m = typeof mat === 'string' ? M(mat) : mat;
    return mesh(on, g, m);
  };
  /** A flat shape facing +z, from [x, y] points. */
  const flat = (on, pts, depth, mat, pos, rot = [0, 0, 0]) => {
    const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 2 });
    g.translate(0, 0, -depth / 2);
    return mesh(on, g, mat, pos, rot);
  };
  /** A flat picture (text, print, stain) lying just in front of a surface. */
  const decal = (on, w, h, tex, pos, rot = [0, 0, 0], name = null) => {
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.05, roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
    const m = mesh(on, new THREE.PlaneGeometry(w, h), mat, pos, rot);
    if (name) m.name = name;
    return m;
  };
  /** A group of parts that can be switched off on its own (cigarette, stain, smoke). */
  const named = (name, parts) => { parts.forEach((p, i) => { p.name = `${name}_${i}`; }); return parts; };
  return { bone, hang, mesh, box, ball, cyl, torus, tube, strand, flat, decal, named };
}

const SIDES = [[1, 'L'], [-1, 'R']];

/** The long, smooth cream moustache of the photos (it swings on the game's moustache bones), with whiskers. */
function moustache(k, { color = CREAM, drop = 0.7, thick = 1, goatee = false } = {}) {
  const mat = M(color, { rough: 0.6, glow: 0.16 });
  for (const [s, side] of SIDES) {
    k.strand(`stache${side}`, [[0.01 * s, Y - 0.168, 0.338], [0.09 * s, Y - 0.165, 0.352], [0.158 * s, Y - 0.225, 0.345], [0.188 * s, Y - 0.36, 0.342], [0.188 * s, Y - 0.36 - drop * 0.34, 0.318], [0.166 * s, Y - 0.36 - drop * 0.62, 0.29]],
      [[0, 0.016 * thick], [0.17, 0.042 * thick], [0.45, 0.029 * thick], [0.76, 0.019 * thick], [1, 0.002]], mat, 0.45);
    for (let i = 0; i < 3; i++) k.strand('head', [[0.1 * s, Y - 0.12 - i * 0.025, 0.318], [0.29 * s, Y - 0.105 - i * 0.047, 0.32], [0.47 * s, Y - 0.115 - i * 0.08, 0.25]], [[0, 0.0028], [1, 0.0006]], mat, 1);
  }
  if (goatee) k.strand('beard', [[0, Y - 0.2, 0.29], [0, Y - 0.31, 0.318], [0, Y - 0.47, 0.305], [0.006, Y - 0.66, 0.28]], [[0, 0.045], [0.22, 0.078], [0.62, 0.042], [1, 0.0015]], mat, 0.3);
}

/** A torso and sleeves in one cloth. Returns the materials so details can match. */
function jacket(k, color, { rough = 0.85, sleeve = color, sleeves = 'long', hand = true, map = null } = {}) {
  const main = M(map ? '#ffffff' : color, { rough, map });
  const arm = sleeve === color ? main : M(sleeve, { rough });
  k.box('chest', 0.65, 0.39, 0.35, main, [0, 1.27, 0], [0, 0, 0], 0.05);
  k.box('spine', 0.665, 0.31, 0.365, main, [0, 0.95, 0], [0, 0, 0], 0.04);
  for (const [s, side] of SIDES) {
    k.box(`upperArm${side}`, 0.262, 0.35, 0.262, arm, [0.445 * s, 1.29, 0], [0, 0, 0], 0.06);
    if (sleeves === 'long') k.box(`forearm${side}`, 0.262, 0.24, 0.262, arm, [0.445 * s, 1.015, 0], [0, 0, 0], 0.05);
    else k.box(`forearm${side}`, 0.215, 0.24, 0.215, M(FUR), [0.445 * s, 1.012, 0], [0, 0, 0], 0.07);
  }
  return main;
}
const neck = (k, color = FUR) => k.cyl('neck', 0.15, 0.17, 0.13, M(color), [0, 1.47, 0]);

/** A shirt front with a collar and a tie. */
function collarAndTie(k, { shirt = WHITE, tie = BLACK, open = true } = {}) {
  if (open) k.flat('chest', [[-0.13, 0.2], [0.13, 0.2], [0, -0.14]], 0.012, M(shirt), [0, 1.27, 0.183]);
  for (const s of [1, -1]) k.flat('chest', [[0, 0], [0.145 * s, 0.025], [0.075 * s, -0.095]], 0.014, M(shirt, { rough: 0.7 }), [0.018 * s, 1.455, 0.198]);
  k.flat('chest', [[-0.04, 0.03], [0.04, 0.03], [0.022, -0.035], [-0.022, -0.035]], 0.02, M(tie), [0, 1.4, 0.205]);
  k.flat('chest', [[-0.022, 0], [0.022, 0], [0.05, -0.23], [0, -0.28], [-0.05, -0.23]], 0.016, M(tie), [0, 1.37, 0.202]);
}

/** Apply a rest-pose transform (the holder's) to a part that already hangs on a bone. */
function rigAttach(holder, part, bone) {
  holder.updateMatrix();
  bone.updateMatrixWorld(true);
  const world = holder.matrix.clone().multiply(part.matrixWorld);
  const local = bone.matrixWorld.clone().invert().multiply(world);
  local.decompose(part.position, part.quaternion, part.scale);
  part.updateMatrixWorld(true);
}

// ================================================================ the looks
export const LOOKS = [
  {
    id: 'green-hoodie', name: 'Green Hoodie', hide: ['farmer_ears', 'farmer_earsin'], pants: '#2c2f25', boots: '#e9e2d2',
    build(k) {
      // an olive hoodie with a dotted green print (an original pattern, no one's portrait)
      const print = canvasTex(512, 512, (g) => {
        g.fillStyle = '#8fa51c'; g.fillRect(0, 0, 512, 512);
        for (let y = 0; y < 512; y += 8) for (let x = 0; x < 512; x += 8) {
          const v = Math.sin(x * 0.037 + Math.sin(y * 0.029) * 2.4) * Math.cos(y * 0.041 + Math.sin(x * 0.023) * 2);
          if (v > 0.05) { g.fillStyle = v > 0.4 ? '#161d04' : '#38450a'; g.beginPath(); g.arc(x + 4, y + 4, 2 + v * 3, 0, TAU); g.fill(); } else if (v < -0.62) { g.fillStyle = '#d6e84a'; g.fillRect(x + 2, y + 2, 4, 4); }
        }
      });
      jacket(k, '#8fa51c', { map: print });
      const cloth = M('#ffffff', { map: print, double: true, rough: 0.92 });
      // the hood: a shell around the head, open at the face, pulled up to a soft point
      const hood = new THREE.SphereGeometry(1, 144, 108);
      const p = hood.attributes.position, keep = [];
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const tip = Math.max(0, y) ** 3;
        p.setXYZ(i, x * 0.475 * (1 - tip * 0.28), y * 0.4 + tip * 0.14, z * 0.39 - tip * 0.02);
      }
      const idx = hood.index.array;
      for (let t = 0; t < idx.length; t += 3) {
        let cx = 0, cy = 0, cz = 0;
        for (let j = 0; j < 3; j++) { cx += p.getX(idx[t + j]) / 3; cy += p.getY(idx[t + j]) / 3; cz += p.getZ(idx[t + j]) / 3; }
        const inFace = cz > 0.06 && (cx / 0.35) ** 2 + ((cy + 0.06) / 0.29) ** 2 < 1;
        if (!inFace && cy > -0.35) keep.push(idx[t], idx[t + 1], idx[t + 2]);
      }
      hood.setIndex(keep);
      hood.computeVertexNormals();
      k.mesh('head', hood, cloth, [0, Y + 0.075, -0.01]);
      const rim = [];
      for (let i = 0; i <= 24; i++) { const a = -0.78 + (i / 24) * (Math.PI + 1.56); rim.push([Math.cos(a) * 0.36, Y + 0.015 + Math.sin(a) * 0.3, 0.255 - Math.max(0, Math.sin(a)) * 0.01]); }
      k.tube('head', rim, 0.034, M('#6f8214'), 60);
      for (const s of [1, -1]) k.flat('chest', [[0, 0], [0.22 * s, 0.05], [0.07 * s, -0.2]], 0.03, cloth, [0.04 * s, 1.43, 0.19]);
      moustache(k, { drop: 0.72, goatee: false });
      k.strand('beard', [[0, Y - 0.22, 0.28], [0, Y - 0.35, 0.29], [0, Y - 0.56, 0.255]], [[0, 0.06], [0.4, 0.07], [1, 0.002]], M('#F6EFE0', { glow: 0.14 }), 0.25);
      // the rolled-up prop of the photo, with its glowing tip and smoke: separate parts, easy to switch off
      const tip = [-0.34, Y - 0.255, 0.47];
      k.named('smoke_prop', [
        k.mesh('head', new THREE.CylinderGeometry(0.034, 0.019, 0.34, 14), M('#d8bd8c'), [-0.19, Y - 0.218, 0.418], [0, 0.34, Math.PI / 2 + 0.22]),
        k.ball('head', 0.035, M('#ff5a14', { glow: 1.4 }), tip),
        ...[[-0.02, 0.065, 0.032, 0.75], [-0.07, 0.125, 0.044, 0.62], [-0.05, 0.215, 0.058, 0.48], [-0.12, 0.29, 0.07, 0.34], [-0.09, 0.39, 0.078, 0.22]].map(([dx, dy, r, a]) => {
          const m = new THREE.MeshStandardMaterial({ color: '#eef0ea', transparent: true, opacity: a, roughness: 1, depthWrite: false });
          return k.ball('head', r, m, [tip[0] + dx, tip[1] + dy, tip[2]], [1, 0.8, 0.7]);
        }),
      ]);
    },
  },
  {
    id: 'orange-bun', name: 'Orange Bun', pants: '#6d6684', boots: '#efe7ee',
    build(k) {
      const robe = M('#d9c3da', { rough: 0.95 });
      jacket(k, '#d9c3da', { rough: 0.95 });
      for (const [s] of SIDES) k.box('chest', 0.085, 0.42, 0.04, M('#7d6a9e'), [0.215 * s, 1.27, 0.186], [0, 0, 0.12 * s]);
      // a wrapped scarf: soft rings, each a little different
      for (const [y, r, t, tilt] of [[1.47, 0.215, 0.062, 0.05], [1.405, 0.255, 0.058, -0.09], [1.34, 0.27, 0.046, 0.13]]) k.torus('chest', r, t, robe, [0, y, 0.015], [Math.PI / 2, tilt, 0], [1.1, 0.88, 1]);
      k.strand('chest', [[0.14, 1.42, 0.23], [0.19, 1.25, 0.225], [0.17, 1.06, 0.215]], [[0, 0.06], [0.6, 0.075], [1, 0.045]], robe, 0.3);
      const hair = M('#d9631f', { rough: 0.65, glow: 0.1 }), light = M('#ee8434', { rough: 0.6, glow: 0.12 });
      k.mesh('head', new THREE.SphereGeometry(1, 40, 24, 0, TAU, 0, 1.12), hair, [0, Y + 0.035, -0.025], [-0.18, 0, 0], [0.4, 0.34, 0.34]);
      // fringe: locks that start on the crown and sweep apart over the forehead
      [[-0.02, -0.17, -0.02], [0.02, -0.07, 0.05], [0.04, 0.09, -0.01], [0.05, 0.2, 0.03], [-0.04, -0.27, -0.05], [0.06, 0.3, -0.03], [0, 0.015, 0.075]].forEach(([x0, x1, dy], i) => {
        k.strand('head', [[x0, Y + 0.34, 0.06], [(x0 + x1) / 2, Y + 0.27, 0.27], [x1, Y + 0.13 + dy, 0.32], [x1 * 1.12, Y + 0.075 + dy, 0.305]], [[0, 0.045], [0.35, 0.062], [0.75, 0.032], [1, 0.002]], i % 2 ? light : hair, 0.38);
      });
      for (const s of [1, -1]) k.strand('head', [[0.2 * s, Y + 0.3, 0.07], [0.35 * s, Y + 0.14, 0.18], [0.345 * s, Y - 0.04, 0.2], [0.31 * s, Y - 0.2, 0.19]], [[0, 0.055], [0.4, 0.05], [1, 0.002]], s > 0 ? hair : light, 0.45);
      // the bun, tied low on one side, with loose ends
      k.ball('head', 0.15, hair, [-0.42, Y - 0.03, -0.04], [1, 0.95, 0.9]);
      k.torus('head', 0.1, 0.028, light, [-0.42, Y - 0.03, 0.04], [0.2, -0.5, 0]);
      for (const [x, y] of [[-0.55, -0.12], [-0.5, -0.21], [-0.54, -0.02]]) k.strand('head', [[-0.4, Y - 0.06, -0.06], [(x - 0.4) / 2, Y + y + 0.04, -0.03], [x, Y + y, -0.02]], [[0, 0.04], [1, 0.002]], light, 0.5);
      const gold = M('#e7b62f', { metal: 0.65, rough: 0.35, glow: 0.12 });
      for (const s of [1, -1]) for (let i = 0; i < 3; i++) k.ball('head', 0.028 - i * 0.002, gold, [0.352 * s, Y - 0.1 - i * 0.056, 0.17]);
      moustache(k, { drop: 0.86, color: '#EEDDB8' });
    },
  },
  {
    id: 'turban-cape', name: 'Turban Cape', pants: '#4a2a78', boots: '#8a5a34',
    build(k) {
      const white = M('#f1efe8', { rough: 0.9 }), shade = M('#d6d3ca'), purple = M('#5b2f92', { rough: 0.85 }), green = M('#7fae45'), pink = M('#e0788a');
      jacket(k, '#5b2f92', { sleeves: 'short' });
      for (const [s, side] of SIDES) {
        k.box(`forearm${side}`, 0.232, 0.245, 0.232, green, [0.445 * s, 1.012, 0], [0, 0, 0], 0.075);
        k.ball(`forearm${side}`, 0.075, pink, [0.445 * s, 1.03, 0.085], [1, 1.35, 0.55]);
        k.box(`upperArm${side}`, 0.28, 0.2, 0.28, green, [0.445 * s, 1.23, 0], [0, 0, 0], 0.08);
        k.ball(`upperArm${side}`, 0.08, pink, [0.45 * s, 1.23, 0.108], [1, 1.2, 0.5]);
        k.box(`forearm${side}`, 0.25, 0.055, 0.25, M('#c4262e'), [0.445 * s, 0.915, 0]);
        // the broad shoulder guards of the cape
        k.ball('chest', 0.26, white, [0.37 * s, 1.43, -0.01], [1.45, 0.42, 1.0], [0, 0, -0.16 * s]);
        k.torus('chest', 0.25, 0.016, shade, [0.38 * s, 1.425, 0], [Math.PI / 2, -0.16 * s, 0], [1.4, 0.95, 1]);
        k.strand('chest', [[0.12 * s, 1.5, 0.19], [0.17 * s, 1.34, 0.23], [0.04 * s, 1.2, 0.225]], [[0, 0.055], [0.5, 0.07], [1, 0.03]], white, 0.35);
      }
      k.torus('chest', 0.25, 0.085, white, [0, 1.46, 0], [Math.PI / 2 + 0.1, 0, 0], [1.15, 0.92, 1]);
      k.flat('chest', [[-0.52, 0.2], [0.52, 0.2], [0.44, -0.72], [-0.44, -0.72]], 0.03, white, [0, 1.25, -0.235]);
      k.box('spine', 0.69, 0.1, 0.39, M('#2c6fd0'), [0, 0.86, 0]);
      k.flat('spine', [[-0.04, 0], [0.05, 0], [0.09, -0.2], [0, -0.22]], 0.02, M('#2c6fd0'), [0.1, 0.84, 0.2]);
      // the turban: wrapped bands around a purple crown
      k.mesh('head', new THREE.SphereGeometry(1, 40, 20, 0, TAU, 0, Math.PI / 2), purple, [0, Y + 0.26, -0.03], [0, 0, 0], [0.235, 0.245, 0.23]);
      k.mesh('head', new THREE.CylinderGeometry(0.29, 0.37, 0.17, 48), white, [0, Y + 0.235, -0.025], [0, 0, 0], [1, 1, 0.9]);
      [[0.17, 0.352, 0.03, 0.03, 0.02], [0.2, 0.346, 0.032, -0.12, 0.03], [0.232, 0.332, 0.031, 0.15, -0.02], [0.262, 0.318, 0.031, -0.13, 0], [0.29, 0.302, 0.03, 0.09, 0.02], [0.316, 0.276, 0.027, -0.04, 0]].forEach(([y, r, t, roll, pitch], i) => {
        k.torus('head', r, t, i % 2 ? shade : white, [0, Y + y, -0.024], [Math.PI / 2 + pitch, roll, 0], [1.02, 0.9, 1.25]);
      });
      moustache(k, { drop: 0.7, color: '#EFE0BC', goatee: true });
    },
  },
  {
    id: 'helmet-pilot', name: 'Helmet Pilot', pants: '#233a2c', boots: '#3a342c',
    build(k) {
      const shell = M('#dcdad2', { rough: 0.45, metal: 0.1 }), dark = M('#1c1d20', { rough: 0.45 }), lens = M('#07080a', { rough: 0.08, metal: 0.7 });
      const green = M('#1f5b3c', { rough: 0.9 }), red = M('#c12a22', { rough: 0.55 });
      jacket(k, '#1f5b3c');
      for (const s of [1, -1]) k.flat('chest', [[0, 0], [0.19 * s, 0.04], [0.1 * s, -0.17], [0.03 * s, -0.1]], 0.022, M('#276b48'), [0.03 * s, 1.45, 0.19]);
      k.box('chest', 0.012, 0.36, 0.012, dark, [0, 1.25, 0.182]);
      k.box('spine', 0.012, 0.26, 0.012, dark, [0, 0.96, 0.19]);
      // red guard around the neck and chin
      k.torus('neck', 0.225, 0.05, red, [0, Y - 0.285, 0.01], [Math.PI / 2 + 0.06, 0, 0], [1.12, 0.98, 1]);
      for (const s of [1, -1]) k.strand('head', [[0.34 * s, Y - 0.02, 0.15], [0.31 * s, Y - 0.19, 0.22], [0.17 * s, Y - 0.27, 0.28]], [[0, 0.03], [0.5, 0.042], [1, 0.03]], red, 0.55);
      // helmet: dome, front rim, a row of dark vents, side plates and ear cups
      k.mesh('head', new THREE.SphereGeometry(1, 48, 24, 0, TAU, 0, Math.PI / 2), shell, [0, Y + 0.15, -0.025], [-0.07, 0, 0], [0.44, 0.315, 0.385]);
      k.torus('head', 1, 0.07, shell, [0, Y + 0.157, -0.025], [Math.PI / 2 - 0.07, 0, 0], [0.425, 0.372, 0.34]);
      for (let i = -2; i <= 2; i++) {
        const a = i * 0.27;
        k.ball('head', 0.027, dark, [Math.sin(a) * 0.4, Y + 0.285, -0.025 + Math.cos(a) * 0.338], [1, 1, 0.5], [-0.4, a, 0]);
      }
      k.box('head', 0.1, 0.05, 0.3, shell, [0, Y + 0.47, -0.03]);
      for (const s of [1, -1]) {
        k.box('head', 0.09, 0.26, 0.24, shell, [0.405 * s, Y + 0.08, -0.03], [0, 0, 0.06 * s], 0.04);
        k.cyl('head', 0.14, 0.14, 0.11, shell, [0.45 * s, Y - 0.005, 0.02], [0, 0, Math.PI / 2], 36);
        k.cyl('head', 0.092, 0.092, 0.13, dark, [0.462 * s, Y - 0.005, 0.02], [0, 0, Math.PI / 2], 36);
        k.cyl('head', 0.04, 0.04, 0.15, shell, [0.47 * s, Y - 0.005, 0.02], [0, 0, Math.PI / 2], 24);
        // goggles
        const z = faceZ(0.15, 0.055) + 0.035;
        k.cyl('head', 0.112, 0.118, 0.085, dark, [0.135 * s, Y + 0.058, z], [Math.PI / 2, 0, -0.3 * s], 40);
        k.cyl('head', 0.082, 0.082, 0.03, lens, [0.137 * s, Y + 0.058, z + 0.05], [Math.PI / 2, 0, -0.22 * s], 40);
        k.torus('head', 0.092, 0.014, M('#3a3c42', { metal: 0.5, rough: 0.35 }), [0.137 * s, Y + 0.058, z + 0.052], [0, 0.22 * s, 0]);
        k.ball('head', 0.017, M('#cfe6ff', { glow: 0.8 }), [0.137 * s - 0.03, Y + 0.09, z + 0.072], [1.3, 0.8, 0.3]);
        k.tube('head', [[0.23 * s, Y + 0.06, z - 0.01], [0.33 * s, Y + 0.07, 0.2], [0.41 * s, Y + 0.07, 0.07]], 0.022, dark);
      }
      k.box('head', 0.07, 0.035, 0.04, dark, [0, Y + 0.065, faceZ(0, 0.065) + 0.05]);
      moustache(k, { drop: 0.55, color: '#EADCB6', thick: 0.9 });
    },
  },
  {
    id: 'team-china', name: 'Team China', pants: '#3c3f49', boots: '#f1ede4', pose: { upperArmR: [-0.72, 0, -0.16], forearmR: [-1.25, 0, 0.12], handR: [-0.2, 0, 0] },
    build(k) {
      const tee = M('#f0ece4', { rough: 0.95 }), red = M('#b92b2b', { rough: 0.8 });
      jacket(k, '#f0ece4', { rough: 0.95, sleeves: 'short' });
      k.torus('neck', 0.175, 0.028, red, [0, 1.462, 0.015], [Math.PI / 2 + 0.12, 0, 0], [1.1, 1, 1]);
      for (const [s, side] of SIDES) k.box(`upperArm${side}`, 0.272, 0.04, 0.272, red, [0.445 * s, 1.135, 0]);
      const words = canvasTex(1024, 600, (g) => {
        g.textAlign = 'center'; g.fillStyle = '#2a2424';
        g.font = '900 172px Arial Black, Arial'; g.fillText('Direct 2', 512, 175);
        g.fillText('Chinese', 512, 335);
        g.fillText('Baddies', 512, 495);
        g.fillStyle = '#c3222b'; g.font = '130px Arial'; g.fillText('♥', 790, 596);
      });
      k.decal('chest', 0.52, 0.305, words, [0.05, 1.145, 0.19]);
      // the red cap
      const cap = M('#b3242a', { rough: 0.85 });
      k.mesh('head', new THREE.SphereGeometry(1, 48, 24, 0, TAU, 0, Math.PI / 2), cap, [0, Y + 0.185, -0.03], [-0.08, 0, 0], [0.37, 0.3, 0.335]);
      k.mesh('head', new THREE.CylinderGeometry(1, 1, 0.034, 48, 1, false, -Math.PI / 2, Math.PI), cap, [0, Y + 0.2, 0.17], [0.14, 0, 0], [0.31, 1, 0.31]);
      k.ball('head', 0.03, cap, [0, Y + 0.487, -0.05], [1, 0.5, 1]);
      const label = canvasTex(1024, 640, (g) => {
        const star = (x, y, r) => { g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, q = i % 2 ? r * 0.42 : r; g[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * q, y + Math.sin(a) * q); } g.closePath(); g.fill(); };
        g.textAlign = 'center'; g.fillStyle = '#fff6e6';
        g.font = '900 208px Impact, Arial Black'; g.fillText('TEAM', 512, 215);
        g.fillText('CHINA', 512, 420);
        g.fillStyle = '#ffd23a'; star(400, 540, 92);
        for (const [x, y] of [[545, 478], [620, 520], [615, 592], [545, 618]]) star(x, y, 30);
      });
      // the label wraps around the front of the cap
      const front = new THREE.SphereGeometry(1, 48, 24, Math.PI / 2 - 0.78, 1.56, 0.5, 0.98);
      const m = new THREE.MeshStandardMaterial({ map: label, transparent: true, alphaTest: 0.1, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -3 });
      k.mesh('head', front, m, [0, Y + 0.187, -0.028], [-0.08, 0, 0], [0.373, 0.304, 0.339]);
      moustache(k, { drop: 0.2, color: '#F3E8D2', thick: 0.8 });
      // the lucky cat, held in the right paw (the viewer's left)
      const at = [-0.54, 1.27, 0.47];
      const lc = M('#fbf6ee', { rough: 0.35 }), gold = M('#e3ac2c', { metal: 0.6, rough: 0.35, glow: 0.1 }), ink = M('#2a1d18'), lred = M('#c9252c', { rough: 0.4 });
      const on = 'handR_hold';
      const P = (x, y, z) => [at[0] + x, at[1] + y, at[2] + z];
      k.ball(on, 0.13, lc, P(0, -0.07, 0), [1, 1.15, 0.85]);
      k.ball(on, 0.125, lc, P(0, 0.13, 0.01), [1.08, 0.95, 0.92]);
      for (const s of [1, -1]) {
        k.mesh(on, new THREE.ConeGeometry(0.055, 0.11, 4), lc, P(0.082 * s, 0.245, 0), [0, 0, -0.35 * s]);
        k.mesh(on, new THREE.ConeGeometry(0.028, 0.065, 4), lred, P(0.082 * s, 0.24, 0.026), [0, 0, -0.35 * s]);
        k.torus(on, 0.024, 0.0065, ink, P(0.047 * s, 0.14, 0.123), [0, 0, 0], [1, 0.8, 1], Math.PI);
        k.ball(on, 0.05, lc, P(0.07 * s, -0.19, 0.06), [1, 0.65, 1]);
      }
      k.ball(on, 0.012, lred, P(0, 0.108, 0.128));
      k.torus(on, 0.095, 0.02, lred, P(0, 0.035, 0.01), [Math.PI / 2, 0, 0], [1.05, 0.9, 1]);
      k.strand(on, [P(-0.09, -0.04, 0.05), P(-0.17, 0.05, 0.07), P(-0.165, 0.18, 0.07)], [[0, 0.045], [0.6, 0.038], [1, 0.044]], lc, 1);
      k.ball(on, 0.05, lc, P(-0.165, 0.195, 0.07), [1, 1.05, 0.9]);
      const coin = canvasTex(256, 384, (g) => {
        g.fillStyle = '#e8b330'; g.fillRect(0, 0, 256, 384);
        g.strokeStyle = '#9a6a10'; g.lineWidth = 12; g.strokeRect(20, 20, 216, 344);
        g.fillStyle = '#3a1606'; g.textAlign = 'center'; g.font = 'bold 150px "Microsoft YaHei", SimHei, serif';
        g.fillText('招', 128, 172); g.fillText('財', 128, 330);
      });
      k.ball(on, 0.085, gold, P(0.035, -0.085, 0.105), [0.75, 1.1, 0.22]);
      k.decal(on, 0.085, 0.13, coin, P(0.035, -0.085, 0.128));
    },
  },
  {
    id: 'lucky-dice', name: 'Lucky Dice', pants: '#141318', boots: '#101014', pose: { upperArmL: [-0.92, 0, 0.28], upperArmR: [-0.92, 0, -0.28], forearmL: [-0.45, 0, 0], forearmR: [-0.45, 0, 0] },
    build(k) {
      const suit = M('#1d1c22', { rough: 0.75 });
      jacket(k, '#1d1c22', { rough: 0.75 });
      collarAndTie(k);
      for (const s of [1, -1]) k.flat('chest', [[0, 0.19], [0.1 * s, 0.17], [0.115 * s, 0.03], [0.02 * s, -0.17]], 0.014, M('#2b2a33'), [0.075 * s, 1.265, 0.19]);
      for (const [s, side] of SIDES) k.box(`forearm${side}`, 0.268, 0.035, 0.268, M(WHITE), [0.445 * s, 0.915, 0]);
      const brow = M('#e2531c', { glow: 0.3 }), heart = M('#e63b4a', { glow: 0.3 });
      for (const s of [1, -1]) {
        k.strand('head', [[0.055 * s, Y + 0.102, faceZ(0.055, 0.102) + 0.012], [0.15 * s, Y + 0.145, faceZ(0.15, 0.145) + 0.016], [0.255 * s, Y + 0.168, faceZ(0.25, 0.165) + 0.016]], [[0, 0.016], [0.4, 0.031], [1, 0.003]], brow, 0.3);
        const h = new THREE.Shape();
        h.moveTo(0, -0.042);
        h.bezierCurveTo(-0.07, 0.005, -0.04, 0.062, 0, 0.022);
        h.bezierCurveTo(0.04, 0.062, 0.07, 0.005, 0, -0.042);
        k.mesh('head', new THREE.ExtrudeGeometry(h, { depth: 0.008, bevelEnabled: false }), heart, [0.255 * s, Y - 0.07, faceZ(0.255, -0.07) + 0.004], [0, 0.78 * s, 0]);
      }
      moustache(k, { drop: 0.38, color: '#F4EAD6', thick: 1.1 });
      // two big red dice, floating just off the paws
      const die = (x, y, z, rot) => {
        const g = new THREE.Group();
        const body = new THREE.Mesh(roundedBox(0.3, 0.3, 0.3, 0.055), M('#c8202a', { rough: 0.28 }));
        body.castShadow = true;
        g.add(body);
        const pip = M('#fdf6ea', { rough: 0.4, glow: 0.12 });
        const spots = { 1: [[0, 0]], 2: [[-1, 1], [1, -1]], 3: [[-1, 1], [0, 0], [1, -1]], 4: [[-1, -1], [-1, 1], [1, -1], [1, 1]], 5: [[-1, -1], [-1, 1], [0, 0], [1, -1], [1, 1]], 6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]] };
        for (const [n, normal, u, v] of [[6, [0, 0, 1], [1, 0, 0], [0, 1, 0]], [3, [0, 1, 0], [1, 0, 0], [0, 0, -1]], [5, [1, 0, 0], [0, 0, -1], [0, 1, 0]], [2, [-1, 0, 0], [0, 0, 1], [0, 1, 0]], [4, [0, -1, 0], [1, 0, 0], [0, 0, 1]], [1, [0, 0, -1], [-1, 0, 0], [0, 1, 0]]]) {
          for (const [a, b] of spots[n]) {
            const d = new THREE.Mesh(new THREE.SphereGeometry(0.031, 16, 12), pip);
            d.position.copy(V(normal).multiplyScalar(0.15)).addScaledVector(V(u), a * 0.072).addScaledVector(V(v), b * 0.072);
            d.scale.set(normal[0] ? 0.25 : 1, normal[1] ? 0.25 : 1, normal[2] ? 0.25 : 1);
            g.add(d);
          }
        }
        g.position.set(x, y, z); g.rotation.set(...rot); g.scale.setScalar(0.82);
        k.hang(g, 'chest');
      };
      die(-0.43, 1.37, 0.66, [0.42, 0.55, 0.12]);
      die(0.44, 1.23, 0.68, [0.35, -0.5, -0.22]);
    },
  },
  {
    id: 'thermal', name: 'Thermal Vision', pants: null, boots: null, thermal: true,
    build(k) {
      // a plain cat with no clothes: chest, belly and furry arms
      const fur = M(FUR);
      k.ball('chest', 0.34, fur, [0, 1.23, 0], [0.98, 0.9, 0.6]);
      k.ball('spine', 0.34, fur, [0, 0.99, 0], [0.9, 0.85, 0.62]);
      k.ball('hips', 0.3, fur, [0, 0.78, 0], [1.02, 0.55, 0.6]);
      neck(k);
      for (const [s, side] of SIDES) {
        k.ball(`upperArm${side}`, 0.13, fur, [0.42 * s, 1.28, 0], [0.95, 1.65, 0.95]);
        k.ball(`forearm${side}`, 0.11, fur, [0.445 * s, 1.0, 0], [0.95, 1.5, 0.95]);
        k.ball(`thigh${side}`, 0.15, fur, [0.155 * s, 0.6, 0], [1, 1.55, 1]);
      }
      moustache(k, { drop: 0.72, color: '#fff3cc', thick: 1.1 });
      k.strand('beard', [[0, Y - 0.24, 0.26], [0, Y - 0.42, 0.26], [0, Y - 0.66, 0.2]], [[0, 0.07], [0.4, 0.09], [1, 0.004]], M(CREAM), 0.3);
    },
  },
  {
    id: 'red-puffer', name: 'Red Puffer', pants: '#151418', boots: '#c8202a',
    build(k) {
      const red = new THREE.MeshPhysicalMaterial({ color: '#d61a22', roughness: 0.32, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.12, emissive: '#d61a22', emissiveIntensity: 0.08 }), black = M('#121014', { rough: 0.6 }), orange = M('#f4571a', { rough: 0.5, glow: 0.22 });
      // quilted jacket: fat rounded rows
      for (const [on, y, w] of [['chest', 1.385, 0.69], ['chest', 1.225, 0.72], ['spine', 1.065, 0.71], ['spine', 0.91, 0.69]]) k.box(on, w, 0.17, 0.42, red, [0, y, 0], [0, 0, 0], 0.082);
      for (const [s, side] of SIDES) {
        for (const [on, y] of [[`upperArm${side}`, 1.375], [`upperArm${side}`, 1.215], [`forearm${side}`, 1.06], [`forearm${side}`, 0.945]]) k.box(on, 0.305, 0.16, 0.305, red, [0.455 * s, y, 0], [0, 0, 0], 0.078);
        k.strand('chest', [[0.04 * s, 1.5, 0.19], [0.2 * s, 1.49, 0.2], [0.32 * s, 1.44, 0.09]], [[0, 0.06], [0.5, 0.082], [1, 0.055]], red, 0.75);
      }
      k.torus('neck', 0.22, 0.062, red, [0, 1.47, -0.01], [Math.PI / 2, 0, 0], [1.12, 0.96, 1]);
      k.box('chest', 0.022, 0.4, 0.02, M('#6d0b10', { metal: 0.5, rough: 0.3 }), [0, 1.26, 0.213]);
      k.box('spine', 0.022, 0.24, 0.02, M('#6d0b10', { metal: 0.5, rough: 0.3 }), [0, 0.99, 0.212]);
      // black twists with a heavy fringe
      k.mesh('head', new THREE.SphereGeometry(1, 40, 24, 0, TAU, 0, 1.2), black, [0, Y + 0.04, -0.03], [-0.22, 0, 0], [0.405, 0.345, 0.345]);
      rs = 31;
      for (let i = 0; i < 17; i++) {
        const u = i / 16 - 0.5, x = u * 0.6;
        const low = Math.abs(u) > 0.3 ? -0.16 - rnd() * 0.1 : 0.115 + rnd() * 0.055 + (i % 3 === 0 ? -0.03 : 0);
        const ex = Math.abs(u) > 0.3 ? u * 0.78 : x * 1.1 + (rnd() - 0.5) * 0.06;
        k.strand('head', [[x * 0.35, Y + 0.34, 0.04], [x * 0.8, Y + 0.27, 0.27], [ex, Y + Math.max(low, 0.12) + 0.04, Math.abs(u) > 0.3 ? 0.22 : 0.325], [ex * 1.03, Y + low, Math.abs(u) > 0.3 ? 0.2 : 0.31]], [[0, 0.028], [0.5, 0.031], [0.9, 0.021], [1, 0.006]], M('#141117', { rough: 0.75 }), 0.85);
      }
      for (let i = 0; i < 12; i++) {
        const s = i % 2 ? 1 : -1, z = 0.1 - (i % 6) * 0.075;
        k.strand('head', [[0.22 * s, Y + 0.3, z * 0.7], [0.41 * s, Y + 0.13, z], [0.43 * s, Y - 0.12 - rnd() * 0.1, z * 0.95]], [[0, 0.036], [0.7, 0.03], [1, 0.008]], black, 0.85);
      }
      // the two pointed horns, black with orange bands
      for (const s of [1, -1]) {
        const base = V([0.225 * s, Y + 0.3, -0.02]), tipAt = V([0.385 * s, Y + 0.68, -0.02]);
        const dir = tipAt.clone().sub(base), len = dir.length();
        const q = new THREE.Quaternion().setFromUnitVectors(V([0, 1, 0]), dir.clone().normalize());
        const eu = new THREE.Euler().setFromQuaternion(q);
        const bands = 5, r0 = 0.108;
        for (let i = 0; i < bands; i++) {
          const a = i / bands, b = (i + 1) / bands;
          const mid = base.clone().addScaledVector(dir, (a + b) / 2);
          k.mesh('head', new THREE.CylinderGeometry(Math.max(0.004, r0 * (1 - b)), r0 * (1 - a), len / bands, 4), i % 2 ? black : orange, mid.toArray(), [eu.x, eu.y, eu.z], [1, 1, 0.62]);
        }
        for (const [t, side] of [[0.34, 1], [0.62, -1]]) {
          const c = base.clone().addScaledVector(dir, t);
          k.box('head', 0.05, 0.036, 0.03, black, [c.x + side * 0.03 * s, c.y, c.z + 0.055], [eu.x, eu.y, eu.z]);
        }
      }
      moustache(k, { drop: 0.7, color: '#EFE1BE', thick: 1.05 });
    },
  },
  {
    id: 'pink-hair', name: 'Pink Hair', pants: '#2a2930', boots: '#17161a',
    build(k) {
      jacket(k, '#eeebe4', { rough: 0.95, sleeves: 'short' });
      collarAndTie(k, { open: false });
      for (const [s, side] of SIDES) k.box(`upperArm${side}`, 0.274, 0.045, 0.274, M('#dbd7ce'), [0.445 * s, 1.13, 0]);
      const pinks = [M('#e87ea4', { rough: 0.7, glow: 0.14 }), M('#d8658f', { rough: 0.7, glow: 0.12 }), M('#f39ab9', { rough: 0.7, glow: 0.16 })];
      k.mesh('head', new THREE.SphereGeometry(1, 40, 24, 0, TAU, 0, 1.14), pinks[1], [0, Y + 0.035, -0.03], [-0.2, 0, 0], [0.4, 0.35, 0.34]);
      rs = 97;
      // spikes standing out all over the crown
      for (let i = 0; i < 58; i++) {
        const a = rnd() * TAU, el = 0.35 + rnd() * 1.1;
        const n = V([Math.cos(el) * Math.sin(a), Math.sin(el), Math.cos(el) * Math.cos(a)]);
        const from = [n.x * 0.31, Y + 0.07 + n.y * 0.27, -0.03 + n.z * 0.26];
        const to = [n.x * 0.49 + (rnd() - 0.5) * 0.1, Y + 0.09 + n.y * 0.4 - (n.z > 0.5 ? 0.07 : 0), -0.03 + n.z * 0.4];
        const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2 + 0.035, (from[2] + to[2]) / 2];
        k.strand('head', [from, mid, to], [[0, 0.062], [0.5, 0.038], [1, 0.0015]], pinks[i % 3], 0.6);
      }
      [[-0.2, -0.29, 0.06], [-0.13, -0.15, 0.13], [-0.04, -0.07, 0.18], [0.05, 0.03, 0.14], [0.12, 0.16, 0.17], [0.19, 0.29, 0.07]].forEach(([x0, x1, y1], i) => {
        k.strand('head', [[x0 * 0.5, Y + 0.34, 0.07], [x0, Y + 0.28, 0.28], [x1, Y + y1, 0.325]], [[0, 0.06], [0.45, 0.052], [1, 0.002]], pinks[i % 3], 0.4);
      });
      // black rectangular glasses
      const frame = M('#101013', { rough: 0.3 });
      const gz = faceZ(0.15, 0.055) + 0.062;
      for (const s of [1, -1]) {
        for (const [w, h, x, y] of [[0.19, 0.022, 0, 0.065], [0.19, 0.02, 0, -0.062], [0.022, 0.145, -0.092, 0], [0.022, 0.145, 0.092, 0]]) k.box('head', w, h, 0.022, frame, [0.148 * s + x, Y + 0.05 + y, gz], [0, 0.17 * s, 0], 0.008);
        k.box('head', 0.17, 0.11, 0.006, new THREE.MeshStandardMaterial({ color: '#bfe0ff', transparent: true, opacity: 0.12, roughness: 0.05, metalness: 0.3, depthWrite: false }), [0.148 * s, Y + 0.05, gz - 0.002], [0, 0.17 * s, 0], 0.002);
        k.tube('head', [[0.245 * s, Y + 0.095, gz - 0.025], [0.34 * s, Y + 0.09, 0.17], [0.385 * s, Y + 0.07, 0.03]], 0.012, frame);
      }
      k.box('head', 0.08, 0.018, 0.018, frame, [0, Y + 0.085, gz + 0.012]);
      // the cross earring
      const silver = M('#d7dbe2', { metal: 0.85, rough: 0.25, glow: 0.12 });
      k.torus('head', 0.028, 0.007, silver, [0.392, Y - 0.005, 0.14], [0, 0.6, 0]);
      k.box('head', 0.019, 0.16, 0.019, silver, [0.4, Y - 0.12, 0.145], [0, 0.4, 0]);
      k.box('head', 0.085, 0.019, 0.019, silver, [0.4, Y - 0.095, 0.145], [0, 0.4, 0]);
      moustache(k, { drop: 0.34, color: '#F1E6D4', thick: 1.0 });
      // cigarette and the shirt stain of the photo: separate parts, easy to switch off
      k.named('smoke_prop', [
        k.mesh('head', new THREE.CylinderGeometry(0.016, 0.016, 0.14, 12), M('#f3efe6'), [0.07, Y - 0.245, 0.43], [0.9, 0, -0.5]),
        k.mesh('head', new THREE.CylinderGeometry(0.0165, 0.0165, 0.04, 12), M('#d88a3c'), [0.045, Y - 0.213, 0.395], [0.9, 0, -0.5]),
      ]);
      const stain = canvasTex(256, 256, (g) => {
        rs = 5;
        g.fillStyle = '#8d0f16';
        const blob = (x, y, r) => { g.beginPath(); for (let i = 0; i <= 18; i++) { const a = (i / 18) * TAU, q = r * (0.7 + rnd() * 0.55); g[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * q, y + Math.sin(a) * q); } g.fill(); };
        blob(120, 118, 56);
        for (let i = 0; i < 22; i++) { const a = rnd() * TAU, q = 62 + rnd() * 52; blob(120 + Math.cos(a) * q, 118 + Math.sin(a) * q, 3 + rnd() * 10); }
        g.fillRect(110, 140, 10, 70);
      });
      k.decal('chest', 0.19, 0.19, stain, [-0.2, 1.23, 0.1795], [0, 0, 0.2], 'stain_prop');
    },
  },
  {
    id: 'cinnamon-knight', name: 'Cinnamon Knight', pants: '#7d848e', boots: '#9aa1ab',
    build(k) {
      const steel = M('#c3c8d0', { metal: 0.38, rough: 0.3, glow: 0.06 }), bright = M('#e3e7ee', { metal: 0.4, rough: 0.22, glow: 0.08 }), mail = M('#aab0ba', { metal: 0.4, rough: 0.4, glow: 0.05 });
      k.box('chest', 0.65, 0.39, 0.37, steel, [0, 1.26, 0], [0, 0, 0], 0.13);
      k.box('spine', 0.6, 0.31, 0.35, steel, [0, 0.95, 0], [0, 0, 0], 0.09);
      k.box('chest', 0.025, 0.34, 0.02, bright, [0, 1.24, 0.188]);
      for (const y of [0.99, 0.905, 0.825]) k.box('spine', 0.665, 0.07, 0.385, y === 0.905 ? bright : steel, [0, y, 0], [0, 0, 0], 0.03);
      for (const [s, side] of SIDES) {
        k.ball(`upperArm${side}`, 0.19, bright, [0.45 * s, 1.37, 0], [1, 0.82, 1]);
        k.box(`upperArm${side}`, 0.255, 0.28, 0.255, steel, [0.445 * s, 1.24, 0], [0, 0, 0], 0.1);
        k.ball(`forearm${side}`, 0.115, mail, [0.445 * s, 1.11, 0]);
        k.box(`forearm${side}`, 0.262, 0.2, 0.262, steel, [0.445 * s, 0.995, 0], [0, 0, 0], 0.085);
        k.box(`forearm${side}`, 0.278, 0.036, 0.278, bright, [0.445 * s, 0.915, 0]);
      }
      // chain mail around the neck: rows of little interlocking rings
      const ring = new THREE.TorusGeometry(0.024, 0.0075, 5, 12); // one light ring, shared by all of them
      for (let row = 0; row < 5; row++) {
        const r = 0.19 + row * 0.036, y = 1.505 - row * 0.034, n = 34 + row * 5;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + (row % 2) * (Math.PI / n);
          k.mesh('chest', ring, mail, [Math.sin(a) * r * 1.16, y, 0.01 + Math.cos(a) * r * 0.9], [row % 2 ? 0.35 : -0.35, a, 0]);
        }
      }
      // a cinnamon roll for a helmet, with icing running down
      const dough = M('#c98c46', { rough: 0.62, glow: 0.08 }), cinnamon = M('#6e3913', { rough: 0.7 }), icing = M('#fbf0d8', { rough: 0.28, glow: 0.12 });
      k.mesh('head', new THREE.SphereGeometry(1, 48, 20, 0, TAU, 0, Math.PI / 2), icing, [0, Y + 0.165, -0.025], [-0.05, 0, 0], [0.405, 0.2, 0.355]);
      k.ball('head', 0.29, dough, [0, Y + 0.355, -0.03], [1, 0.42, 0.9]);
      const spiral = (r0, h, off) => Array.from({ length: 90 }, (_, i) => { const t = i / 89, a = t * TAU * 2.6 + off, r = r0 * (1 - t * 0.9); return [Math.cos(a) * r, Y + h + t * 0.085, -0.03 + Math.sin(a) * r * 0.9]; });
      const lean = (m) => { // turn a part of the swirl about the middle of the roll
        const c = V([0, Y + 0.38, -0.03]), q = new THREE.Quaternion().setFromAxisAngle(V([1, 0, 0]), 0.62);
        const holder = new THREE.Group();
        holder.position.copy(c).sub(c.clone().applyQuaternion(q)); holder.quaternion.copy(q);
        const parent = m.parent;
        rigAttach(holder, m, parent);
      };
      for (const m of [
        k.tube('head', spiral(0.262, 0.405, 0), 0.047, dough, 220),
        k.tube('head', spiral(0.214, 0.442, 0.25), 0.017, cinnamon, 220),
        k.ball('head', 0.058, cinnamon, [0, Y + 0.495, -0.03], [1, 0.75, 1]),
      ]) lean(m);
      k.torus('head', 0.29, 0.032, icing, [0, Y + 0.34, -0.03], [Math.PI / 2, 0, 0], [1.04, 0.93, 1]);
      rs = 53;
      for (let i = 0; i < 17; i++) {
        const a = (i / 17) * TAU, sx = Math.sin(a), cz = Math.cos(a);
        const len = (cz > 0.5 ? 0.04 : 0.1) + rnd() * (cz > 0.5 ? 0.07 : 0.14);
        const end = [sx * 0.41, Y + 0.185 - len, -0.025 + cz * 0.36];
        k.strand('head', [[sx * 0.28, Y + 0.35, -0.025 + cz * 0.25], [sx * 0.39, Y + 0.255, -0.025 + cz * 0.345], [sx * 0.412, Y + 0.18, -0.025 + cz * 0.362], end], [[0, 0.03], [0.45, 0.048], [0.8, 0.022], [1, 0.016]], icing, 0.5);
        k.ball('head', 0.026, icing, end, [1, 1.2, 0.7]);
      }
      moustache(k, { drop: 0.76, color: '#F0E3C4', goatee: true });
    },
  },
  {
    id: 'ansem', name: 'Ansem', pants: '#3b342c', boots: '#4a3424', pose: { upperArmL: [0.12, 0, 0.78], forearmL: [0, 0, 2.15], handL: [0, 0, 0.1] },
    build(k) {
      const coat = M('#75624c', { rough: 0.95 }), lapel = M('#65533f', { rough: 0.95 }), seam = M('#4a3c2d', { rough: 0.9 });
      jacket(k, '#75624c', { rough: 0.95 });
      neck(k);
      // an open collar over a pale furry chest
      k.flat('chest', [[-0.15, 0.2], [0.15, 0.2], [0, -0.17]], 0.012, M('#f0e6d4', { rough: 1 }), [0, 1.265, 0.181]);
      for (const s of [1, -1]) {
        k.flat('chest', [[0, 0.2], [0.115 * s, 0.185], [0.075 * s, 0.1], [0.14 * s, 0.075], [0.012 * s, -0.18]], 0.022, lapel, [0.105 * s, 1.27, 0.19]);
        k.flat('chest', [[0, 0], [0.13 * s, 0.035], [0.1 * s, -0.075]], 0.02, coat, [0.085 * s, 1.465, 0.205]);
      }
      k.box('spine', 0.014, 0.27, 0.014, seam, [0.02, 0.955, 0.186]);
      for (const y of [1.04, 0.9]) k.ball('spine', 0.026, M('#2f261d', { rough: 0.5 }), [-0.03, y, 0.188], [1, 1, 0.5]);
      // a small green frog peeking out of the breast pocket
      const frog = M('#5c9a3c', { rough: 0.7, glow: 0.08 }), white = M('#f6f3ea', { glow: 0.1 }), ink = M('#14110f'), lip = M('#9a4a30');
      const at = [0.215, 1.175, 0.205];
      const P = (x, y, z) => [at[0] + x, at[1] + y, at[2] + z];
      k.ball('chest', 0.085, frog, P(0, 0.012, -0.012), [1.15, 0.85, 0.6]);
      for (const s of [1, -1]) {
        k.ball('chest', 0.043, frog, P(0.044 * s, 0.062, 0.002), [1.1, 0.9, 0.75]);
        k.ball('chest', 0.027, white, P(0.044 * s, 0.062, 0.03), [1.2, 0.8, 0.45]);
        k.ball('chest', 0.012, ink, P(0.044 * s - 0.006, 0.058, 0.046), [1, 1, 0.5]);
      }
      k.tube('chest', [P(-0.066, 0.008, 0.036), P(-0.02, -0.006, 0.047), P(0.03, 0.0, 0.047), P(0.068, 0.018, 0.034)], 0.011, lip);
      k.box('chest', 0.2, 0.105, 0.05, coat, [0.215, 1.105, 0.2], [0, 0, 0], 0.02);
      k.box('chest', 0.206, 0.022, 0.058, lapel, [0.215, 1.158, 0.202]);
      // the wide-brimmed hat; the ears stay out beside the crown
      const felt = M('#a98553', { rough: 0.92 }), brimTop = M('#b6925e', { rough: 0.92, double: true }), band = M('#4b321c', { rough: 0.75 });
      const lathe = (pts, mat) => k.mesh('head', new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 64), mat, [0, Y + 0.215, -0.02], [-0.09, 0, 0], [1, 1, 0.92]);
      lathe([[0.24, 0.012], [0.4, -0.006], [0.52, -0.004], [0.575, 0.026], [0.57, 0.042], [0.515, 0.02], [0.4, 0.022], [0.24, 0.042]], brimTop);
      lathe([[0.292, 0.02], [0.272, 0.19], [0.25, 0.285], [0.205, 0.328], [0.12, 0.318], [0.0, 0.29]], M('#a98553', { rough: 0.92, double: true }));
      lathe([[0.298, 0.038], [0.285, 0.118]], M('#4b321c', { rough: 0.75, double: true }));
      k.torus('head', 0.293, 0.009, band, [0, Y + 0.27, -0.02], [Math.PI / 2 - 0.09, 0, 0], [1, 0.92, 1]);
      // small orange glasses sitting low on the nose, so the stare goes over them
      const rim = M('#c9922e', { metal: 0.6, rough: 0.3, glow: 0.12 });
      const glass = new THREE.MeshStandardMaterial({ color: '#ff5a14', emissive: '#c2360a', emissiveIntensity: 0.45, transparent: true, opacity: 0.82, roughness: 0.1, metalness: 0.2 });
      glass.name = 'admin_orange_glass';
      const gz = faceZ(0.12, -0.01) + 0.048;
      for (const side of [1, -1]) {
        k.ball('head', 1, glass, [0.118 * side, Y - 0.012, gz], [0.082, 0.038, 0.012], [0, 0.2 * side, 0.04 * side]);
        k.torus('head', 1, 0.075, rim, [0.118 * side, Y - 0.012, gz + 0.004], [0, 0.2 * side, 0.04 * side], [0.084, 0.04, 0.07]);
        k.tube('head', [[0.2 * side, Y - 0.006, gz - 0.016], [0.31 * side, Y + 0.025, 0.21], [0.385 * side, Y + 0.05, 0.05]], 0.009, rim);
      }
      k.tube('head', [[-0.04, Y - 0.004, gz + 0.012], [0, Y + 0.014, gz + 0.034], [0.04, Y - 0.004, gz + 0.012]], 0.008, rim);
      // the wooden bat resting across the shoulders, the grip in the left paw
      const wood = M('#e0aa45', { rough: 0.42, glow: 0.08 }), grip = M('#b9822c', { rough: 0.6 });
      const tip = V([-0.84, 2.02, -0.68]), knob = V([0.93, 1.43, 0.08]); // the grip runs through the left paw
      const dir = knob.clone().sub(tip), len = dir.length();
      const turn = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(V([0, 1, 0]), dir.clone().normalize()));
      const profile = [[0, 0], [0.065, 0.012], [0.092, 0.05], [0.096, 0.28], [0.082, 0.46], [0.05, 0.64], [0.036, 0.78], [0.034, 0.965], [0.056, 0.972], [0.056, 0.995], [0, 1]];
      k.mesh('chest', new THREE.LatheGeometry(profile.map(([r, t]) => new THREE.Vector2(r, t * len)), 40), wood, tip.toArray(), [turn.x, turn.y, turn.z]);
      for (let i = 0; i < 6; i++) {
        const c = tip.clone().addScaledVector(dir, 0.8 + i * 0.027);
        k.mesh('chest', new THREE.TorusGeometry(0.037, 0.006, 8, 24), grip, c.toArray(), new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(V([0, 0, 1]), dir.clone().normalize())).toArray().slice(0, 3));
      }
      moustache(k, { drop: 0.6, color: '#F0E2C0', thick: 0.95 });
      k.strand('beard', [[0, Y - 0.23, 0.28], [0, Y - 0.36, 0.29], [0, Y - 0.55, 0.25]], [[0, 0.065], [0.4, 0.085], [1, 0.003]], M('#F6EFE0', { glow: 0.14 }), 0.22);
    },
  },
];

// ---------------------------------------------------------------- thermal camera colours
const RAMP = [[0, '#0a0430'], [0.17, '#2a0a8a'], [0.34, '#8a0fa0'], [0.5, '#e0306a'], [0.66, '#ff6a1a'], [0.82, '#ffb400'], [0.94, '#ffe632'], [1, '#fffbc0']];
const ramp = RAMP.map(([t, c]) => [t, new THREE.Color(c)]);
export function heat(t, out = new THREE.Color()) {
  t = Math.min(1, Math.max(0, t));
  const i = Math.max(1, ramp.findIndex(([s]) => s >= t));
  const [a, ca] = ramp[i - 1], [b, cb] = ramp[i];
  return out.copy(ca).lerp(cb, (t - a) / (b - a || 1));
}
export const HEAT_STOPS = RAMP;

/** The head photo seen by a heat camera: chunky pixels, dark eyes read cold. */
function heatHead(map) {
  return canvasTex(128, 64, (g, w, h) => {
    g.drawImage(map.image, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h), c = new THREE.Color();
    for (let i = 0; i < d.data.length; i += 4) {
      const x = (i / 4) % w, y = Math.floor(i / 4 / w);
      const lum = (0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2]) / 255;
      const edge = x < 64 ? Math.hypot((x - 32) / 32, (y - 36) / 34) : 0.75;
      heat(lum < 0.3 ? lum * 0.75 : 0.28 + lum * 0.78 - Math.max(0, edge - 0.55) * 0.62, c).convertLinearToSRGB();
      d.data[i] = c.r * 255; d.data[i + 1] = c.g * 255; d.data[i + 2] = c.b * 255; d.data[i + 3] = 255;
    }
    g.putImageData(d, 0, 0);
  });
}

/** Paint every visible mesh with heat colours: warm where it faces the front and near the middle, cold at the rim. */
function paintThermal(rig) {
  rig.updateMatrixWorld(true);
  const v = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Color();
  const flat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  flat.name = 'admin_thermal';
  let headMat = null;
  rig.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    if (o.material.name === 'tex_head' && o.material.map) {
      if (!headMat) {
        const t = heatHead(o.material.map);
        t.flipY = o.material.map.flipY;
        t.magFilter = THREE.NearestFilter;
        headMat = new THREE.MeshBasicMaterial({ map: t, toneMapped: false });
        headMat.name = 'admin_thermal_head';
      }
      o.material = headMat;
      // the face keeps its picture; its baked vertex colours must not tint it
      return;
    }
    const geo = o.geometry.clone();
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const p = geo.attributes.position, nm = geo.attributes.normal, col = new Float32Array(p.count * 3);
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(o.matrixWorld);
    const hair = o.userData.heat === 'hair';
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      n.fromBufferAttribute(nm, i).applyMatrix3(normalMatrix).normalize();
      const middle = Math.max(0, 1 - Math.abs(v.x) / 0.55);
      let t = 0.2 + Math.max(0, n.z) ** 1.4 * 0.42 + middle * 0.28 + Math.sin(v.x * 31) * Math.sin(v.y * 27) * 0.035;
      if (v.y < 0.55) t -= (0.55 - v.y) * 0.6;
      if (hair) t = 0.84 + Math.max(0, n.z) * 0.1;
      heat(t, c);
      col.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    o.geometry = geo;
    o.material = flat;
  });
}

// ---------------------------------------------------------------- putting one admin together
/** The farmer parts every admin replaces: the red jacket, all wardrobe pieces and the built-in facial hair. */
const replaced = (name, look) => look.hide?.includes(name) || /^(fit_|hat_|beard_)/.test(name) || name === 'farmer_hat' || name === 'farmer_hair' || /^farmer_(shirt|shirtdeco|trim_shirt|pantsdeco|trim_pants)$/.test(name)
  || (look.thermal && /^farmer_(pants|bootsdeco)$/.test(name));

/** A static pose clip for the photo's gesture (bones keep their rest rotation unless named in the look). */
function signatureClip(pose = {}) {
  const tracks = ['upperArmL', 'forearmL', 'handL', 'upperArmR', 'forearmR', 'handR'].map((b) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(pose[b] ?? [0, 0, 0])));
    return new THREE.QuaternionKeyframeTrack(`${b}.quaternion`, [0, 2], [...q.toArray(), ...q.toArray()]);
  });
  return new THREE.AnimationClip('signature', 2, tracks);
}

/** gltf: the loaded farmer model. Returns {scene, animations} for one admin, in the rest pose. */
export function buildAdmin(gltf, look) {
  const rig = SkeletonUtils.clone(gltf.scene);
  rig.updateMatrixWorld(true);
  const remove = [];
  rig.traverse((o) => { if (o.isMesh && replaced(o.name, look)) remove.push(o); });
  for (const o of remove) o.parent.remove(o);
  for (const [name, color] of [['farmer_pants', look.pants], ['farmer_boots', look.boots]]) {
    const o = rig.getObjectByName(name);
    if (o && color) { o.material = o.material.clone(); o.material.map = null; o.material.color = new THREE.Color(color); o.material.name = `admin_${name}`; }
  }
  const k = kit(rig);
  // something held in a paw: a bone-like holder that follows the paw in its signature pose
  if (look.id === 'team-china') {
    const hold = new THREE.Group();
    hold.name = 'handR_hold';
    k.hang(hold, 'chest');
  }
  // hair and whiskers are marked so the heat camera paints them hot
  const before = new Set();
  rig.traverse((o) => before.add(o));
  look.build(k);
  if (look.thermal) {
    rig.traverse((o) => {
      // the moustache and whiskers are the hottest thing in the picture
      if (o.isMesh && !before.has(o) && o.material.emissiveIntensity > 0.1 && o.material.color.getHSL({}).l > 0.7) o.userData.heat = 'hair';
    });
    paintThermal(rig);
  }
  rig.name = `mihao_admin_${look.id}`;
  const animations = [signatureClip(look.pose), ...gltf.animations];
  return { scene: rig, animations };
}
