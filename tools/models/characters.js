// Rigged Roblox-style characters built in code: Mihao (the player), the vendors and the pets.
// Each body part is bound to one bone (overlapping joints hide seams); clips are sampled keyframes.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { V3, TAU, rand, col, finish, cyl, cone, roundedBox, place, triCount } from './lib/geo.js';
import { mihaoPlayer, HAIR_BONES, hairSway, BEARD_STYLES } from './mihao.js';

export class Rig {
  constructor(spec) {
    this.bones = {};
    this.list = [];
    for (const [name, parent, pos] of spec) {
      const b = new THREE.Bone();
      b.name = name;
      b.userData.world = new V3(...pos);
      this.bones[name] = b;
      this.list.push(b);
      if (parent) {
        const p = this.bones[parent];
        b.position.copy(b.userData.world).sub(p.userData.world);
        p.add(b);
      } else b.position.copy(b.userData.world);
    }
    this.parts = {}; // slot -> [{geo, bone}]
  }
  /** Add geometry (in rest-pose world coordinates) bound to a bone. */
  part(slot, geo, bone) { (this.parts[slot] ??= []).push({ geo: finish(geo), bone: this.list.indexOf(this.bones[bone]) }); }
  build(name) {
    const root = new THREE.Group();
    root.name = name;
    root.add(this.list[0]);
    root.updateMatrixWorld(true); // bind inverses must come from the real rest pose
    const skeleton = new THREE.Skeleton(this.list);
    let tris = 0;
    for (const [slot, parts] of Object.entries(this.parts)) {
      const geos = parts.map(({ geo, bone }) => {
        const n = geo.attributes.position.count;
        const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) { si[i * 4] = bone; sw[i * 4] = 1; }
        geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
        geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
        return geo;
      });
      const g = mergeGeometries(geos, false);
      tris += triCount(g);
      let mat = this.mats?.[slot]; // a part with its own texture (the player's face and embroidery)
      if (!mat) { mat = new THREE.MeshStandardMaterial({ vertexColors: true }); mat.name = `mg_${slot}`; }
      const mesh = new THREE.SkinnedMesh(g, mat);
      mesh.name = `${name}_${slot}`;
      Object.assign(mesh.userData, this.meshData?.[slot]);
      root.add(mesh);
      mesh.bind(skeleton);
    }
    return { root, tris: Math.round(tris) };
  }
}

/** Corners that are identical are stored once. Flat shading is kept, because each face has its own normal. */
const weldAll = (root) => root.traverse((m) => { if (m.isSkinnedMesh) m.geometry = mergeVertices(m.geometry, 1e-5); });

/** Sample a pose function into an AnimationClip. pose(t in 0..1) -> {bone: [rx, ry, rz] | {r:[..], p:[..]}} */
function clip(name, dur, rig, pose, fps = 24) {
  const frames = Math.max(2, Math.round(dur * fps));
  const times = Array.from({ length: frames + 1 }, (_, i) => (i / frames) * dur);
  const tracks = {};
  // every clip animates every bone (unlisted bones hold the rest pose), so blending and layering never
  // leave a limb frozen in the pose of a clip that faded out; the body bone always gets a position track
  const poses = times.map((_, i) => pose(i / frames));
  const moved = new Set([rig.list[1].name]);
  for (const p of poses) for (const [k, v] of Object.entries(p)) if (!Array.isArray(v) && v.p) moved.add(k);
  for (const p of poses) {
    for (const b of rig.list) {
      if (b === rig.list[0]) continue;
      const v = p[b.name] ?? rig.sway?.(b.name, times[poses.indexOf(p)] / dur, name, dur, p) ?? [0, 0, 0];
      const r = Array.isArray(v) ? v : v.r ?? [0, 0, 0];
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2], 'XYZ'));
      // T-pose rest: poses are authored for arms hanging down, so fold in the "arm down" rotation D:
      // upper arm = pose * D, lower arm and hand = D^-1 * pose * D (keeps every bend axis the same)
      const fix = rig.armFix?.[b.name];
      if (fix) { if (fix.root) q.multiply(fix.D); else q.premultiply(fix.Dinv).multiply(fix.D); }
      (tracks[`${b.name}.quaternion`] ??= []).push(q.x, q.y, q.z, q.w);
      if (moved.has(b.name)) {
        const o = (!Array.isArray(v) && v.p) || [0, 0, 0];
        (tracks[`${b.name}.position`] ??= []).push(b.position.x + o[0], b.position.y + o[1], b.position.z + o[2]);
      }
    }
  }
  const kt = Object.entries(tracks).map(([k, values]) => (k.endsWith('.quaternion') ? new THREE.QuaternionKeyframeTrack(k, times, values) : new THREE.VectorKeyframeTrack(k, times, values)));
  return new THREE.AnimationClip(name, dur, kt);
}

// ---- Roblox-style people --------------------------------------------------------------------------
// Everything is a block: R6 proportions (square limbs, box torso), flat plastic colours, one bone per
// block so the same animation clips drive every character. Mihao = a bearded ginger cat in the red
// Qing official's jacket and black-and-red hat.

export const GOLD = '#E8B53A';
export const RED = '#A3161A';
export const DARK = '#17171A';
const CREAM = '#FFF3DE';

const HUMAN_BONES = [
  ['root', null, [0, 0, 0]],
  ['hips', 'root', [0, 0.82, 0]],
  ['spine', 'hips', [0, 0.95, 0]],
  ['chest', 'spine', [0, 1.15, 0]],
  ['neck', 'chest', [0, 1.46, 0]],
  ['head', 'neck', [0, 1.48, 0]],
  ['upperArmL', 'chest', [0.445, 1.42, 0]],
  ['forearmL', 'upperArmL', [0.445, 1.12, 0]],
  ['handL', 'forearmL', [0.445, 0.86, 0]],
  ['upperArmR', 'chest', [-0.445, 1.42, 0]],
  ['forearmR', 'upperArmR', [-0.445, 1.12, 0]],
  ['handR', 'forearmR', [-0.445, 0.86, 0]],
  ['thighL', 'hips', [0.155, 0.8, 0]],
  ['shinL', 'thighL', [0.155, 0.44, 0]],
  ['footL', 'shinL', [0.155, 0.08, 0]],
  ['thighR', 'hips', [-0.155, 0.8, 0]],
  ['shinR', 'thighR', [-0.155, 0.44, 0]],
  ['footR', 'shinR', [-0.155, 0.08, 0]],
];

/** A coloured block centred at pos (rig rest pose), bound to a bone. */
const blk = (rig, slot, bone, w, h, d, color, pos, rot = [0, 0, 0]) => rig.part(slot, place(roundedBox(w, h, d, 0.02, { color }), { pos, rot }), bone);
/**
 * Pixel art: a grid of flat quads painted on one face of a block. rows are strings, pal maps a letter to a colour
 * (other letters are left empty, so the block's own colour shows). face: 'z+', 'z-', 'x+' or 'x-'.
 */
function pixelArt(rig, slot, bone, rows, pal, center, px, face = 'z+') {
  const geos = [];
  const H = rows.length, W = rows[0].length;
  rows.forEach((row, j) => [...row].forEach((ch, i) => {
    if (!pal[ch]) return;
    const g = new THREE.PlaneGeometry(px * 1.02, px * 1.02);
    g.translate((i - (W - 1) / 2) * px, ((H - 1) / 2 - j) * px, 0);
    if (face === 'z-') g.rotateY(Math.PI); else if (face === 'x+') g.rotateY(Math.PI / 2); else if (face === 'x-') g.rotateY(-Math.PI / 2);
    g.translate(center[0], center[1], center[2]);
    geos.push(finish(g, col(pal[ch])));
  }));
  if (geos.length) rig.part(slot, mergeGeometries(geos, false), bone);
}
/** Gold cloud scroll (shoulders, skirt, back of the jacket). */
const CLOUD = [
  '...GGG...',
  '.GG...GG.',
  'G..GGG..G',
  'G.G...G.G',
  'G..G.G..G',
  '.G.GGG.G.',
  '..GGGGG..',
];
/** Greek-key border unit (8 wide), tiled along cuffs and the hem. */
const KEY = ['GGGGGGG.', 'G.....G.', 'G.GGG.G.', 'G.G.G.G.', 'G.G.GGG.'];
const keyBand = (cols) => KEY.map((r) => r.repeat(Math.ceil(cols / 8)).slice(0, cols));
/** The gold beast in the rank badge. */
const BEAST = [
  '..G...G..',
  '.GGG.GGG.',
  '.GGGGGGG.',
  '.GG.G.GG.',
  '..GGGGG..',
  '.GGGGGGG.',
  'GGGGGGGGG',
  'GG.GGG.GG',
  '.G.....G.',
];
/** The square rank badge: a double gold frame around the beast (15 x 15). */
function badgeRows() {
  const N = 15;
  const g = Array.from({ length: N }, () => Array(N).fill('.'));
  for (let i = 0; i < N; i++) { g[0][i] = g[N - 1][i] = g[i][0] = g[i][N - 1] = 'G'; }
  for (let i = 2; i < N - 2; i += 2) { g[2][i] = g[N - 3][i] = g[i][2] = g[i][N - 3] = 'G'; }
  BEAST.forEach((row, j) => [...row].forEach((c, i) => { if (c === 'G') g[3 + j][3 + i] = 'G'; }));
  return g.map((r) => r.join(''));
}

/**
 * The tabby's face as pixels (36 x 29 over the 0.62 x 0.5 head front): big black eyes with two glints, a pink nose,
 * forehead and cheek stripes. Plain fur is left empty so the skin colour shows (and can be recoloured).
 */
const FACE_W = 36, FACE_H = 29;
const CAT_PAL = { K: '#0B0B0E', B: '#3A2410', w: '#FFFFFF', P: '#E58C98', M: '#6A2A24', S: '#C45E18', L: '#F8C46E', d: '#B8782E' };
function faceRows() {
  const rows = [];
  for (let j = 0; j < FACE_H; j++) {
    let row = '';
    for (let i = 0; i < FACE_W; i++) {
      const x = ((i + 0.5) / FACE_W) * 2 - 1, y = (j + 0.5) / FACE_H;
      const ax = Math.abs(x);
      let c = '.';
      if (ax > 0.84 && (y < 0.12 || y > 0.88)) { row += '.'; continue; } // the corners are chamfered
      const ex = 0.5 * Math.sign(x || 1), ey = 0.4;
      const dx = (x - ex) / 0.17, dy = (y - ey) / 0.16, d = dx * dx + dy * dy;
      if ((((x - ex + 0.06) / 0.05) ** 2 + ((y - ey + 0.07) / 0.055) ** 2) < 1) c = 'w';
      else if ((((x - ex - 0.07) / 0.03) ** 2 + ((y - ey - 0.07) / 0.03) ** 2) < 1) c = 'w';
      else if (d < 1) c = 'K';
      else if (d < 1.4) c = 'B';
      else if (y >= 0.56 && y < 0.64 && ax < 0.1 * (1 - (y - 0.56) / 0.1)) c = 'P';
      else if (y >= 0.64 && y < 0.72 && ax < 0.035) c = 'M';
      else if (y >= 0.69 && y < 0.74 && ax >= 0.05 && ax < 0.16) c = 'M';
      else {
        for (let k = 0; k < 3; k++) {
          const cx = 0.1 + 0.13 * k + Math.max(0, y - 0.1) * 0.3;
          if (y > 0.08 && y < 0.3 - 0.04 * k && Math.abs(ax - cx) < 0.03) c = 'S';
        }
        if (c === '.' && ((y > 0.5 && y < 0.54) || (y > 0.6 && y < 0.64)) && ax > 0.72 && ax < 0.95) c = 'S';
        if (c === '.' && ax < 0.11 && y > 0.36 && y < 0.52) c = 'L';
        if (c === '.' && (((ax - 0.6) / 0.18) ** 2 + ((y - 0.64) / 0.12) ** 2) < 1) c = 'L';
        for (const [px, py] of [[0.2, 0.67], [0.3, 0.7], [0.24, 0.74]]) if (c === '.' && ((ax - px) ** 2 + (y - py) ** 2) < 0.0006) c = 'd';
      }
      row += c;
    }
    rows.push(row);
  }
  return rows;
}
const CAT_FACE = faceRows();

/** A flat octagonal disc facing +z (badges, buttons). */
const disc = (rig, slot, bone, r, thick, color, pos) => rig.part(slot, place(cyl(r, r, thick, { segs: 8, color }), { pos, rot: [Math.PI / 2, 0, 0] }), bone);

/** Camouflage: blotches of three shades laid on a face of a block (n patches within w x h). */
function camo(rig, slot, bone, center, w, h, z, colors, seed, n = 7) {
  const r = rand(seed);
  for (let i = 0; i < n; i++) {
    const pw = w * (0.18 + r() * 0.22), ph = h * (0.14 + r() * 0.2);
    const x = center[0] + (r() - 0.5) * (w - pw), y = center[1] + (r() - 0.5) * (h - ph);
    // each patch sits a hair above the one before, so overlapping patches never z-fight
    blk(rig, slot, bone, pw, ph, 0.012, colors[i % colors.length], [x, y, z + Math.sign(z) * i * 0.0025]);
  }
}

/**
 * One Roblox avatar. tint: white vertex colours on the parts the player can recolour (skin, hair, shirt, pants,
 * boots); their default colour travels in mesh.userData.defColor.
 */
function robloxHuman(o) {
  const { name, tint = false, head = 'cat', hat = 'official' } = o;
  const rig = new Rig(HUMAN_BONES);
  const C = (c) => (tint ? '#ffffff' : c);
  const skin = C(o.skin), hair = C(o.hair), shirt = C(o.shirt), pants = C(o.pants), boots = C(o.boots);
  const cuff = o.trim ?? GOLD;

  const official = !o.camo && o.badge !== false;
  for (const [s, side] of [[1, 'L'], [-1, 'R']]) {
    const x = 0.155 * s, ax = 0.445 * s;
    // legs: thigh block and shin block (knee bones), chunky black boots
    blk(rig, 'pants', `thigh${side}`, 0.3, 0.37, 0.3, pants, [x, 0.615, 0]);
    blk(rig, 'pants', `shin${side}`, 0.3, 0.33, 0.3, pants, [x, 0.275, 0]);
    if (!official) blk(rig, 'plain', `shin${side}`, 0.305, 0.05, 0.305, cuff, [x, 0.15, 0]);
    blk(rig, 'boots', `foot${side}`, 0.33, 0.14, 0.42, boots, [x, 0.07, 0.05]);
    // arms: red upper sleeve, gold forearm (official) or shirt-coloured forearm with a cuff, paw or glove for the hand
    blk(rig, 'shirt', `upperArm${side}`, 0.25, 0.34, 0.25, shirt, [ax, 1.29, 0]);
    if (official) blk(rig, 'plain', `forearm${side}`, 0.25, 0.24, 0.25, cuff, [ax, 1.01, 0]);
    else {
      blk(rig, 'shirt', `forearm${side}`, 0.25, 0.23, 0.25, shirt, [ax, 1.015, 0]);
      blk(rig, 'plain', `forearm${side}`, 0.27, 0.06, 0.27, o.cuffDark ?? DARK, [ax, 0.9, 0]);
      blk(rig, 'plain', `forearm${side}`, 0.275, 0.014, 0.275, cuff, [ax, 0.93, 0]);
    }
    blk(rig, `hand${side}`, `hand${side}`, 0.22, 0.13, 0.22, o.handsAreSkin === false ? o.hands : skin, [ax, 0.825, 0]);
    if (official) {
      const red = o.keyColor ?? '#A3161A';
      pixelArt(rig, 'plain', `upperArm${side}`, CLOUD, { G: cuff }, [ax, 1.3, 0.1265], 0.026, 'z+');
      pixelArt(rig, 'plain', `upperArm${side}`, CLOUD, { G: cuff }, [ax + 0.1265 * s, 1.3, 0], 0.026, s > 0 ? 'x+' : 'x-');
      pixelArt(rig, 'plain', `forearm${side}`, keyBand(11), { G: red }, [ax, 1.0, 0.1265], 0.0225, 'z+');
      pixelArt(rig, 'plain', `forearm${side}`, keyBand(11), { G: red }, [ax + 0.1265 * s, 1.0, 0], 0.0225, s > 0 ? 'x+' : 'x-');
    }
  }
  // torso: chest, long jacket skirt, pelvis
  blk(rig, 'shirt', 'chest', 0.64, 0.38, 0.34, shirt, [0, 1.27, 0]);
  blk(rig, 'shirt', 'spine', 0.68, 0.44, 0.38, shirt, [0, 0.88, 0]);
  blk(rig, 'pants', 'hips', 0.62, 0.12, 0.32, pants, [0, 0.76, 0]);
  if (o.camo) {
    camo(rig, 'plain', 'chest', [0, 1.27], 0.6, 0.34, 0.176, o.camo, 5, 8);
    camo(rig, 'plain', 'chest', [0, 1.27], 0.6, 0.34, -0.176, o.camo, 6, 6);
    camo(rig, 'plain', 'spine', [0, 0.9], 0.64, 0.36, 0.196, o.camo, 7, 6);
    for (const [s, side] of [[1, 'L'], [-1, 'R']]) { camo(rig, 'plain', `thigh${side}`, [0.155 * s, 0.615], 0.27, 0.33, 0.156, o.camo, 8 + side.length, 4); camo(rig, 'plain', `shin${side}`, [0.155 * s, 0.275], 0.27, 0.3, 0.156, o.camo, 12 + s, 4); }
    blk(rig, 'plain', 'spine', 0.69, 0.045, 0.39, cuff, [0, 1.09, 0]);
  } else if (official) {
    // the rank badge on the chest, cloud scrolls on the skirt, a gold hem with a Greek-key band, gold seam
    pixelArt(rig, 'plain', 'chest', badgeRows(), { G: cuff }, [0, 1.275, 0.1765], 0.02, 'z+');
    for (const s of [1, -1]) pixelArt(rig, 'plain', 'spine', CLOUD, { G: cuff }, [0.17 * s, 0.94, 0.1965], 0.027, 'z+');
    pixelArt(rig, 'plain', 'chest', CLOUD, { G: cuff }, [0, 1.27, -0.1765], 0.04, 'z-');
    pixelArt(rig, 'plain', 'spine', CLOUD, { G: cuff }, [0, 0.9, -0.1965], 0.04, 'z-');
    blk(rig, 'plain', 'spine', 0.695, 0.1, 0.395, cuff, [0, 0.72, 0]);
    pixelArt(rig, 'plain', 'spine', keyBand(28), { G: o.keyColor ?? '#A3161A' }, [0, 0.72, 0.2], 0.0235, 'z+');
    blk(rig, 'plain', 'spine', 0.69, 0.016, 0.39, cuff, [0, 1.1, 0]);
  }
  // stand collar (white, gold piping)
  blk(rig, 'plain', 'neck', 0.34, 0.08, 0.27, o.collar ?? '#F4F0E8', [0, 1.495, 0]);
  blk(rig, 'plain', 'neck', 0.345, 0.012, 0.275, cuff, [0, 1.46, 0]);

  const HY = 1.46; // bottom of the head block
  if (head === 'cat') {
    // ---- the tabby: a chamfered head (three overlapping blocks), painted face, pointed ears, white beard
    blk(rig, 'skin', 'head', 0.62, 0.42, 0.56, skin, [0, HY + 0.25, 0]);
    blk(rig, 'skin', 'head', 0.52, 0.5, 0.56, skin, [0, HY + 0.25, 0]);
    blk(rig, 'skin', 'head', 0.62, 0.5, 0.48, skin, [0, HY + 0.25, 0]);
    pixelArt(rig, 'face', 'head', CAT_FACE, CAT_PAL, [0, HY + 0.25, 0.2815], 0.62 / FACE_W, 'z+');
    for (const s of [1, -1]) {
      // ears: flattened pyramids with a pink inside and white tuft
      const ear = (w, h, color, pos, slot) => { const g = cone(w, h, { segs: 4, color }); g.rotateY(Math.PI / 4); g.scale(1, 1, 0.5); rig.part(slot, place(g, { pos, rot: [0, 0, -0.28 * s] }), 'head'); };
      ear(0.15, 0.27, skin, [0.27 * s, HY + 0.62, -0.01], 'skin');
      ear(0.09, 0.17, '#F2A3AE', [0.265 * s, HY + 0.6, 0.03], 'face');
      ear(0.05, 0.1, '#FFFFFF', [0.255 * s, HY + 0.57, 0.045], 'face');
      // whiskers: thin white lines out from the muzzle
      for (let k = 0; k < 3; k++) blk(rig, 'face', 'head', 0.3, 0.006, 0.006, '#FFFFFF', [0.4 * s, HY + 0.17 + (k - 1) * 0.04, 0.29], [0, 0, (k - 1) * 0.13 * s]);
    }
    if (o.spikes) {
      const sp = rand(41);
      for (let k = 0; k < 7; k++) {
        const x = (k - 3) * 0.075, hgt = 0.2 + sp() * 0.16;
        rig.part('hair', place(cone(0.05, hgt, { segs: 4, color: k % 2 ? '#9FE6FF' : '#66C6F5' }), { pos: [x, HY + 0.5 + hgt / 2 - 0.02, -0.02 + sp() * 0.1], rot: [0, 0, -x * 0.9] }), 'head');
      }
    }
    if (o.bow) {
      blk(rig, 'plain', 'head', 0.12, 0.1, 0.06, o.bow, [-0.2, HY + 0.52, 0.12], [0, 0, 0.5]);
      blk(rig, 'plain', 'head', 0.12, 0.1, 0.06, o.bow, [-0.04, HY + 0.52, 0.12], [0, 0, -0.5]);
      blk(rig, 'plain', 'head', 0.06, 0.06, 0.07, '#FFD24A', [-0.12, HY + 0.52, 0.12]);
    }
    blk(rig, 'face', 'head', 0.2, 0.1, 0.04, '#FFF1DC', [0, HY + 0.145, 0.295]); // white muzzle
    blk(rig, 'face', 'head', 0.07, 0.04, 0.03, '#E98A93', [0, HY + 0.18, 0.325]); // nose nub
    // the long white beard: tapering layers lying on the chest
    const layers = [0.34, 0.28, 0.21, 0.14, 0.07];
    layers.forEach((w, k) => blk(rig, 'hair', 'chest', w, 0.092, 0.05, hair, [0, 1.435 - k * 0.09, 0.245 - k * 0.006]));
  } else if (head === 'camo') {
    // ---- the "any last words?" guy: camo-blue head, one grim eye, ice-blue spikes
    blk(rig, 'skin', 'head', 0.54, 0.54, 0.54, skin, [0, HY + 0.27, 0]);
    camo(rig, 'plain', 'head', [0, HY + 0.27], 0.5, 0.5, 0.276, o.headCamo, 21, 7);
    camo(rig, 'plain', 'head', [0, HY + 0.27], 0.5, 0.5, -0.276, o.headCamo, 22, 5);
    for (const s of [1, -1]) {
      blk(rig, 'face', 'head', 0.13, 0.07, 0.02, '#F7FBFF', [0.12 * s, HY + 0.32, 0.28]);
      blk(rig, 'face', 'head', 0.05, 0.07, 0.022, '#0B0B10', [0.135 * s, HY + 0.32, 0.292]);
      blk(rig, 'brows', 'head', 0.16, 0.035, 0.02, '#10131c', [0.12 * s, HY + 0.4, 0.282], [0, 0, 0.35 * s]);
    }
    blk(rig, 'face', 'head', 0.2, 0.025, 0.02, '#10131c', [0, HY + 0.14, 0.28]);
    const sp = rand(31);
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * TAU, rr = k % 3 === 0 ? 0 : 0.17;
      const hgt = 0.2 + sp() * 0.2;
      rig.part('hair', place(cone(0.075, hgt, { segs: 4, color: k % 2 ? '#9FE6FF' : '#66C6F5' }), { pos: [Math.sin(a) * rr, HY + 0.54 + hgt / 2, Math.cos(a) * rr * 0.9], rot: [Math.cos(a) * rr * 1.2, 0, -Math.sin(a) * rr * 1.2] }), 'head');
    }
  } else if (head === 'girl') {
    // ---- Penny: peach face, red hair block with a bun, pink cat-ear headband, a big blocky smile
    blk(rig, 'skin', 'head', 0.58, 0.52, 0.54, skin, [0, HY + 0.26, 0]);
    blk(rig, 'hair', 'head', 0.64, 0.2, 0.6, hair, [0, HY + 0.5, -0.02]);
    blk(rig, 'hair', 'head', 0.64, 0.46, 0.14, hair, [0, HY + 0.26, -0.27]);
    for (const s of [1, -1]) {
      blk(rig, 'hair', 'head', 0.07, 0.34, 0.5, hair, [0.31 * s, HY + 0.28, -0.02]);
      blk(rig, 'face', 'head', 0.07, 0.1, 0.02, '#1B1A22', [0.13 * s, HY + 0.3, 0.272]);
      blk(rig, 'face', 'head', 0.025, 0.03, 0.022, '#FFFFFF', [0.12 * s, HY + 0.33, 0.28]);
      blk(rig, 'face', 'head', 0.09, 0.05, 0.012, '#F59AAE', [0.2 * s, HY + 0.19, 0.272]);
      blk(rig, 'plain', 'head', 0.15, 0.2, 0.06, '#F25C9C', [0.2 * s, HY + 0.68, 0], [0, 0, -0.25 * s]);
      blk(rig, 'plain', 'head', 0.08, 0.12, 0.065, '#FFC2DD', [0.2 * s, HY + 0.68, 0.005], [0, 0, -0.25 * s]);
    }
    blk(rig, 'plain', 'head', 0.62, 0.05, 0.58, '#F25C9C', [0, HY + 0.6, 0]);
    blk(rig, 'hair', 'head', 0.24, 0.24, 0.24, hair, [0, HY + 0.7, -0.22]);
    blk(rig, 'face', 'head', 0.16, 0.025, 0.02, '#9B2D45', [0, HY + 0.13, 0.272]);
    blk(rig, 'face', 'head', 0.03, 0.03, 0.02, '#9B2D45', [-0.095, HY + 0.15, 0.272]);
    blk(rig, 'face', 'head', 0.03, 0.03, 0.02, '#9B2D45', [0.095, HY + 0.15, 0.272]);
  }

  if (hat === 'official') officialHat(rig);
  return rig;
}

/** Build a rig into a model and record the default colour of each recolourable part (the avatar editor tints white parts). */
function finishModel(rig, name, defaults = null) {
  const b = rig.build(name);
  weldAll(b.root);
  b.root.traverse((m) => {
    if (!m.isMesh) return;
    // hat_cap, fit_shirt_ghost__main, beard_long, ... (the client switches these by name)
    if (['hat_', 'fit_', 'beard_'].some((k) => m.name.startsWith(`${name}_${k}`))) m.name = m.name.slice(name.length + 1);
    const slot = m.name.replace(`${name}_`, '');
    if (defaults?.[slot]) m.userData.defColor = defaults[slot];
  });
  return b;
}

/** The Qing official's hat: black band with a gold badge, red tiered cap, red knob and tassel. */
function officialHat(rig, slot = 'hat', bone = 'head') {
  const B = blk;
  const y = 1.96; // top of the head block
  B(rig, slot, bone, 0.64, 0.045, 0.58, DARK, [0, y + 0.02, 0]);
  B(rig, slot, bone, 0.52, 0.09, 0.46, DARK, [0, y + 0.087, 0]);
  B(rig, slot, bone, 0.42, 0.08, 0.36, DARK, [0, y + 0.17, 0]);
  B(rig, slot, bone, 0.3, 0.06, 0.26, DARK, [0, y + 0.24, 0]);
  rig.part(slot, place(cyl(0.07, 0.07, 0.014, { segs: 8, color: GOLD }), { pos: [0, y + 0.09, 0.2345], rot: [Math.PI / 2, 0, 0] }), bone);
  rig.part(slot, place(cyl(0.05, 0.05, 0.016, { segs: 8, color: DARK }), { pos: [0, y + 0.09, 0.2355], rot: [Math.PI / 2, 0, 0] }), bone);
  B(rig, slot, bone, 0.05, 0.05, 0.018, GOLD, [0, y + 0.09, 0.238]);
  B(rig, slot, bone, 0.07, 0.07, 0.07, '#C8202A', [0, y + 0.3, 0]);
  B(rig, slot, bone, 0.04, 0.04, 0.04, '#C8202A', [0, y + 0.35, 0]);
  // the red tassel hangs from the left side of the hat
  B(rig, slot, bone, 0.04, 0.04, 0.04, GOLD, [0.35, y + 0.03, 0.04]);
  B(rig, slot, bone, 0.05, 0.18, 0.04, RED, [0.35, y - 0.08, 0.04]);
  B(rig, slot, bone, 0.09, 0.09, 0.05, RED, [0.35, y - 0.2, 0.04]);
}

/** Extra hats for the avatar editor: white (tinted by the item colour) with a few fixed detail colours. */
function extraHats(rig) {
  const W = '#ffffff', y = 1.46 + 0.5;
  const B = (slot, ...a) => blk(rig, slot, 'head', ...a);
  // cap
  B('hat_cap', 0.6, 0.15, 0.54, W, [0, y + 0.06, 0]);
  B('hat_cap', 0.5, 0.04, 0.3, W, [0, y - 0.01, 0.38]);
  B('hat_cap', 0.07, 0.04, 0.07, W, [0, y + 0.15, 0]);
  // beanie with a pom
  B('hat_beanie', 0.64, 0.17, 0.58, W, [0, y + 0.06, 0]);
  B('hat_beanie', 0.52, 0.1, 0.46, W, [0, y + 0.19, 0]);
  B('hat_beanie', 0.14, 0.14, 0.14, W, [0, y + 0.32, 0]);
  // bucket hat
  B('hat_bucket', 0.9, 0.04, 0.84, W, [0, y + 0.0, 0]);
  B('hat_bucket', 0.58, 0.2, 0.52, W, [0, y + 0.11, 0]);
  // ranch hat
  B('hat_cowboy', 1.02, 0.04, 0.86, W, [0, y + 0.0, 0]);
  B('hat_cowboy', 0.52, 0.24, 0.48, W, [0, y + 0.13, 0]);
  B('hat_cowboy', 0.535, 0.06, 0.495, '#3a2a1a', [0, y + 0.06, 0]);
  B('hat_cowboy', 0.12, 0.06, 0.5, W, [0.45, y + 0.04, 0], [0, 0, 0.5]);
  B('hat_cowboy', 0.12, 0.06, 0.5, W, [-0.45, y + 0.04, 0], [0, 0, -0.5]);
  // top hat
  B('hat_tophat', 0.72, 0.04, 0.66, W, [0, y + 0.0, 0]);
  B('hat_tophat', 0.46, 0.46, 0.42, W, [0, y + 0.25, 0]);
  B('hat_tophat', 0.475, 0.07, 0.4455, '#E04A4A', [0, y + 0.06, 0]);
  // crown with spikes and gems
  B('hat_crown', 0.58, 0.14, 0.52, W, [0, y + 0.06, 0]);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * TAU;
    B('hat_crown', 0.09, 0.16, 0.09, W, [Math.sin(a) * 0.23, y + 0.21, Math.cos(a) * 0.2]);
    B('hat_crown', 0.06, 0.06, 0.06, k % 2 ? '#E0304A' : '#3A8AFF', [Math.sin(a) * 0.23, y + 0.31, Math.cos(a) * 0.2]);
  }
  // sunflower sun hat
  B('hat_sunflower', 0.96, 0.04, 0.9, W, [0, y + 0.0, 0]);
  B('hat_sunflower', 0.56, 0.14, 0.5, W, [0, y + 0.08, 0]);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    rig.part('hat_sunflower', place(roundedBox(0.07, 0.14, 0.03, 0.01, { color: k % 2 ? '#FFC233' : '#FFD84A' }), { pos: [0.18 + Math.sin(a) * 0.12, y + 0.18 + Math.cos(a) * 0.12, 0.27], rot: [0, 0, -a] }), 'head');
  }
  B('hat_sunflower', 0.11, 0.11, 0.05, '#5A3A1A', [0.18, y + 0.18, 0.285]);
}

/** Leg proportions and native gait speeds of this body (the client scales playback to ground speed). */
export const LEG_DEFAULT = { thigh: 0.36, shin: 0.36, ankle: 0.08, hip: 0.8 };

/** The player: a Mihao. Mesh names are what the avatar editor recolours (farmer_skin, farmer_shirt, hat_cap, ...). */
export function buildFarmer(headImage) {
  // no default skin colour: the head shows its own photo texture until the player picks a fur colour
  const D = { hair: '#F7F3EA', shirt: RED, pants: RED, boots: '#F4EEE2', handL: '#F4EEE2', handR: '#F4EEE2' };
  const rig = new Rig([...HUMAN_BONES, ...HAIR_BONES]);
  rig.sway = hairSway;
  mihaoPlayer(rig, D, () => '#ffffff', headImage);
  officialHat(rig);
  extraHats(rig);
  for (const style of BEARD_STYLES) D[`beard_${style}`] = D.hair;
  const b = finishModel(rig, 'farmer', D);
  const k = (LEG_DEFAULT.thigh + LEG_DEFAULT.shin) / 0.81;
  const walkStride = 2.0 * k, runStride = 3.2 * k;
  const animations = humanClips(rig, LEG_DEFAULT, {
    walk: { stride: walkStride, dur: walkStride / 4.4, duty: 0.56, land: 0.45 * k, lift: 0.14 * k, crouch: 0.06 * k, lean: 0.03, twist: 0.04, arm: 0.85, elbow: 0.04, elbowFwd: 0.05 },
    run: { stride: runStride, dur: runStride / 7.8, land: 0.32 * k, lift: 0.34 * k, crouch: 0.09 * k, arm: 1.1, elbow: 0.1, elbowFwd: 0.1 },
  });
  return { id: 'farmer', root: b.root, animations, tris: b.tris, info: { tris: b.tris } };
}

/**
 * The shopkeepers are all Mihao: the same ginger cat with the long white beard, each in their own jacket.
 * (File ids stay mole / goat / tinkerer / petkeeper because the game's shop code looks them up by those names.)
 */
function mihaoVendor(name, o) {
  const rig = robloxHuman({ name, head: 'cat', skin: '#E9A23E', hair: '#F7F1E6', boots: '#16161A', pants: '#1C2240', ...o });
  const b = finishModel(rig, name);
  return { id: name, root: b.root, animations: humanClips(rig), tris: b.tris };
}
/** Mo, the seed seller: jade jacket and the official hat. */
const mole = () => mihaoVendor('mole', { shirt: '#2E8B57', keyColor: '#1F6B40', collar: '#F4F0E8' });
/** The market seller: deep-blue jacket with gold trim. */
const goat = () => mihaoVendor('goat', { shirt: '#2A4FA0', keyColor: '#1B3578' });
/** Penny Paws, the pet keeper: pink jacket, a big bow instead of a hat. */
const petkeeper = () => mihaoVendor('petkeeper', { shirt: '#E0527F', keyColor: '#A92A55', hat: null, bow: '#FF8FB3' });
/** Tinker Tess, the gadget seller: blue camouflage and ice-blue spikes, like the "any last words?" guy. */
const tinkerer = () => mihaoVendor('tinkerer', {
  hat: null, spikes: true, shirt: '#25397E', pants: '#1D2C66', camo: ['#3F6FC8', '#0F1B40', '#7FB2F2'], trim: '#F5CD30', collar: '#16224E', badge: false,
});


/**
 * Human animations driven by where the feet should be (two-bone leg IK in the side plane):
 * - walk/run: each foot is planted on the ground and slides back exactly as fast as the body moves (no
 *   skating), then lifts in a smooth arc to the next step; heel strikes toe-up, heel peels off before
 *   toe-off. Hip height follows from the legs (an inverted pendulum), so the body bobs naturally.
 * - plant/harvest: feet stay planted while the hips sink into a real squat; the knees bend to match.
 * Clips are in place; the client scales playback by ground speed (native speeds in NATIVE_SPEED).
 */
let THIGH = 0.4, SHIN = 0.41, ANKLE = 0.09, HIP_JOINT = 0.9; // rest pose: thigh joint 0.9 m, knee 0.5, ankle 0.09
function setLegs(d) { ({ thigh: THIGH, shin: SHIN, ankle: ANKLE, hip: HIP_JOINT } = d); }
const clampN = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (x) => { const c = clampN(x, 0, 1); return c * c * (3 - 2 * c); };
const env = (t, a, b, c, d) => (t < a || t > d ? 0 : t < b ? smooth((t - a) / (b - a)) : t > c ? 1 - smooth((t - c) / (d - c)) : 1);

/** Thigh (world pitch, 0 = straight down, negative = forward) and knee bend for an ankle target. */
function legIK(hy, hz, fy, fz) {
  let dz = fz - hz, dy = hy - fy;
  let D = Math.hypot(dz, dy);
  const max = (THIGH + SHIN) * 0.998;
  if (D > max) { dz *= max / D; dy *= max / D; D = max; }
  D = Math.max(D, 0.15);
  const line = -Math.atan2(dz, dy);
  const a = Math.acos(clampN((THIGH * THIGH + D * D - SHIN * SHIN) / (2 * THIGH * D), -1, 1));
  const b = Math.acos(clampN((THIGH * THIGH + SHIN * SHIN - D * D) / (2 * THIGH * SHIN), -1, 1));
  return { thigh: line - a, knee: Math.PI - b };
}

/** Write leg bone rotations into a pose. legs: {L: {y, z, pitch}, R: ...}; hips: {y, z, pitch, yaw, roll}. */
function solveLegs(pose, hips, legs) {
  for (const side of ['L', 'R']) {
    const f = legs[side];
    const { thigh, knee } = legIK(HIP_JOINT + hips.y, hips.z, f.y, f.z);
    pose[`thigh${side}`] = [thigh - hips.pitch, 0, -hips.roll * 0.8];
    pose[`shin${side}`] = [knee, 0, 0];
    pose[`foot${side}`] = [(f.pitch ?? 0) - thigh - knee, 0, 0];
  }
  pose.hips = { r: [hips.pitch, hips.yaw ?? 0, hips.roll ?? 0], p: [hips.x ?? 0, hips.y, hips.z] };
}

/** One foot through a gait cycle (phase 0 = heel strike). Returns ankle {y, z, pitch} relative to the hips. */
function footPath(ph, { stride, duty, lift, land, heel, toe }) {
  const stance = stride * duty; // distance the planted foot travels back relative to the body
  if (ph < duty) {
    const k = ph / duty;
    const z = land - stance * k;
    // heel strike (toe up) rolls flat, then the heel peels up before push-off
    const strike = -heel * (1 - smooth(k / 0.18));
    const peel = toe * smooth((k - 0.62) / 0.38) ** 1.6;
    return { y: ANKLE + 0.13 * Math.sin(Math.max(0, peel)) + 0.05 * Math.sin(-Math.min(0, strike)), z, pitch: strike + peel };
  }
  const u = (ph - duty) / (1 - duty);
  const s = u - Math.sin(u * Math.PI * 2) / (Math.PI * 2); // eased: zero speed relative to the body at both ends... blended below
  const lin = u;
  const e = 0.65 * s + 0.35 * lin; // keep some speed at lift-off/landing so the foot does not stall
  const z = land - stance + stance * e;
  const y = ANKLE + lift * Math.sin(Math.PI * Math.min(1, u * 1.08)) ** 0.9 + 0.13 * Math.sin(toe) * (1 - smooth(u / 0.3));
  const pitch = toe * (1 - smooth(u / 0.45)) - heel * smooth((u - 0.55) / 0.45);
  return { y, z, pitch };
}

function gaitClip(rig, name, o) {
  // hip height: as high as the planted legs allow (inverted pendulum), smoothed around the cycle
  const N = 96;
  const raw = Array.from({ length: N }, (_, i) => {
    const t = i / N;
    let h = HIP_JOINT - o.crouch;
    for (const ph of [t, (t + 0.5) % 1]) {
      const f = footPath(ph, o);
      if (ph < o.duty || f.y < ANKLE + 0.02) h = Math.min(h, f.y + Math.sqrt(Math.max(0, ((THIGH + SHIN) * o.reach) ** 2 - f.z * f.z)));
    }
    return h;
  });
  const sm = raw.map((_, i) => { let s = 0, w = 0; for (let k = -6; k <= 6; k++) { const ww = 7 - Math.abs(k); s += raw[(i + k + N) % N] * ww; w += ww; } return s / w; });
  const hipY = (t) => {
    const x = t * N, i = Math.floor(x) % N, f = x - Math.floor(x);
    const base = sm[i] * (1 - f) + sm[(i + 1) % N] * f;
    return base + (o.flight ? o.flight * Math.max(0, Math.sin(((t - o.duty) / (0.5 - o.duty)) * Math.PI) * (t % 0.5 > o.duty ? 1 : 0)) : 0);
  };
  return clip(name, o.dur, rig, (t) => {
    const pose = {};
    const L = footPath(t, o), R = footPath((t + 0.5) % 1, o);
    const c = Math.cos(t * Math.PI * 2), s = Math.sin(t * Math.PI * 2);
    const mid = Math.cos((t - o.duty / 2) * Math.PI * 2); // +1 while the left leg carries the weight
    const hips = { y: hipY(t) - HIP_JOINT, z: 0, pitch: o.lean * 0.5, yaw: -o.twist * c, roll: o.drop * mid, x: o.sway * mid };
    solveLegs(pose, hips, { L, R });
    pose.spine = [o.lean * 0.3, o.twist * c * 0.45, -o.drop * mid * 0.6];
    pose.chest = [o.lean * 0.2 + o.breathe * Math.sin(t * Math.PI * 4), o.twist * c * 0.9, 0];
    pose.neck = [-o.lean * 0.4, 0, 0];
    pose.head = [-o.lean * 0.3 + 0.025 * Math.cos(t * Math.PI * 4), -o.twist * c * 0.35, o.drop * mid * 0.3];
    for (const [side, sg] of [['L', 1], ['R', -1]]) {
      const swing = sg * o.arm * c; // the arm swings forward with the opposite leg
      const fwd = Math.max(0, -swing / o.arm);
      pose[`upperArm${side}`] = [swing - o.armBack, -sg * 0.06, sg * (o.armOut + 0.03 * Math.abs(s))];
      pose[`forearm${side}`] = [-(o.elbow + o.elbowFwd * fwd), 0, 0];
      pose[`hand${side}`] = [0.1, 0, sg * 0.1];
    }
    return pose;
  });
}

/** A crouch with both feet planted (used by idle, plant, harvest, jump). */
function planted(pose, hips, feet) {
  solveLegs(pose, { yaw: 0, roll: 0, x: 0, ...hips }, {
    L: { y: ANKLE + (feet.Ly ?? 0), z: feet.Lz ?? 0.04, pitch: feet.Lp ?? 0 },
    R: { y: ANKLE + (feet.Ry ?? 0), z: feet.Rz ?? -0.04, pitch: feet.Rp ?? 0 },
  });
  return pose;
}

/** Animations for a human rig. legs: leg proportions; gaits: optional stride/speed overrides. */
export function humanClips(rig, legs = LEG_DEFAULT, gaits = {}) {
  setLegs(legs);
  try { return humanClipsInner(rig, gaits); } finally { setLegs(LEG_DEFAULT); }
}
function humanClipsInner(rig, G) {
  const W = (t) => Math.sin(t * Math.PI * 2);
  return [
    clip('idle', 4, rig, (t) => planted({
      spine: [0.01, 0, W(t * 0.5) * 0.012], chest: [0.02 + W(t * 2) * 0.018, 0, 0], neck: [0, 0, 0],
      head: [W(t + 0.2) * 0.025, Math.sin(t * Math.PI * 2) * 0.1, W(t * 0.5) * 0.02],
      upperArmL: [0.02 + W(t * 2) * 0.02, -0.05, 0.1], upperArmR: [0.02 - W(t * 2) * 0.02, 0.05, -0.1],
      forearmL: [-0.16, 0, 0], forearmR: [-0.16, 0, 0], handL: [0.1, 0, 0.08], handR: [0.1, 0, -0.08],
    }, { y: -0.012 + W(t * 2) * 0.004, z: 0, pitch: 0, roll: W(t) * 0.02, x: W(t) * 0.014 }, { Lz: 0.05, Rz: -0.04 })),
    // walk: 1.6 m per cycle in 0.5 s (native 3.2 m/s), a brisk stride
    gaitClip(rig, 'walk', { ...{ dur: 0.5, stride: 1.6, duty: 0.58, lift: 0.12, land: 0.4, heel: 0.32, toe: 0.7, crouch: 0.05, reach: 0.985, lean: 0.06, twist: 0.1, drop: 0.045, sway: 0.025, arm: 0.42, armBack: 0.03, armOut: 0.08, elbow: 0.2, elbowFwd: 0.35, breathe: 0.01, flight: 0 }, ...G.walk }),
    // run: 2.4 m per cycle in 0.39 s (native 6.2 m/s), short ground contact and a flight phase
    gaitClip(rig, 'run', { ...{ dur: 0.39, stride: 2.4, duty: 0.34, lift: 0.3, land: 0.28, heel: 0.12, toe: 0.9, crouch: 0.08, reach: 0.97, lean: 0.28, twist: 0.18, drop: 0.03, sway: 0.015, arm: 0.75, armBack: 0.1, armOut: 0.12, elbow: 1.35, elbowFwd: 0.25, breathe: 0.015, flight: 0.035 }, ...G.run }),
    clip('jump', 0.8, rig, (t) => {
      const squat = env(t, 0, 0.12, 0.14, 0.3) * 0.18 + env(t, 0.75, 0.85, 0.88, 1) * 0.1;
      const tuck = env(t, 0.25, 0.4, 0.55, 0.75);
      const pose = planted({
        spine: [0.15 * squat * 4, 0, 0], chest: [-0.1 * tuck, 0, 0], head: [-0.1 * tuck, 0, 0],
        upperArmL: [-0.4 - 1.6 * tuck + 0.6 * squat * 4, 0, 0.25 + 0.25 * tuck], upperArmR: [-0.4 - 1.6 * tuck + 0.6 * squat * 4, 0, -0.25 - 0.25 * tuck],
        forearmL: [-0.5, 0, 0], forearmR: [-0.5, 0, 0],
      }, { y: -squat, z: -0.03 * squat * 4, pitch: 0.2 * squat * 4 }, { Ly: 0.22 * tuck, Ry: 0.16 * tuck, Lz: 0.08 + 0.08 * tuck, Rz: -0.04 + 0.04 * tuck, Lp: 0.35 * tuck, Rp: 0.35 * tuck });
      return pose;
    }),
    // plant: kneel down, dig with the right hand, drop the seed, pat the soil with both hands, stand up
    clip('plant', 1.7, rig, (t) => {
      const e = env(t, 0, 0.2, 0.84, 1);
      const dig = env(t, 0.2, 0.26, 0.5, 0.56), drop = env(t, 0.54, 0.6, 0.64, 0.7), pat = env(t, 0.68, 0.72, 0.8, 0.85);
      const pose = {
        spine: [0.42 * e, 0, 0], chest: [0.18 * e, 0, 0], neck: [0.1 * e, 0, 0], head: [0.15 * e, 0, 0],
        upperArmR: [-0.85 * e - 0.28 * dig * (0.5 + 0.5 * Math.sin(t * Math.PI * 22)) - 0.2 * pat * (0.5 + 0.5 * Math.sin(t * Math.PI * 30)), 0, -0.12],
        forearmR: [-0.35 * e - 0.4 * drop, 0, 0], handR: [0.4 * dig - 0.5 * drop, 0, 0],
        upperArmL: [-0.45 * e - 0.45 * pat - 0.2 * pat * (0.5 + 0.5 * Math.sin(t * Math.PI * 30 + 1.5)), 0, 0.18], forearmL: [-0.9 * e + 0.45 * pat, 0, 0], handL: [0.3 * pat, 0, 0],
      };
      return planted(pose, { y: -0.4 * e, z: -0.08 * e, pitch: 0.15 * e }, { Lz: 0.06 + 0.16 * e, Rz: -0.04 - 0.14 * e, Rp: 0.9 * e, Ry: 0.02 * e });
    }),
    clip('water', 1.5, rig, (t) => {
      const e = env(t, 0, 0.15, 0.85, 1);
      const pour = env(t, 0.2, 0.32, 0.72, 0.82);
      return planted({
        spine: [0.1 * e, -0.06 * e, 0], chest: [0.06 * e, -0.06 * e, 0], head: [0.28 * e, -0.1 * e, 0],
        upperArmR: [-1.0 * e, 0, -0.18 * e], forearmR: [-0.35 * e, 0, 0], handR: [0.15 * e + pour * (0.55 + 0.12 * Math.sin(t * Math.PI * 16)), 0, 0],
        upperArmL: [-0.15 * e, 0, 0.12], forearmL: [-0.3 * e, 0, 0],
      }, { y: -0.03 * e, z: 0, pitch: 0.05 * e }, { Lz: 0.12, Rz: -0.08 });
    }),
    // harvest: squat and reach with both hands, pull the crop up, lift it over the shoulder into the basket
    clip('harvest', 1.3, rig, (t) => {
      const down = env(t, 0, 0.22, 0.38, 0.55);
      const pull = env(t, 0.36, 0.48, 0.6, 0.72);
      const toss = env(t, 0.58, 0.7, 0.78, 0.92);
      const tug = env(t, 0.33, 0.36, 0.42, 0.46) * Math.sin(t * Math.PI * 40) * 0.06;
      return planted({
        spine: [0.5 * down + 0.1 * pull - 0.12 * toss, -0.2 * toss, 0], chest: [0.15 * down - 0.05 * pull, -0.15 * toss, 0], neck: [0.1 * down, 0, 0], head: [0.2 * down - 0.1 * toss, 0.15 * toss, 0],
        upperArmL: [-1.25 * down - 0.9 * pull + 0.3 * toss + tug, 0, 0.15 - 0.1 * pull], forearmL: [-0.25 * down - 1.1 * pull + 0.9 * toss, 0, 0],
        upperArmR: [-1.25 * down - 0.9 * pull - 1.5 * toss + tug, 0, -0.15 - 0.25 * toss], forearmR: [-0.25 * down - 1.1 * pull - 0.4 * toss, 0, 0],
        handL: [0.4 * down, 0, 0], handR: [0.4 * down + 0.6 * toss, 0, 0],
      }, { y: -0.24 * down - 0.05 * pull, z: -0.07 * down, pitch: 0.12 * down }, { Lz: 0.12, Rz: -0.1, Rp: 0.2 * down });
    }),
    clip('wave', 1.4, rig, (t) => {
      const e = env(t, 0, 0.15, 0.85, 1);
      return planted({ upperArmR: [-0.2 * e, 0, -2.5 * e], forearmR: [0, 0, (Math.sin(t * Math.PI * 5) * 0.45 - 0.3) * e], handR: [0, 0, -0.2 * e], head: [0, -0.12 * e, Math.sin(t * Math.PI * 2) * 0.06], upperArmL: [0.02, -0.05, 0.12], forearmL: [-0.16, 0, 0], chest: [0, -0.08 * e, 0.04 * e] }, { y: -0.01, z: 0, pitch: 0, roll: -0.02 * e }, { Lz: 0.05, Rz: -0.04 });
    }),
    // ---- meme poses (held for as long as the player likes, so each is a gentle loop) ------------------
    // official stance: hands folded into the sleeves in front of the belly, chin up
    clip('stance', 2.4, rig, (t) => planted({
      chest: [-0.05 + W(t) * 0.012, 0, 0], head: [-0.1, W(t * 0.5) * 0.04, 0],
      upperArmL: [-0.5, 0, -0.12], forearmL: [-1.15, 0, -0.75], upperArmR: [-0.5, 0, 0.12], forearmR: [-1.15, 0, 0.75],
    }, { y: -0.005, z: 0, pitch: 0 }, { Lz: 0.03, Rz: -0.03 })),
    // point: one straight arm at the camera, the other hand on the hip
    clip('point', 1.6, rig, (t) => planted({
      chest: [0.03, -0.12, 0], head: [0.06, 0.08, 0.1 + W(t) * 0.03],
      upperArmR: [-1.55 + W(t * 2) * 0.05, 0, 0.1], forearmR: [0, 0, 0],
      upperArmL: [0.1, 0, 0.62], forearmL: [-0.15, 0, -1.35],
    }, { y: -0.02, z: 0, pitch: 0.02 }, { Lz: 0.14, Rz: -0.12 })),
    // sit: the Roblox sit, legs straight out in front, bottom on the ground
    clip('sit', 3, rig, (t) => ({
      hips: { r: [0, 0, 0], p: [0, -0.64, 0] },
      thighL: [-1.57, 0.1, 0], thighR: [-1.57, -0.1, 0], shinL: [0.02, 0, 0], shinR: [0.02, 0, 0],
      chest: [0.03 + W(t) * 0.012, 0, 0], head: [0, W(t) * 0.12, 0],
      upperArmL: [-0.55, 0, 0.1], forearmL: [-0.5, 0, 0], upperArmR: [-0.55, 0, -0.1], forearmR: [-0.5, 0, 0],
    })),
    // shocked: both arms up, leaning back, head shaking
    clip('shock', 0.8, rig, (t) => planted({
      spine: [-0.1, 0, 0], chest: [-0.16, 0, 0], head: [-0.16, W(t * 2) * 0.14, 0],
      upperArmL: [-0.3, 0, 2.35 + W(t * 3) * 0.1], forearmL: [-0.3, 0, 0.25], upperArmR: [-0.3, 0, -2.35 - W(t * 3) * 0.1], forearmR: [-0.3, 0, -0.25],
    }, { y: -0.07, z: -0.03, pitch: -0.05 }, { Lz: 0.16, Rz: -0.1 })),
    // count money: hands together at the chest, flicking through notes
    clip('flex', 1, rig, (t) => planted({
      head: [0.28, W(t) * 0.05, 0], chest: [0.06, 0, 0],
      upperArmL: [-0.65, 0, -0.1], forearmL: [-1.05, 0, -0.45],
      upperArmR: [-0.65 - Math.max(0, W(t * 3)) * 0.2, 0, 0.1], forearmR: [-1.05 + W(t * 3) * 0.22, 0, 0.45],
    }, { y: -0.01, z: 0, pitch: 0 }, { Lz: 0.08, Rz: -0.06 })),
    // mihao dance: arms pump in turn while the hips sway
    clip('dance', 1.2, rig, (t) => planted({
      chest: [0, W(t) * 0.25, W(t) * 0.08], head: [Math.abs(W(t * 2)) * 0.1, -W(t) * 0.15, -W(t) * 0.12],
      upperArmL: [-0.4 - Math.max(0, W(t)) * 1.9, 0, 0.35], forearmL: [-0.9, 0, 0],
      upperArmR: [-0.4 - Math.max(0, -W(t)) * 1.9, 0, -0.35], forearmR: [-0.9, 0, 0],
    }, { y: -0.06 - Math.abs(W(t * 2)) * 0.06, z: 0, pitch: 0, roll: W(t) * 0.1, x: W(t) * 0.07 }, { Lz: 0.06, Rz: -0.06 })),
    clip('talk', 1.6, rig, (t) => planted({ head: [Math.sin(t * Math.PI * 4) * 0.06, Math.sin(t * Math.PI * 2) * 0.15, 0], upperArmL: [-0.5 - Math.sin(t * Math.PI * 2) * 0.3, 0, 0.2], forearmL: [-0.8, 0, 0], upperArmR: [-0.3, 0, -0.15], forearmR: [-0.4, 0, 0], chest: [0, Math.sin(t * Math.PI * 2) * 0.08, 0] }, { y: -0.01, z: 0, pitch: 0 }, { Lz: 0.05, Rz: -0.04 })),
  ];
}

// ---- Pets (blocky; each wears a tiny official hat except the bee and the turtle) ----------------------

const PET_BONES = (h) => [
  ['root', null, [0, 0, 0]],
  ['body', 'root', [0, h, 0]],
  ['head', 'body', [0, h + 0.04, 0.16]],
  ['legFL', 'body', [0.07, h - 0.02, 0.1]],
  ['legFR', 'body', [-0.07, h - 0.02, 0.1]],
  ['legBL', 'body', [0.07, h - 0.02, -0.1]],
  ['legBR', 'body', [-0.07, h - 0.02, -0.1]],
  ['tail', 'body', [0, h + 0.02, -0.17]],
];

function petClips(rig, { hop = false, fly = false } = {}) {
  const W = (t) => Math.sin(t * Math.PI * 2);
  const legs = (s) => ({ legFL: [s * 0.6, 0, 0], legBR: [s * 0.6, 0, 0], legFR: [-s * 0.6, 0, 0], legBL: [-s * 0.6, 0, 0] });
  return [
    clip('idle', 2, rig, (t) => ({ body: { r: [W(t) * 0.02, 0, 0], p: [0, fly ? 0.03 * W(t * 2) : 0.004 * W(t), 0] }, head: [W(t + 0.3) * 0.08, W(t * 0.5) * 0.25, 0], tail: [0, W(t * 3) * 0.5, 0], ...(fly ? { legFL: [0, 0, W(t * 12) * 0.9], legFR: [0, 0, -W(t * 12) * 0.9] } : {}) })),
    clip('walk', hop ? 0.5 : 0.45, rig, (t) => hop
      ? { body: { r: [-0.25 * Math.max(0, W(t)), 0, 0], p: [0, 0.09 * Math.max(0, W(t)), 0] }, legBL: [0.9 * Math.max(0, W(t)), 0, 0], legBR: [0.9 * Math.max(0, W(t)), 0, 0], legFL: [-0.5 * Math.max(0, W(t)), 0, 0], legFR: [-0.5 * Math.max(0, W(t)), 0, 0], head: [0.15 * W(t), 0, 0] }
      : fly ? { body: { r: [0.15, 0, W(t) * 0.1], p: [0, 0.05 * W(t * 2), 0] }, legFL: [0, 0, W(t * 14) * 0.9], legFR: [0, 0, -W(t * 14) * 0.9] }
      : { ...legs(W(t)), body: { r: [0, 0, W(t) * 0.04], p: [0, Math.abs(W(t)) * 0.015, 0] }, head: [W(t * 2) * 0.05, 0, 0], tail: [0, W(t * 2) * 0.6, 0] }),
    clip('help', 1.0, rig, (t) => { const c = Math.sin(Math.min(1, t * 2) * Math.PI); return { body: { r: [0.5 * c, 0, 0], p: [0, -0.02 * c, 0] }, head: [0.6 * c, 0, 0], legFL: [-0.8 * c + Math.sin(t * 30) * 0.3 * c, 0, 0], legFR: [-0.8 * c - Math.sin(t * 30) * 0.3 * c, 0, 0], tail: [0, W(t * 4) * 0.8, 0] }; }),
    clip('sleep', 3, rig, (t) => ({ body: { r: [0, 0, 0.0], p: [0, -0.04 + W(t) * 0.006, 0] }, head: [0.5, 0, 0.2], legFL: [-1.2, 0, 0], legFR: [-1.2, 0, 0], legBL: [1.2, 0, 0], legBR: [1.2, 0, 0], tail: [0, 0.6, 0] })),
  ];
}

/** Two black block eyes with a white glint, on the head bone. */
function eyesFor(rig, x, y, z, r = 0.022) {
  for (const s of [1, -1]) {
    blk(rig, 'eye', 'head', r * 2, r * 2.2, r * 0.8, '#1a120a', [x * s, y, z]);
    blk(rig, 'eye', 'head', r * 0.8, r * 0.8, r * 0.9, '#ffffff', [x * s + r * 0.3, y + r * 0.45, z + r * 0.12]);
  }
}
/** A tiny official's hat for a pet. */
function miniHat(rig, y, z, s = 1) {
  blk(rig, 'plain', 'head', 0.13 * s, 0.035 * s, 0.12 * s, DARK, [0, y, z]);
  blk(rig, 'plain', 'head', 0.1 * s, 0.04 * s, 0.09 * s, RED, [0, y + 0.037 * s, z]);
  blk(rig, 'plain', 'head', 0.03 * s, 0.03 * s, 0.03 * s, GOLD, [0, y + 0.07 * s, z]);
}
const leg = (rig, side, x, y, z, len, w, color) => blk(rig, 'fur', side, w, len, w, color, [x, y - len / 2, z]);

function dog() {
  const h = 0.24, c = '#D9964A', light = '#F7E6C8';
  const rig = new Rig(PET_BONES(h));
  blk(rig, 'fur', 'body', 0.2, 0.18, 0.38, c, [0, h, 0]);
  blk(rig, 'fur', 'body', 0.16, 0.06, 0.2, light, [0, h - 0.07, 0.05]);
  blk(rig, 'fur', 'head', 0.18, 0.17, 0.17, c, [0, h + 0.1, 0.2]);
  blk(rig, 'fur', 'head', 0.1, 0.075, 0.1, light, [0, h + 0.07, 0.3]);
  blk(rig, 'plain', 'head', 0.04, 0.03, 0.025, '#2b1a12', [0, h + 0.1, 0.355]);
  for (const s of [1, -1]) blk(rig, 'fur', 'head', 0.05, 0.1, 0.07, '#8a5a32', [0.1 * s, h + 0.11, 0.17], [0, 0, 0.3 * s]);
  eyesFor(rig, 0.045, h + 0.14, 0.285, 0.02);
  blk(rig, 'plain', 'head', 0.17, 0.035, 0.17, RED, [0, h + 0.015, 0.14]);
  miniHat(rig, h + 0.205, 0.19);
  for (const [b, x, z] of [['legFL', 0.07, 0.1], ['legFR', -0.07, 0.1], ['legBL', 0.07, -0.1], ['legBR', -0.07, -0.1]]) leg(rig, b, x, h - 0.02, z, 0.18, 0.07, c);
  blk(rig, 'fur', 'tail', 0.045, 0.14, 0.045, c, [0, h + 0.09, -0.22], [-0.7, 0, 0]);
  const b = rig.build('pet_dog');
  weldAll(b.root);
  return { id: 'pet_dog', root: b.root, animations: petClips(rig), tris: b.tris };
}

function bunny() {
  const h = 0.16, c = '#F6EFE0', pink = '#F4A8B8';
  const rig = new Rig(PET_BONES(h));
  blk(rig, 'fur', 'body', 0.22, 0.2, 0.28, c, [0, h, -0.02]);
  blk(rig, 'fur', 'head', 0.17, 0.15, 0.15, c, [0, h + 0.12, 0.13]);
  for (const s of [1, -1]) {
    blk(rig, 'fur', 'head', 0.05, 0.2, 0.035, c, [0.04 * s, h + 0.3, 0.1], [-0.15, 0, 0.12 * s]);
    blk(rig, 'skin', 'head', 0.025, 0.15, 0.01, pink, [0.04 * s, h + 0.3, 0.12], [-0.15, 0, 0.12 * s]);
  }
  blk(rig, 'skin', 'head', 0.035, 0.03, 0.025, pink, [0, h + 0.115, 0.215]);
  eyesFor(rig, 0.045, h + 0.15, 0.2, 0.018);
  miniHat(rig, h + 0.205, 0.12, 0.85);
  for (const [b, x, z] of [['legFL', 0.06, 0.08], ['legFR', -0.06, 0.08]]) leg(rig, b, x, h - 0.03, z, 0.1, 0.055, c);
  for (const [b, x] of [['legBL', 0.07], ['legBR', -0.07]]) blk(rig, 'fur', b, 0.07, 0.07, 0.15, c, [x, 0.04, -0.06]);
  blk(rig, 'fur', 'tail', 0.08, 0.08, 0.08, '#ffffff', [0, h + 0.03, -0.2]);
  const b = rig.build('pet_bunny');
  weldAll(b.root);
  return { id: 'pet_bunny', root: b.root, animations: petClips(rig, { hop: true }), tris: b.tris };
}

function capybara() {
  const h = 0.26, c = '#A57244', dark = '#6A4428';
  const rig = new Rig(PET_BONES(h));
  blk(rig, 'fur', 'body', 0.28, 0.25, 0.42, c, [0, h, -0.02]);
  blk(rig, 'fur', 'head', 0.18, 0.17, 0.2, c, [0, h + 0.07, 0.2]);
  blk(rig, 'fur', 'head', 0.16, 0.1, 0.1, dark, [0, h + 0.04, 0.32]);
  for (const s of [1, -1]) blk(rig, 'fur', 'head', 0.05, 0.05, 0.04, dark, [0.075 * s, h + 0.17, 0.14]);
  eyesFor(rig, 0.07, h + 0.12, 0.3, 0.016);
  miniHat(rig, h + 0.17, 0.19, 0.9);
  // a little bird napping on its head (on a hat of its own)
  blk(rig, 'fur', 'head', 0.07, 0.06, 0.08, '#F2C84A', [0.0, h + 0.265, 0.19]);
  blk(rig, 'plain', 'head', 0.02, 0.02, 0.03, '#E0802A', [0, h + 0.265, 0.245]);
  for (const [b, x, z] of [['legFL', 0.08, 0.12], ['legFR', -0.08, 0.12], ['legBL', 0.08, -0.12], ['legBR', -0.08, -0.12]]) leg(rig, b, x, h - 0.06, z, 0.14, 0.08, dark);
  const b = rig.build('pet_capybara');
  weldAll(b.root);
  return { id: 'pet_capybara', root: b.root, animations: petClips(rig), tris: b.tris };
}

function bee() {
  const h = 0.55;
  const rig = new Rig(PET_BONES(h));
  blk(rig, 'fur', 'body', 0.17, 0.17, 0.2, '#F8CF3F', [0, h, 0.03]);
  blk(rig, 'fur', 'body', 0.18, 0.18, 0.05, '#2b1a12', [0, h, -0.04]);
  blk(rig, 'fur', 'body', 0.175, 0.175, 0.04, '#2b1a12', [0, h, 0.06]);
  blk(rig, 'fur', 'body', 0.14, 0.14, 0.1, '#F8CF3F', [0, h, -0.14]);
  blk(rig, 'plain', 'body', 0.03, 0.03, 0.06, '#2b1a12', [0, h, -0.22]);
  blk(rig, 'fur', 'head', 0.14, 0.13, 0.12, '#2b1a12', [0, h + 0.02, 0.15]);
  for (const s of [1, -1]) {
    blk(rig, 'plain', 'head', 0.012, 0.09, 0.012, '#2b1a12', [0.03 * s, h + 0.12, 0.19], [0.5, 0, -0.4 * s]);
    blk(rig, 'eye', 'head', 0.05, 0.05, 0.02, '#ffffff', [0.04 * s, h + 0.04, 0.215]);
    blk(rig, 'eye', 'head', 0.025, 0.025, 0.022, '#1a120a', [0.042 * s, h + 0.04, 0.225]);
  }
  // wings sit on the front-leg bones, which the clips flap
  for (const [bn, s] of [['legFL', 1], ['legFR', -1]]) blk(rig, 'glass', bn, 0.2, 0.012, 0.11, '#DFF3FF', [0.12 * s, h + 0.1, 0.03], [0, 0, -0.35 * s]);
  const b = rig.build('pet_bee');
  weldAll(b.root);
  return { id: 'pet_bee', root: b.root, animations: petClips(rig, { fly: true }), tris: b.tris };
}

function turtle() {
  const h = 0.12, shell = '#4E9A45', skin = '#A6C76A';
  const rig = new Rig(PET_BONES(h));
  blk(rig, 'fur', 'body', 0.36, 0.09, 0.42, shell, [0, h + 0.015, 0]);
  blk(rig, 'fur', 'body', 0.26, 0.07, 0.3, '#69B957', [0, h + 0.085, 0]);
  blk(rig, 'fur', 'body', 0.14, 0.04, 0.16, '#8AD06A', [0, h + 0.13, 0]);
  blk(rig, 'plain', 'body', 0.38, 0.03, 0.44, '#D8BE74', [0, h - 0.045, 0]);
  blk(rig, 'skin', 'head', 0.13, 0.11, 0.14, skin, [0, h + 0.03, 0.27]);
  eyesFor(rig, 0.035, h + 0.07, 0.335, 0.014);
  for (const [b, x, z] of [['legFL', 0.15, 0.13], ['legFR', -0.15, 0.13], ['legBL', 0.15, -0.13], ['legBR', -0.15, -0.13]]) blk(rig, 'skin', b, 0.08, 0.08, 0.1, skin, [x, 0.04, z]);
  blk(rig, 'skin', 'tail', 0.04, 0.04, 0.08, skin, [0, h - 0.02, -0.26]);
  const b = rig.build('pet_turtle');
  weldAll(b.root);
  return { id: 'pet_turtle', root: b.root, animations: petClips(rig), tris: b.tris };
}

export function buildPets() { return [dog(), bunny(), capybara(), bee(), turtle()]; }

/** Vendors and pets (the player, buildFarmer(), is exported separately). */
export function buildCharacters() {
  return [petkeeper(), tinkerer(), mole(), goat(), ...buildPets()];
}
