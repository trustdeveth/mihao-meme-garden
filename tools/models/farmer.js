// Converts the CC-BY "Cartoon farmer character model" (zyroiscool2025, Sketchfab) into a game-ready rigged character:
// merge -> reduce to a game budget -> measure the body -> split it into tintable clothing regions -> skeleton +
// skin weights -> face (eyes, brows, mouth) -> hands and hats -> our animations.
// Runs in the headless-Chrome model builder page.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from '/node_modules/meshoptimizer/meshopt_simplifier.js';
import { humanClips } from './characters.js';
import { finish, place, sphere, torus, blob, lathe, cyl, cone, roundedBox, leafBlade, triCount } from './lib/geo.js';

export const FARMER_SOURCE = '/tools/models/source/farmer/cartoon_farmer.glb';
export const FARMER_CREDIT = '"Cartoon farmer character model" by zyroiscool2025 (sketchfab.com/zyroiscool2025), CC-BY-4.0';
export const REGIONS = ['skin', 'hair', 'shirt', 'pants', 'boots', 'hat'];
const HEIGHT = 2.0; // top of the hat, metres (chibi proportions: a little taller so the legs suit our walking speed)
const TARGET_TRIS = 16000;

/** Load, merge, weld, normalise (feet on y=0, facing +z, height HEIGHT) and reduce. */
export async function loadFarmer() {
  const gltf = await new GLTFLoader().loadAsync(FARMER_SOURCE);
  gltf.scene.updateMatrixWorld(true);
  const parts = [];
  let map = null;
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    map ??= o.material.map;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    // normals are recomputed later; keeping per-face normals would stop vertices from welding
    for (const k of Object.keys(g.attributes)) if (!['position', 'uv'].includes(k)) g.deleteAttribute(k);
    parts.push(g.index ? g : g);
  });
  let geo = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false);
  geo = mergeVertices(geo, 1e-5);
  // normalise
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const s = HEIGHT / (bb.max.y - bb.min.y);
  geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  geo.scale(s, s, s);
  // reduce: keep UV seams, keep the silhouette
  await MeshoptSimplifier.ready;
  const pos = geo.attributes.position.array;
  const uv = geo.attributes.uv.array;
  const idx = new Uint32Array(geo.index.array);
  const [out] = MeshoptSimplifier.simplifyWithAttributes(idx, pos, 3, uv, 2, [0.5, 0.5], null, TARGET_TRIS * 3, 0.08, []);
  geo.setIndex(new THREE.BufferAttribute(out, 1));
  geo = compact(geo);
  geo.computeVertexNormals();
  return { geo, map, sourceTris: idx.length / 3 };
}

/** Drop vertices no longer used by the index. */
function compact(geo) {
  const idx = geo.index.array;
  const used = new Int32Array(geo.attributes.position.count).fill(-1);
  let n = 0;
  for (const i of idx) if (used[i] < 0) used[i] = n++;
  const g = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(geo.attributes)) {
    const arr = new Float32Array(n * a.itemSize);
    for (let i = 0; i < used.length; i++) if (used[i] >= 0) for (let c = 0; c < a.itemSize; c++) arr[used[i] * a.itemSize + c] = a.array[i * a.itemSize + c];
    g.setAttribute(k, new THREE.BufferAttribute(arr, a.itemSize));
  }
  g.setIndex(new THREE.BufferAttribute(Uint32Array.from(idx, (i) => used[i]), 1));
  return g;
}

/** Texture pixels for colour sampling. */
export function texturePixels(map, size = 1024) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(map.image, 0, 0, size, size);
  return { canvas: c, data: ctx.getImageData(0, 0, size, size).data, size };
}
const sample = (px, u, v) => {
  const x = Math.min(px.size - 1, Math.max(0, Math.floor(u * px.size)));
  const y = Math.min(px.size - 1, Math.max(0, Math.floor(v * px.size))); // glTF uv: v=0 at the top of the image
  const i = (y * px.size + x) * 4;
  return [px.data[i] / 255, px.data[i + 1] / 255, px.data[i + 2] / 255];
};
function hsv([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((h * 60) + 360) % 360, mx ? d / mx : 0, mx];
}

/** Orthographic front silhouette: at(x, y) is true where the body covers that point (x in -1..1, y in 0..2). */
function silhouette(geo, res = 800) {
  const r = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  r.setSize(res, res, false);
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide })));
  const cam = new THREE.OrthographicCamera(-1, 1, 2, 0, -5, 5);
  cam.position.z = 3;
  r.setClearColor('#000000');
  r.render(scene, cam);
  const gl = r.getContext();
  const px = new Uint8Array(res * res * 4);
  gl.readPixels(0, 0, res, res, gl.RGBA, gl.UNSIGNED_BYTE, px);
  r.dispose();
  return { at: (x, y) => { const i = Math.floor(((x + 1) / 2) * res), j = Math.floor((y / 2) * res); return i >= 0 && i < res && j >= 0 && j < res && px[(j * res + i) * 4] > 128; } };
}

/** Horizontal slices of the body: how wide it is and where the gaps are, to find the joints. */
export function measure(geo) {
  const p = geo.attributes.position;
  const H = HEIGHT;
  const slice = (y0, y1) => { const xs = []; for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y >= y0 && y < y1) xs.push(p.getX(i)); } return xs.sort((a, b) => a - b); };
  // measure from a flat front silhouette (vertex sampling is too sparse on the reduced mesh)
  const S = silhouette(geo);
  let crotch = 0.45;
  for (let y = 0.15; y < 1.3; y += 0.005) if ([0, 1, 2, 3].every((k) => S.at(0, y + k * 0.005))) { crotch = y; break; }
  const run = (y, x0) => { let l = x0, r = x0; while (S.at(l - 0.004, y)) l -= 0.004; while (S.at(r + 0.004, y)) r += 0.004; return [l, r]; };
  // leg centres just below the crotch
  let legX = 0.12;
  { const y = crotch - 0.12; let x = 0.004; while (x < 0.4 && !S.at(x, y)) x += 0.004; const [l, r] = run(y, x); legX = (l + r) / 2; }
  // arms (T-pose): the widest slice is the arm line; armpit where width jumps
  let armY = 1, armW = 0;
  for (let y = 0.6; y < 1.6; y += 0.01) { const xs = slice(y, y + 0.01); if (xs.length && xs[xs.length - 1] - xs[0] > armW) { armW = xs[xs.length - 1] - xs[0]; armY = y; } }
  // torso half-width at the chest, below the arm line (arms are out in a T-pose, so they are not in this slice)
  let torsoW = 0.2;
  { const [l, r] = run(crotch + (armY - crotch) * 0.45, 0); torsoW = (r - l) / 2; }
  // head: narrowest slice between the arm line and the top (neck), the hat brim is the widest above
  let neckY = armY + 0.1, neckW = 9;
  for (let y = armY + 0.04; y < armY + 0.4; y += 0.01) { const xs = slice(y, y + 0.01); if (xs.length > 6) { const w = xs[xs.length - 1] - xs[0]; if (w < neckW) { neckW = w; neckY = y; } } }
  return { H, crotch, legX, armY, armSpan: armW, torsoW, neckY, neckW };
}

/** Region of one point from its texture colour and where it is on the body. */
function classify(rgb, x, y, m) {
  const [h, s, v] = hsv(rgb);
  const headZone = y > m.neckY - 0.02;
  const inArm = Math.abs(x) > m.torsoW + 0.02 && y > m.armY - 0.2;
  if (y < 0.16 && v < 0.6) return 'boots';
  if (headZone) {
    if (h >= 30 && h <= 62 && s > 0.25 && v > 0.55) return 'hat';
    if (v < 0.45 && s > 0.3) return 'hair';
    if (h > 5 && h < 40 && s > 0.15 && v > 0.5) return 'skin';
    return y > m.neckY + 0.25 ? 'hat' : 'skin';
  }
  if (inArm && h > 6 && h < 42 && s > 0.12 && s < 0.62 && v > 0.55) return 'skin'; // bare forearms: lighter and softer than the red plaid
  if (h >= 190 && h <= 260 && s > 0.2) return 'pants';
  if ((h < 18 || h > 330) && s > 0.35) return 'shirt';
  if (h > 12 && h < 40 && s > 0.2 && s < 0.65 && v > 0.62 && (inArm || y > m.armY - 0.05)) return 'skin';
  if (v > 0.75 && s < 0.2) return y < m.crotch ? 'pants' : 'shirt';
  if (y < m.crotch + 0.35 && !inArm) return 'pants';
  return 'shirt';
}

/**
 * Region of every triangle, from the texture at points inside it (centre and towards each corner).
 * After reduction a forearm can be one ring of long triangles from the sleeve cuff to the hand; judging by
 * the corners would make it "shirt", but the inside of those triangles is painted skin.
 */
export function triRegions(geo, px, m, R, cut = Infinity, handCut = Infinity) {
  const p = geo.attributes.position, uv = geo.attributes.uv, ix = geo.index.array;
  const T = new Uint8Array(ix.length / 3);
  const id = Object.fromEntries(REGIONS.map((r, i) => [r, i]));
  const W = [[1 / 3, 1 / 3, 1 / 3], [0.6, 0.2, 0.2], [0.2, 0.6, 0.2], [0.2, 0.2, 0.6]];
  for (let t = 0; t < ix.length; t += 3) {
    const [a, b, c] = [ix[t], ix[t + 1], ix[t + 2]];
    const votes = new Array(REGIONS.length).fill(0);
    W.forEach(([wa, wb, wc], k) => {
      const u = uv.getX(a) * wa + uv.getX(b) * wb + uv.getX(c) * wc, v = uv.getY(a) * wa + uv.getY(b) * wb + uv.getY(c) * wc;
      const x = p.getX(a) * wa + p.getX(b) * wb + p.getX(c) * wc, y = p.getY(a) * wa + p.getY(b) * wb + p.getY(c) * wc;
      votes[id[classify(sample(px, u, v), x, y, m)]] += k === 0 ? 1.5 : 1;
    });
    T[t / 3] = votes.indexOf(Math.max(...votes));
    // the old ball hand is removed: triangles touching it go if they sit mostly beyond the wrist line
    // (the long forearm triangles that only reach it stay, so the arm is not cut short)
    if (R[a] === 255 || R[b] === 255 || R[c] === 255) T[t / 3] = 255;
    // old bare-forearm skin past the elbow: replaced by the clean forearm piece
    const cx = Math.abs((p.getX(a) + p.getX(b) + p.getX(c)) / 3), cy = (p.getY(a) + p.getY(b) + p.getY(c)) / 3;
    if (T[t / 3] === id.skin && cx > cut && Math.abs(cy - m.armY) < 0.16) T[t / 3] = 255;
    // reddish bits of the old ball hand were read as shirt: nothing of the shirt belongs near the hand
    if (T[t / 3] === id.shirt && cx > handCut && Math.abs(cy - m.armY) < 0.16) T[t / 3] = 255;
  }
  return T;
}

/** Body region of every vertex from the texture colour and where it is on the body. */
export function regions(geo, px, m) {
  const p = geo.attributes.position, uv = geo.attributes.uv;
  const R = new Uint8Array(p.count);
  const id = Object.fromEntries(REGIONS.map((r, i) => [r, i]));
  for (let i = 0; i < p.count; i++) R[i] = id[classify(sample(px, uv.getX(i), uv.getY(i)), p.getX(i), p.getY(i), m)];
  // smooth: each vertex takes the majority of its neighbours (removes speckles from the texture)
  const nb = Array.from({ length: p.count }, () => []);
  const ix = geo.index.array;
  for (let t = 0; t < ix.length; t += 3) for (let k = 0; k < 3; k++) { nb[ix[t + k]].push(ix[t + (k + 1) % 3]); }
  // the bare forearm is a thin band between the rolled sleeve and the hand: keep it skin
  const skinId = id.skin;
  const armSkin = new Uint8Array(p.count);
  for (let i = 0; i < p.count; i++) if (R[i] === skinId && Math.abs(p.getX(i)) > m.torsoW + 0.02 && p.getY(i) < m.neckY - 0.02) armSkin[i] = 1;
  for (let pass = 0; pass < 2; pass++) {
    const next = R.slice();
    for (let i = 0; i < p.count; i++) {
      if (armSkin[i]) continue;
      const c = new Array(REGIONS.length).fill(0);
      c[R[i]] += 1.5;
      for (const j of nb[i]) c[R[j]]++;
      next[i] = c.indexOf(Math.max(...c));
    }
    R.set(next);
  }
  return R;
}

// ---- skeleton, skinning, face, accessories ------------------------------------------------------

const BONES = ['root', 'hips', 'spine', 'chest', 'neck', 'head', 'upperArmL', 'forearmL', 'handL', 'upperArmR', 'forearmR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
const PARENT = { hips: 'root', spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck', upperArmL: 'chest', forearmL: 'upperArmL', handL: 'forearmL', upperArmR: 'chest', forearmR: 'upperArmR', handR: 'forearmR', thighL: 'hips', shinL: 'thighL', footL: 'shinL', thighR: 'hips', shinR: 'thighR', footR: 'shinR' };

/** Head landmarks from the skin vertices above the neck. */
function headInfo(geo, R, m) {
  const p = geo.attributes.position;
  const skin = REGIONS.indexOf('skin');
  let nose = null, minX = 9, maxX = -9, sumY = 0, sumZ = 0, n = 0;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y < m.neckY + 0.04 || R[i] !== skin) continue;
    const x = p.getX(i), z = p.getZ(i);
    if (Math.abs(x) < 0.05 && (!nose || z > nose.z)) nose = { x, y, z };
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); sumY += y; sumZ += z; n++;
  }
  return { nose, r: (maxX - minX) / 2, cy: sumY / n, cz: sumZ / n };
}
/** Front surface (largest z) of the body near (x, y). */
function surfaceZ(geo, x, y, rad = 0.025) {
  const p = geo.attributes.position;
  let z = -9;
  for (let i = 0; i < p.count; i++) if (Math.abs(p.getX(i) - x) < rad && Math.abs(p.getY(i) - y) < rad) z = Math.max(z, p.getZ(i));
  return z;
}

/** Joint positions (rest pose = the model's T-pose). */
function joints(geo, m) {
  const p = geo.attributes.position;
  const hipY = m.crotch + 0.035;
  const ankleY = 0.1;
  // ankle depth: middle of the boot shaft just above the ankle
  const zs = [];
  for (let i = 0; i < p.count; i++) if (Math.abs(p.getY(i) - 0.16) < 0.02 && Math.abs(Math.abs(p.getX(i)) - m.legX) < 0.06) zs.push(p.getZ(i));
  const az = zs.length ? (Math.min(...zs) + Math.max(...zs)) / 2 : 0;
  // shoulder joint just outside the torso, so the hanging arm clears the body
  const shoulderX = m.torsoW + 0.035, wristX = m.armSpan / 2 - 0.085;
  const J = {
    root: [0, 0, 0], hips: [0, hipY + 0.03, 0], spine: [0, hipY + (m.armY - hipY) * 0.3, 0], chest: [0, hipY + (m.armY - hipY) * 0.68, 0],
    neck: [0, m.neckY - 0.015, 0], head: [0, m.neckY + 0.05, 0],
    thighL: [m.legX, hipY, 0], shinL: [m.legX, (hipY + ankleY) / 2 + 0.01, az * 0.5], footL: [m.legX, ankleY, az],
    thighR: [-m.legX, hipY, 0], shinR: [-m.legX, (hipY + ankleY) / 2 + 0.01, az * 0.5], footR: [-m.legX, ankleY, az],
    upperArmL: [shoulderX, m.armY, 0], forearmL: [(shoulderX + wristX) / 2, m.armY, 0], handL: [wristX, m.armY, 0],
    upperArmR: [-shoulderX, m.armY, 0], forearmR: [-(shoulderX + wristX) / 2, m.armY, 0], handR: [-wristX, m.armY, 0],
  };
  return { J, hipY, ankleY, shoulderX, wristX, az };
}

/** Smooth skin weights: distance to each allowed bone segment, top 4, normalised. */
function skinWeights(geo, J, m, jt) {
  const p = geo.attributes.position;
  const seg = {
    hips: [J.hips, J.spine], spine: [J.spine, J.chest], chest: [J.chest, J.neck], neck: [J.neck, J.head], head: [J.head, [0, J.head[1] + 0.25, 0]],
    upperArmL: [J.upperArmL, J.forearmL], forearmL: [J.forearmL, J.handL], handL: [J.handL, [J.handL[0] + 0.1, J.handL[1], 0]],
    upperArmR: [J.upperArmR, J.forearmR], forearmR: [J.forearmR, J.handR], handR: [J.handR, [J.handR[0] - 0.1, J.handR[1], 0]],
    thighL: [J.thighL, J.shinL], shinL: [J.shinL, J.footL], footL: [J.footL, [J.footL[0], 0.03, jt.az + 0.14]],
    thighR: [J.thighR, J.shinR], shinR: [J.shinR, J.footR], footR: [J.footR, [J.footR[0], 0.03, jt.az + 0.14]],
  };
  const a = new THREE.Vector3(), b = new THREE.Vector3(), v = new THREE.Vector3(), c = new THREE.Vector3(), ab = new THREE.Vector3(), av = new THREE.Vector3();
  const dist = (name) => {
    a.set(...seg[name][0]); b.set(...seg[name][1]);
    ab.copy(b).sub(a); av.copy(v).sub(a);
    const t = Math.min(1, Math.max(0, av.dot(ab) / ab.lengthSq()));
    return c.copy(a).addScaledVector(ab, t).distanceTo(v);
  };
  const si = new Uint16Array(p.count * 4), sw = new Float32Array(p.count * 4);
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i));
    const side = v.x >= 0 ? 'L' : 'R';
    let allowed;
    if (v.y > m.neckY + 0.05) allowed = ['head'];
    else if (v.y > m.neckY - 0.05 && Math.abs(v.x) < jt.shoulderX) allowed = ['neck', 'head', 'chest'];
    else if (Math.abs(v.x) > jt.shoulderX - 0.03 && v.y > m.armY - 0.2 && v.y < m.armY + 0.16) allowed = [`upperArm${side}`, `forearm${side}`, `hand${side}`, 'chest'];
    else if (v.y < jt.hipY - 0.02) allowed = [`thigh${side}`, `shin${side}`, `foot${side}`, 'hips'];
    else allowed = ['hips', 'spine', 'chest', 'neck', `upperArm${side}`, `thigh${side}`];
    // the seat and hips of the overalls follow the pelvis more than the thighs (no ballooning when a leg swings back)
    const boost = (nm) => (nm === 'hips' && v.y > jt.hipY - 0.13 ? 5 : nm === 'chest' && Math.abs(v.x) > jt.shoulderX - 0.03 ? 0.5 : 1);
    const w = allowed.map((nm) => [BONES.indexOf(nm), boost(nm) / (dist(nm) ** 2 + 1e-4) ** 2]).sort((x, y) => y[1] - x[1]).slice(0, 4);
    const sum = w.reduce((s, x) => s + x[1], 0);
    w.forEach(([bi, ww], k) => { si[i * 4 + k] = bi; sw[i * 4 + k] = ww / sum; });
  }
  return { si, sw };
}

/** Eyes, brows and mouth on the face surface (the source model has none). */
function face(geo, hd) {
  const parts = { face: [], brows: [] };
  const n = hd.nose, r = hd.r;
  const ex = r * 0.36, ey = n.y + r * 0.2, er = r * 0.16;
  for (const s of [1, -1]) {
    const x = ex * s;
    const z = surfaceZ(geo, x, ey) - er * 0.35;
    const turn = [0, s * 0.32, 0];
    const fwd = new THREE.Vector3(Math.sin(s * 0.32), 0, Math.cos(s * 0.32));
    const at = (d, dx = 0, dy = 0) => [x + fwd.x * d + dx, ey + dy, z + fwd.z * d];
    parts.face.push(place(blob(er, er * 1.18, er * 0.6, { detail: 3, color: '#ffffff' }), { pos: [x, ey, z], rot: turn }));
    parts.face.push(place(blob(er * 0.62, er * 0.72, er * 0.3, { detail: 3, color: '#3a5a2a' }), { pos: at(er * 0.42, 0, -er * 0.05), rot: turn }));
    parts.face.push(place(blob(er * 0.36, er * 0.42, er * 0.2, { detail: 2, color: '#120a05' }), { pos: at(er * 0.55, 0, -er * 0.05), rot: turn }));
    parts.face.push(place(sphere(er * 0.14, { w: 8, h: 6, color: '#ffffff' }), { pos: at(er * 0.66, er * 0.22, er * 0.2) }));
    // brows follow the hair colour (white base, tinted in the game)
    parts.brows.push(place(roundedBox(er * 1.5, er * 0.32, er * 0.3, er * 0.12, { color: '#ffffff' }), { pos: [x, ey + er * 1.45, surfaceZ(geo, x, ey + er * 1.45) - er * 0.02], rot: [0.1, s * 0.3, -s * 0.12] }));
  }
  const my = n.y - r * 0.33, mz = surfaceZ(geo, 0, my, 0.03) - r * 0.02;
  parts.face.push(place(torus(r * 0.17, r * 0.035, { rs: 6, ts: 16, arc: Math.PI, color: '#7a2a1a' }), { pos: [0, my + r * 0.06, mz], rot: [0.15, 0, Math.PI] }));
  return parts;
}

/** Extra hats (the straw hat is part of the source mesh). White base so the game can tint them. */
function hats(top, r) {
  const H = {};
  const y = top.y, z = top.z;
  H.cap = [place(lathe([[r * 1.02, 0], [r * 1.0, r * 0.25], [r * 0.85, r * 0.55], [r * 0.45, r * 0.75], [0, r * 0.78]], { segs: 22, color: '#ffffff', smooth: 8 }), { pos: [0, y - r * 0.32, z] }),
    place(roundedBox(r * 1.3, r * 0.06, r * 0.9, r * 0.05, { color: '#ffffff' }), { pos: [0, y - r * 0.28, z + r * 1.15], rot: [0.12, 0, 0] })];
  H.bucket = [place(lathe([[r * 1.55, -0.02], [r * 1.42, r * 0.06], [r * 1.05, r * 0.14], [r * 1.0, r * 0.6], [r * 0.9, r * 0.72], [0, r * 0.75]], { segs: 26, color: '#ffffff', smooth: 8 }), { pos: [0, y - r * 0.36, z] })];
  H.cowboy = [place(lathe([[r * 2.0, r * 0.18], [r * 1.85, r * 0.08], [r * 1.1, r * 0.06], [r * 1.0, r * 0.75], [r * 0.6, r * 0.95], [r * 0.25, r * 0.82], [0, r * 0.9]], { segs: 30, color: '#ffffff', smooth: 10 }), { pos: [0, y - r * 0.32, z] }),
    place(cyl(r * 1.02, r * 1.02, r * 0.16, { segs: 26, color: '#d8c8a8' }), { pos: [0, y - r * 0.12, z] })];
  H.beanie = [place(lathe([[r * 1.04, 0], [r * 1.06, r * 0.22], [r * 1.0, r * 0.3], [r * 0.9, r * 0.7], [r * 0.45, r * 1.0], [0, r * 1.05]], { segs: 24, color: '#ffffff', smooth: 10 }), { pos: [0, y - r * 0.45, z] }),
    place(sphere(r * 0.25, { w: 10, h: 8, color: '#ffffff' }), { pos: [0, y + r * 0.62, z] })];
  H.tophat = [place(lathe([[r * 1.5, 0], [r * 1.45, r * 0.06], [r * 0.95, r * 0.08], [r * 0.98, r * 1.4], [r * 0.95, r * 1.5], [0, r * 1.5]], { segs: 26, color: '#ffffff', smooth: 6 }), { pos: [0, y - r * 0.3, z] }),
    place(cyl(r * 0.99, r * 0.97, r * 0.22, { segs: 26, color: '#e04a4a' }), { pos: [0, y - r * 0.08, z] })];
  const crown = [place(cyl(r * 0.9, r * 0.95, r * 0.35, { segs: 24, color: '#ffffff', open: true }), { pos: [0, y - r * 0.05, z] })];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    crown.push(place(cone(r * 0.16, r * 0.42, { segs: 6, color: '#ffffff' }), { pos: [Math.sin(a) * r * 0.9, y + r * 0.32, z + Math.cos(a) * r * 0.9] }));
    crown.push(place(sphere(r * 0.09, { w: 8, h: 6, color: k % 2 ? '#e0304a' : '#3a8aff' }), { pos: [Math.sin(a) * r * 0.97, y + r * 0.02, z + Math.cos(a) * r * 0.97] }));
  }
  H.crown = crown;
  const sun = [place(lathe([[r * 1.7, 0], [r * 1.55, r * 0.05], [r * 1.0, r * 0.12], [r * 0.98, r * 0.62], [0, r * 0.72]], { segs: 28, color: '#ffffff', smooth: 8 }), { pos: [0, y - r * 0.32, z] })];
  // the flower: petals in a ring (built facing +z), tilted up and pinned to the front of the crown
  const flower = [];
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    flower.push(place(blob(r * 0.13, r * 0.3, r * 0.05, { detail: 2, color: k % 2 ? '#FFC233' : '#FFD84A', seed: k }), { pos: [Math.sin(a) * r * 0.36, Math.cos(a) * r * 0.36, 0], rot: [0, 0, -a] }));
  }
  flower.push(place(blob(r * 0.22, r * 0.22, r * 0.09, { detail: 2, color: '#5a3a1a' }), { pos: [0, 0, r * 0.04] }));
  for (const fg of flower) sun.push(place(fg, { pos: [r * 0.55, y + r * 0.12, z + r * 0.95], rot: [-0.35, 0.45, 0] }));
  H.sunflower = sun;
  return H;
}

/** The whole farmer: one skinned model with switchable parts (body regions, face, hats). */
export async function buildFarmer() {
  const { geo, map, sourceTris } = await loadFarmer();
  const m = measure(geo);
  const px = texturePixels(map);
  const R = regions(geo, px, m);
  const hd = headInfo(geo, R, m);
  const jt = joints(geo, m);
  const { J } = jt;
  const bones = {};
  for (const name of BONES) {
    const b = new THREE.Bone(); b.name = name; bones[name] = b;
    const w = new THREE.Vector3(...J[name]);
    if (PARENT[name]) { b.position.copy(w).sub(new THREE.Vector3(...J[PARENT[name]])); bones[PARENT[name]].add(b); } else b.position.copy(w);
  }
  const root = new THREE.Group(); root.name = 'farmer';
  root.add(bones.root);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(BONES.map((n) => bones[n]));
  // texture: 1024 JPEG shared by all body regions
  const tc = document.createElement('canvas'); tc.width = tc.height = 1024;
  tc.getContext('2d').drawImage(map.image, 0, 0, 1024, 1024);
  const tex = new THREE.CanvasTexture(tc);
  tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.userData.mimeType = 'image/jpeg';
  const bodyMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, metalness: 0 });
  bodyMat.name = 'tex_farmer';
  const { si, sw } = skinWeights(geo, J, m, jt);
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  // the source hands are plain balls: remove them (skin at the end of each T-pose arm), real hands are built below
  const pp = geo.attributes.position;
  const ballX = [9, -9];
  const skinSum = 0, skinN = 0, skinPts = [];
  for (let i = 0; i < pp.count; i++) {
    if (R[i] !== REGIONS.indexOf('skin')) continue;
    if (Math.abs(pp.getX(i)) > jt.wristX - 0.03 && Math.abs(pp.getY(i) - m.armY) < 0.14) {
      R[i] = 255;
      ballX[0] = Math.min(ballX[0], Math.abs(pp.getX(i))); ballX[1] = Math.max(ballX[1], Math.abs(pp.getX(i)));
    } else if (Math.abs(pp.getX(i)) > jt.shoulderX + 0.12 && Math.abs(pp.getY(i) - m.armY) < 0.12) skinPts.push(sample(px, geo.attributes.uv.getX(i), geo.attributes.uv.getY(i))); // forearm skin
  }
  skinPts.sort((x, y) => x[0] + x[1] + x[2] - (y[0] + y[1] + y[2]));
  const med = skinPts[Math.floor(skinPts.length / 2)] ?? [0.92, 0.65, 0.42];
  const skinHex = `#${new THREE.Color().setRGB(med[0], med[1], med[2], THREE.SRGBColorSpace).getHexString(THREE.SRGBColorSpace)}`;
  void skinSum; void skinN;
  const ix = geo.index.array;
  let tris = 0;
  const T = triRegions(geo, px, m, R, Math.abs(J.forearmL[0]) + 0.03, ballX[0] - 0.07);
  REGIONS.forEach((reg, ri) => {
    const keep = [];
    for (let t = 0; t < ix.length; t += 3) if (T[t / 3] === ri) keep.push(ix[t], ix[t + 1], ix[t + 2]);
    if (!keep.length) return;
    const g = geo.clone(); g.setIndex(keep);
    const mesh = new THREE.SkinnedMesh(compact(g), bodyMat);
    mesh.name = `farmer_${reg}`;
    // average linear brightness of this region's texture: the game divides by it when recolouring, so a
    // tinted shirt keeps its plaid pattern but comes out in the chosen colour
    const uvA = g.attributes.uv;
    let sum = 0, cnt = 0;
    const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    for (let q = 0; q < keep.length; q += 7) { const [cr, cg, cb] = sample(px, uvA.getX(keep[q]), uvA.getY(keep[q])); sum += 0.2126 * lin(cr) + 0.7152 * lin(cg) + 0.0722 * lin(cb); cnt++; }
    mesh.userData.avgLum = +(sum / Math.max(1, cnt)).toFixed(4);
    root.add(mesh); mesh.bind(skeleton);
    tris += keep.length / 3;
  });
  const addRigid = (name, geos, bone, matName = 'tex_acc') => {
    if (!geos.length) return;
    const g = mergeGeometries(geos.map((x) => finish(x)), false);
    const n = g.attributes.position.count;
    const bi = BONES.indexOf(bone);
    const si2 = new Uint16Array(n * 4), sw2 = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { si2[i * 4] = bi; sw2[i * 4] = 1; }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si2, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw2, 4));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }); mat.name = matName;
    const mesh = new THREE.SkinnedMesh(g, mat); mesh.name = name;
    root.add(mesh); mesh.bind(skeleton);
    tris += triCount(g);
  };
  // hands: palm, four curled fingers and a thumb, in the T-pose (pointing out along x, palm down)
  const hl = Math.max(0.14, (ballX[1] - ballX[0]) * 1.5); // a little bigger than the old ball: friendly cartoon hands
  const parts0 = [];
  for (const [side, s] of [['L', 1], ['R', -1]]) {
    // the wrist: centre and thickness of the arm where the forearm ends (the old ball hand began)
    let cy = 0, cz = 0, cn = 0;
    for (let i = 0; i < pp.count; i++) if (Math.sign(pp.getX(i)) === s && Math.abs(Math.abs(pp.getX(i)) - ballX[0]) < 0.02 && Math.abs(pp.getY(i) - m.armY) < 0.14) { cy += pp.getY(i); cz += pp.getZ(i); cn++; }
    cy = cn ? cy / cn : m.armY; cz = cn ? cz / cn : 0;
    const rs = [];
    for (let i = 0; i < pp.count; i++) if (Math.sign(pp.getX(i)) === s && Math.abs(Math.abs(pp.getX(i)) - (ballX[0] - 0.05)) < 0.025 && Math.abs(pp.getY(i) - cy) < 0.1) rs.push(Math.hypot(pp.getY(i) - cy, pp.getZ(i) - cz));
    rs.sort((x, y) => x - y);
    const wr = Math.min(Math.max(rs.length ? rs[Math.floor(rs.length * 0.6)] : 0.035, 0.022), 0.05); // typical forearm radius there
    const w0 = new THREE.Vector3(s * (ballX[0] - 0.012), cy, cz);
    // a short wrist that overlaps the end of the forearm, so there is never a gap
    // clean forearm: from inside the rolled sleeve (starts at the forearm joint) to the wrist, tapering
    const x0 = J[`forearm${side}`][0], len = Math.abs(w0.x - x0) + 0.02;
    const fore = finish(new THREE.CylinderGeometry(wr * 0.86, wr * 1.08, len, 14, 1, false), new THREE.Color('#ffffff'));
    place(fore, { pos: [(x0 + w0.x) / 2 + s * 0.01, cy, cz], rot: [0, 0, -s * Math.PI / 2] });
    addRigid(`farmer_arm${side}`, [fore], `forearm${side}`);
    root.getObjectByName(`farmer_arm${side}`).userData.defColor = skinHex;
    const parts = [...parts0.splice(0), place(blob(hl * 0.3, hl * 0.13, hl * 0.27, { detail: 3, color: '#ffffff', seed: 3 }), { pos: [w0.x + s * hl * 0.24, w0.y, w0.z] })];
    const up = new THREE.Vector3(0, 1, 0);
    const bone = (from, dir, len, r) => {
      const g = new THREE.CapsuleGeometry(r, len, 3, 8);
      const q = new THREE.Quaternion().setFromUnitVectors(up, dir.clone().normalize());
      const c = from.clone().addScaledVector(dir.clone().normalize(), len / 2);
      parts.push(place(finish(g, new THREE.Color('#ffffff')), { pos: c.toArray(), quat: q }));
      return from.clone().addScaledVector(dir.clone().normalize(), len);
    };
    [[-0.27, 0.86], [-0.09, 1.0], [0.09, 0.95], [0.26, 0.78]].forEach(([dz, L], k) => {
      const base = new THREE.Vector3(w0.x + s * hl * 0.5, w0.y - hl * 0.01, w0.z + dz * hl);
      const curl1 = 0.25 + k * 0.03, curl2 = 0.75;
      const j1 = bone(base, new THREE.Vector3(s * Math.cos(curl1), -Math.sin(curl1), dz * 0.25), hl * 0.26 * L, hl * 0.075);
      bone(j1, new THREE.Vector3(s * Math.cos(curl1 + curl2), -Math.sin(curl1 + curl2), dz * 0.25), hl * 0.2 * L, hl * 0.068);
    });
    const tb = new THREE.Vector3(w0.x + s * hl * 0.18, w0.y - hl * 0.03, w0.z + hl * 0.22);
    const t1 = bone(tb, new THREE.Vector3(s * 0.55, -0.25, 0.8), hl * 0.2, hl * 0.08);
    bone(t1, new THREE.Vector3(s * 0.85, -0.3, 0.45), hl * 0.16, hl * 0.072);
    addRigid(`farmer_hand${side}`, parts, `hand${side}`);
    root.getObjectByName(`farmer_hand${side}`).userData.defColor = skinHex;
  }
  const f = face(geo, hd);
  addRigid('farmer_face', f.face, 'head', 'tex_face');
  addRigid('farmer_brows', f.brows, 'head');
  // head top under the straw hat: highest hair/skin vertex
  const p = geo.attributes.position;
  const top = { y: m.neckY, z: hd.cz };
  for (let i = 0; i < p.count; i++) if ((R[i] === REGIONS.indexOf('hair') || R[i] === REGIONS.indexOf('skin')) && p.getY(i) > top.y) top.y = p.getY(i);
  for (const [id, geos] of Object.entries(hats(top, hd.r))) addRigid(`hat_${id}`, geos, 'head');
  // animations: our human clips with this body's legs, and the T-pose arm fix
  const a = Math.PI / 2 - 0.05;
  const DL = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -a);
  const DR = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a);
  const armFix = {};
  for (const [s, D] of [['L', DL], ['R', DR]]) {
    armFix[`upperArm${s}`] = { root: true, D };
    armFix[`forearm${s}`] = armFix[`hand${s}`] = { D, Dinv: D.clone().invert() };
  }
  const rig = { list: BONES.map((n) => bones[n]), bones, armFix };
  const legs = { thigh: J.thighL[1] - J.shinL[1], shin: J.shinL[1] - J.footL[1], ankle: jt.ankleY, hip: jt.hipY };
  const k = (legs.thigh + legs.shin) / 0.81; // leg length relative to the old gardener
  // brisk walk at 4.4 m/s and a run at 7.8 m/s (the client scales playback to the real ground speed)
  const walkStride = 2.0 * k, runStride = 3.2 * k;
  const animations = humanClips(rig, legs, {
    walk: { stride: walkStride, dur: walkStride / 4.4, duty: 0.56, land: 0.45 * k, lift: 0.14 * k, crouch: 0.06 * k, lean: 0.08, arm: 0.5, elbow: 0.3 },
    run: { stride: runStride, dur: runStride / 7.8, land: 0.32 * k, lift: 0.34 * k, crouch: 0.09 * k },
  });
  const info = { sourceTris, tris: Math.round(tris), m, hd, legs, k, top, credit: FARMER_CREDIT };
  root.userData.info = info;
  return { id: 'farmer', root, animations, tris: Math.round(tris), info };
}
