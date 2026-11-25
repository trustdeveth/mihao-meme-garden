// The player Mihao: a rounded cat head wearing a photo face, with separate 3D eyebrows, long thin
// moustache strands and a pointed beard, on a blocky Roblox body in a red and gold jacket and shorts.
// Mesh names (farmer_skin, farmer_hair, farmer_shirt, ...) are what the avatar editor recolours.
import * as THREE from 'three';
import { V3, TAU, place, roundedBox } from './lib/geo.js';
import { buildWardrobe, buildBeards } from './wardrobe.js';

const GOLD = '#E8B53A';
const GOLD_DARK = '#B9852A';
const WHITE = '#FFFFFF'; // facial hair is tinted by the player's hair colour
const CREAM = '#E9D6B8';
const PAW = '#F4EEE2';

const HY = 1.46; // bottom of the head
/** The head: a rounded block, a little flatter than a ball so the face reads from the front. */
export const HEAD = { w: 0.37, h: 0.3, d: 0.31, n: 2.4, y: HY + 0.29 };
/** Depth of the face surface at (x, y), y measured from the head centre. */
const faceZ = (x, y) => HEAD.d * Math.max(0, 1 - Math.abs(x / HEAD.w) ** HEAD.n - Math.abs(y / HEAD.h) ** HEAD.n) ** (1 / HEAD.n);

export const BEARD_STYLES = ['classic', 'long', 'bushy', 'curly', 'braid', 'short'];

/** Extra bones so the facial hair can swing. */
export const HAIR_BONES = [
  ['stacheL', 'head', [0.05, HEAD.y - 0.12, 0.32]],
  ['stacheR', 'head', [-0.05, HEAD.y - 0.12, 0.32]],
  ['beard', 'head', [0, HEAD.y - 0.17, 0.28]],
];

/** Gentle forward-and-back swing for the hair bones, looping cleanly in every clip. */
export function hairSway(bone, t, clipName, dur, pose = {}) {
  if (!['stacheL', 'stacheR', 'beard'].includes(bone)) return null;
  const moving = clipName === 'walk' || clipName === 'run' || clipName === 'dance';
  const amp = moving ? 0.1 : 0.035;
  const cycles = moving ? 2 : Math.max(1, Math.round(dur / 2));
  const phase = bone === 'stacheL' ? 0 : bone === 'stacheR' ? 0.35 : 0.65;
  const a = Math.sin((t * cycles + phase) * TAU);
  const side = bone === 'stacheL' ? 1 : bone === 'stacheR' ? -1 : 0;
  // when the head tips down, the hair hangs forward of it instead of turning with it into the chest
  const pitch = (v) => (Array.isArray(v) ? v[0] : v?.r?.[0] ?? 0);
  const drape = Math.max(0, pitch(pose.neck) + pitch(pose.head)) * 1.35;
  // otherwise it only ever swings forwards
  return [-drape - amp * (0.5 + 0.5 * a), 0, side * amp * 0.35 * (0.5 + 0.5 * a)];
}

/** Non-indexed copy with exactly position, normal, uv and color, keeping its smooth normals. */
export function smoothGeo(g, color = '#ffffff') {
  const out = g.index ? g.toNonIndexed() : g;
  const n = out.attributes.position.count;
  if (!out.attributes.uv) out.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  if (!out.attributes.color) {
    const c = new THREE.Color(color);
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
    out.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
  }
  for (const k of Object.keys(out.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) out.deleteAttribute(k);
  return out;
}
const add = (rig, slot, bone, geo) => (rig.parts[slot] ??= []).push({ geo, bone: rig.list.indexOf(rig.bones[bone]) });
const blk = (rig, slot, bone, w, h, d, color, pos, rot = [0, 0, 0]) => rig.part(slot, place(roundedBox(w, h, d, 0.02, { color }), { pos, rot }), bone);

/** A rounded blob (superellipsoid): radii rx, ry, rz; a higher n is boxier. */
function roundGeo(rx, ry, rz, n = 2.4, ws = 40, hs = 30) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = (Math.abs(x) ** n + Math.abs(y) ** n + Math.abs(z) ** n) ** (-1 / n);
    p.setXYZ(i, x * k * rx, y * k * ry, z * k * rz);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Texture coordinates for the head atlas (left half: the face, seen from the front; right half: plain fur for the
 * sides and back). Chosen per triangle so no triangle stretches across the two halves.
 */
function headUV(geo) {
  const g = geo.toNonIndexed();
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i += 3) {
    const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    const front = cz > 0.07;
    for (let k = i; k < i + 3; k++) {
      const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
      const v = Math.min(0.998, Math.max(0.002, y / (2 * HEAD.h) + 0.5));
      if (front) uv.setXY(k, Math.min(0.497, Math.max(0.003, (x / (2 * HEAD.w) + 0.5) * 0.5)), v);
      else {
        let a = Math.atan2(x, z);
        if (a * cx < 0) a = -a; // keep a whole triangle on one side of the seam at the back
        uv.setXY(k, 0.503 + 0.494 * Math.min(1, Math.max(0, a / TAU + 0.5)), v);
      }
    }
  }
  return g;
}

/** A soft tapering lock of hair along a curve. widths: [[t, radius], ...]; flat squashes it front to back. */
export function lock(points, widths, { flat = 0.6, segs = 26, radial = 10, color = WHITE } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((q) => new V3(...q)));
  const radiusAt = (t) => {
    for (let i = 0; i < widths.length - 1; i++) {
      const [a, ra] = widths[i], [b, rb] = widths[i + 1];
      if (t >= a && t <= b) return ra + (rb - ra) * ((t - a) / (b - a || 1));
    }
    return widths[widths.length - 1][1];
  };
  const pos = [], idx = [];
  const forward = new V3(0, 0, 1);
  for (let j = 0; j <= segs; j++) {
    const t = j / segs;
    const c = curve.getPoint(t), tan = curve.getTangent(t).normalize();
    const side = new V3().crossVectors(tan, forward).normalize(); // across the lock, in the face plane
    const out = new V3().crossVectors(side, tan).normalize();
    const r = radiusAt(t);
    for (let i = 0; i <= radial; i++) {
      const a = (i / radial) * TAU;
      const q = c.clone().addScaledVector(side, Math.cos(a) * r).addScaledVector(out, Math.sin(a) * r * flat);
      pos.push(q.x, q.y, q.z);
    }
  }
  const row = radial + 1;
  for (let j = 0; j < segs; j++) for (let i = 0; i < radial; i++) {
    const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // make sure the normals point out of the lock, whichever way the curve runs
  const first = new V3().fromBufferAttribute(g.attributes.normal, 0);
  const outward = new V3().fromBufferAttribute(g.attributes.position, 0).sub(curve.getPoint(0));
  if (first.dot(outward) < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.computeVertexNormals(); }
  return smoothGeo(g, color);
}

/** The head shape with its face texture coordinates, centred on the origin (also used for the Sky Balloon). */
export function headShell(ws = 48, hs = 36) {
  const base = roundGeo(HEAD.w, HEAD.h, HEAD.d, HEAD.n, ws, hs);
  const p = base.attributes.position;
  for (let i = 0; i < p.count; i++) {
    // a small muzzle that stands out under the nose
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (z > 0) p.setZ(i, z + 0.035 * Math.exp(-(((x / 0.1) ** 2) + (((y + 0.135) / 0.075) ** 2))));
  }
  base.computeVertexNormals();
  return headUV(base);
}

function head(rig) {
  add(rig, 'skin', 'head', smoothGeo(place(headShell(), { pos: [0, HEAD.y, 0] })));

  for (const s of [1, -1]) {
    // big upright ears: a flattened cone in head fur, with a pink inside and pale tufts
    const ear = new THREE.ConeGeometry(0.135, 0.32, 20, 6);
    ear.scale(1, 1, 0.48);
    const uv = ear.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.66 + uv.getX(i) * 0.16, 0.5 + uv.getY(i) * 0.3);
    add(rig, 'ears', 'head', smoothGeo(place(ear, { pos: [0.235 * s, HEAD.y + 0.335, -0.03], rot: [0, 0, -0.34 * s] })));
    const inner = new THREE.ConeGeometry(0.086, 0.235, 16, 6);
    inner.scale(1, 1, 0.22);
    const ig = smoothGeo(inner);
    const ip = ig.attributes.position, ic = ig.attributes.color;
    const lo = new THREE.Color('#F3DCCB'), hi = new THREE.Color('#D98F86');
    for (let i = 0; i < ip.count; i++) { const c = lo.clone().lerp(hi, Math.min(1, Math.max(0, ip.getY(i) / 0.235 + 0.65))); ic.setXYZ(i, c.r, c.g, c.b); }
    add(rig, 'earsin', 'head', place(ig, { pos: [0.228 * s, HEAD.y + 0.315, 0.025], rot: [0, 0, -0.34 * s] }));
    for (let k = 0; k < 3; k++) add(rig, 'earsin', 'head', lock([[s * (0.2 + k * 0.02), HEAD.y + 0.23, 0.045], [s * (0.215 + k * 0.026), HEAD.y + 0.3, 0.05], [s * (0.222 + k * 0.038), HEAD.y + 0.355 - k * 0.025, 0.04]], [[0, 0.008], [0.5, 0.006], [1, 0.0008]], { segs: 8, radial: 6 }));
  }
}

function facialHair(rig) {
  const Y = HEAD.y;
  const onFace = (x, y, lift = 0.012) => [x, Y + y, faceZ(x, y) + lift];
  for (const [s, side] of [[1, 'L'], [-1, 'R']]) {
    // eyebrows: they start above the eye, sweep sideways past the head and droop at the tip
    add(rig, 'hair', 'head', lock([onFace(0.055 * s, 0.103), onFace(0.15 * s, 0.128, 0.018), onFace(0.25 * s, 0.113, 0.022), [0.345 * s, Y + 0.06, 0.2], [0.39 * s, Y - 0.025, 0.17]],
      [[0, 0.004], [0.25, 0.017], [0.6, 0.012], [1, 0.001]], { flat: 0.4 }));
    // whiskers
    for (let k = 0; k < 3; k++) add(rig, 'hair', 'head', lock([onFace(0.1 * s, -0.115 - k * 0.025, 0.016), [0.28 * s, Y - 0.1 - k * 0.045, 0.32], [0.45 * s, Y - 0.11 - k * 0.075, 0.25]], [[0, 0.0035], [1, 0.0008]], { segs: 10, radial: 5 }));
  }
}

// ---- gold embroidery, painted once on a canvas and laid on the clothes as flat decals -----------------
let goldTexture = null;
function embroidery() {
  if (goldTexture) return goldTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.scale(0.5, 0.5);
  g.lineCap = 'round';
  const draw = (color, width) => {
    g.strokeStyle = color; g.lineWidth = width;
    g.beginPath(); g.arc(128, 128, 108, 0, TAU); g.stroke();
    // a ring of little cloud curls around a bigger centre swirl
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU;
      g.beginPath(); g.arc(128 + Math.cos(a) * 68, 128 + Math.sin(a) * 68, 24, a - 2.4, a + 2.4); g.stroke();
      g.beginPath(); g.arc(128 + Math.cos(a) * 68, 128 + Math.sin(a) * 68, 9, a + 0.6, a + 5.2); g.stroke();
    }
    g.beginPath();
    for (let t = 0; t <= 1.001; t += 0.02) { const a = t * TAU * 2.1, r = 6 + t * 30; const x = 128 + Math.cos(a) * r, y = 128 + Math.sin(a) * r; if (t) g.lineTo(x, y); else g.moveTo(x, y); }
    g.stroke();
  };
  draw(GOLD_DARK, 15);
  draw('#F6CF5C', 8);
  goldTexture = new THREE.CanvasTexture(c);
  goldTexture.colorSpace = THREE.SRGBColorSpace;
  goldTexture.name = 'mihao_gold';
  return goldTexture;
}
function medallion(rig, slot, bone, size, pos, rot = [0, 0, 0]) {
  add(rig, slot, bone, smoothGeo(place(new THREE.PlaneGeometry(size, size), { pos, rot })));
}

function body(rig, D, C) {
  const shirt = C(D.shirt), pants = C(D.pants), boots = C(D.boots);
  for (const [s, side] of [[1, 'L'], [-1, 'R']]) {
    const x = 0.155 * s, ax = 0.445 * s;
    // shorts to the knee with a gold hem, then furry cat legs and big soft paws
    blk(rig, 'pants', `thigh${side}`, 0.3, 0.37, 0.31, pants, [x, 0.615, 0]);
    blk(rig, 'pantsdeco', `thigh${side}`, 0.31, 0.045, 0.32, GOLD, [x, 0.455, 0]);
    medallion(rig, 'trim_pants', `thigh${side}`, 0.17, [x, 0.6, 0.1565]);
    blk(rig, 'plain', `shin${side}`, 0.235, 0.36, 0.235, CREAM, [x, 0.29, 0]);
    add(rig, 'boots', `foot${side}`, smoothGeo(place(roundGeo(0.155, 0.085, 0.215, 3, 24, 16), { pos: [x, 0.08, 0.055] }), boots));
    for (const k of [-1, 1]) blk(rig, 'bootsdeco', `foot${side}`, 0.012, 0.06, 0.012, '#B9AC98', [x + k * 0.048, 0.062, 0.262]);
    // red sleeves with gold cuffs, ending in round white paws
    blk(rig, 'shirt', `upperArm${side}`, 0.25, 0.34, 0.25, shirt, [ax, 1.29, 0]);
    blk(rig, 'shirt', `forearm${side}`, 0.255, 0.23, 0.255, shirt, [ax, 1.015, 0]);
    blk(rig, 'shirtdeco', `forearm${side}`, 0.275, 0.065, 0.275, GOLD, [ax, 0.915, 0]);
    blk(rig, 'shirtdeco', `forearm${side}`, 0.268, 0.014, 0.268, GOLD_DARK, [ax, 0.965, 0]);
    add(rig, `hand${side}`, `hand${side}`, smoothGeo(place(roundGeo(0.122, 0.105, 0.122, 2.6, 24, 16), { pos: [ax, 0.815, 0.008] }), C(D.handL)));
    medallion(rig, 'trim_shirt', `upperArm${side}`, 0.18, [ax, 1.3, 0.1265]);
    medallion(rig, 'trim_shirt', `upperArm${side}`, 0.18, [ax + 0.1265 * s, 1.3, 0], [0, (Math.PI / 2) * s, 0]);
  }
  // short jacket: chest and waist blocks, shorts at the hips
  blk(rig, 'shirt', 'chest', 0.64, 0.38, 0.34, shirt, [0, 1.27, 0]);
  blk(rig, 'shirt', 'spine', 0.655, 0.3, 0.36, shirt, [0, 0.95, 0]);
  blk(rig, 'pants', 'hips', 0.62, 0.14, 0.33, pants, [0, 0.755, 0]);
  blk(rig, 'shirtdeco', 'spine', 0.668, 0.045, 0.373, GOLD, [0, 0.822, 0]);
  blk(rig, 'shirtdeco', 'spine', 0.664, 0.012, 0.369, GOLD_DARK, [0, 0.87, 0]);
  // front opening piped in gold, with knotted frog fastenings
  blk(rig, 'shirtdeco', 'chest', 0.026, 0.38, 0.012, GOLD, [0, 1.27, 0.174]);
  blk(rig, 'shirtdeco', 'spine', 0.026, 0.28, 0.012, GOLD, [0, 0.96, 0.184]);
  for (const [y, bone, z] of [[1.33, 'chest', 0.18], [1.16, 'chest', 0.18], [1.01, 'spine', 0.19], [0.89, 'spine', 0.19]]) {
    blk(rig, 'shirtdeco', bone, 0.17, 0.016, 0.012, GOLD, [0, y, z]);
    for (const s of [1, -1]) {
      blk(rig, 'shirtdeco', bone, 0.034, 0.034, 0.016, GOLD, [0.088 * s, y, z], [0, 0, Math.PI / 4]);
      blk(rig, 'shirtdeco', bone, 0.014, 0.014, 0.018, '#8E1318', [0.088 * s, y, z], [0, 0, Math.PI / 4]);
    }
    blk(rig, 'shirtdeco', bone, 0.03, 0.03, 0.022, '#F6CF5C', [0, y, z]);
  }
  for (const s of [1, -1]) {
    medallion(rig, 'trim_shirt', 'chest', 0.17, [0.2 * s, 1.24, 0.1715]);
    medallion(rig, 'trim_shirt', 'spine', 0.18, [0.19 * s, 0.97, 0.1815]);
    // shoulder seams in gold
    blk(rig, 'shirtdeco', 'chest', 0.2, 0.018, 0.012, GOLD, [0.22 * s, 1.425, 0.174], [0, 0, -0.18 * s]);
  }
  medallion(rig, 'trim_shirt', 'chest', 0.34, [0, 1.25, -0.1715], [0, Math.PI, 0]);
  medallion(rig, 'trim_shirt', 'spine', 0.24, [0, 0.96, -0.1815], [0, Math.PI, 0]);
  // a low stand collar piped in gold
  blk(rig, 'shirt', 'neck', 0.36, 0.07, 0.28, shirt, [0, 1.48, 0]);
  blk(rig, 'shirtdeco', 'neck', 0.368, 0.016, 0.288, GOLD, [0, 1.512, 0]);
}

/**
 * Build the whole player body and head onto a rig. D: default colours; C(colour) gives the vertex colour to use
 * (white for parts the player can recolour). headImage: the loaded head atlas.
 */
export function mihaoPlayer(rig, D, C, headImage) {
  body(rig, D, C);
  head(rig);
  facialHair(rig);
  const face = new THREE.Texture(headImage);
  face.colorSpace = THREE.SRGBColorSpace;
  face.needsUpdate = true;
  face.userData.mimeType = 'image/jpeg';
  // "tex_" materials keep their own texture in the game
  // a little self-light keeps the face and the white hair readable in shade (the joke has to be seen)
  const headMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: face, roughness: 0.92, emissive: new THREE.Color(0.2, 0.2, 0.2), emissiveMap: face });
  const hairMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, emissive: new THREE.Color(0.2, 0.2, 0.19) });
  hairMat.name = 'tex_hair';
  headMat.name = 'tex_head';
  const goldMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: embroidery(), alphaTest: 0.45, roughness: 0.55, metalness: 0.15 });
  goldMat.name = 'tex_gold';
  rig.mats = { skin: headMat, ears: headMat, hair: hairMat, trim_shirt: goldMat, trim_pants: goldMat };
  for (const style of BEARD_STYLES) rig.mats[`beard_${style}`] = hairMat;
  const kit = { add, smoothGeo, roundGeo, lock, HEAD };
  buildBeards(rig, kit);
  buildWardrobe(rig, kit);
  // used when a player picks another fur colour: the photo is turned grey and tinted
  rig.meshData = { skin: { avgLum: 0.34, fur: true }, ears: { avgLum: 0.34, fur: true } };
}

/** Load the head atlas (made from the reference photo; see tools/models/source/README.md). */
export function loadHeadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
}