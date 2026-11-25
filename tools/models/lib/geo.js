// Geometry building blocks for the procedural model generators (runs in the browser).
// Every helper returns a non-indexed-or-indexed BufferGeometry with position, normal, uv and color.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const V3 = THREE.Vector3;
export const TAU = Math.PI * 2;
export const GOLDEN = 137.507764 * (Math.PI / 180);

/** Seeded random for generators (so models are reproducible). */
export function rand(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const hashStr = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

/** Roblox look: every shape is a block, shading is flat, colours are bright plastic. */
export const STYLE = { blocky: true, pop: 1.14 };
export const col = (hex) => {
  const c = new THREE.Color(hex);
  if (!STYLE.pop) return c;
  const h = {};
  c.getHSL(h);
  return c.setHSL(h.h, Math.min(1, h.s * STYLE.pop), h.l);
};
export function jitter(c, r, amt = 0.06) {
  const out = c.clone();
  const hsl = {};
  out.getHSL(hsl);
  out.setHSL((hsl.h + (r() - 0.5) * amt * 0.3 + 1) % 1, Math.min(1, Math.max(0, hsl.s + (r() - 0.5) * amt)), Math.min(1, Math.max(0, hsl.l + (r() - 0.5) * amt)));
  return out;
}

/** Ensure uv and color attributes exist, paint a flat color if none. */
export function finish(geo, color = null) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  if (STYLE.blocky || !g.attributes.normal) { g.deleteAttribute('normal'); g.computeVertexNormals(); } // non-indexed: one normal per face = flat shading
  if (!g.attributes.color) {
    const c = color ?? new THREE.Color(1, 1, 1);
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
  }
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  return g;
}

/** Paint vertex colors with a function of (position, normal) -> Color. */
export function paint(geo, fn) {
  const p = geo.attributes.position, nrm = geo.attributes.normal, c = geo.attributes.color;
  const v = new V3(), nv = new V3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    nv.fromBufferAttribute(nrm, i);
    const out = fn(v, nv, i);
    c.setXYZ(i, out.r, out.g, out.b);
  }
  c.needsUpdate = true;
  return geo;
}

/** Darken toward the ground and in crevices: cheap baked ambient occlusion. */
export function bakeAO(geo, { floor = 0, height = 1, strength = 0.45, center = null, radius = 1, inner = 0.25 } = {}) {
  const p = geo.attributes.position, c = geo.attributes.color;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    let k = 1 - strength * Math.max(0, Math.min(1, 1 - (y - floor) / height)) ** 2;
    if (center) {
      const d = Math.hypot(p.getX(i) - center.x, p.getY(i) - center.y, p.getZ(i) - center.z) / radius;
      k *= 1 - inner * Math.max(0, 1 - d);
    }
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
  c.needsUpdate = true;
  return geo;
}

export function merge(list) {
  const geos = list.filter(Boolean).map((g) => finish(g));
  if (!geos.length) return null;
  const m = mergeGeometries(geos, false);
  m.computeBoundingSphere();
  return m;
}

export const place = (geo, { pos = [0, 0, 0], rot = [0, 0, 0], quat = null, scale = 1 } = {}) => {
  const m = new THREE.Matrix4();
  const q = quat ?? new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'YXZ'));
  const s = typeof scale === 'number' ? new V3(scale, scale, scale) : new V3(...scale);
  m.compose(new V3(...pos), q, s);
  geo.applyMatrix4(m);
  return geo;
};

/** Quaternion that turns +Y toward `dir`, then rolls around it. */
export function aim(dir, roll = 0) {
  const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), dir.clone().normalize());
  if (roll) q.multiply(new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), roll));
  return q;
}

// ---- Leaves ------------------------------------------------------------------

const SHAPES = {
  lanceolate: (v) => Math.sin(Math.PI * Math.min(1, v * 1.05)) ** 0.75 * (1 - 0.25 * v),
  ovate: (v) => Math.sin(Math.PI * v ** 0.72) ** 0.9,
  elliptic: (v) => Math.sin(Math.PI * v) ** 0.85,
  heart: (v) => (v < 0.18 ? 0.55 + 2.5 * v : Math.sin(Math.PI * (0.18 + (v - 0.18) * 0.98)) ** 0.7),
  needle: (v) => 0.25 * (1 - v) + 0.05,
  paddle: (v) => Math.min(1, v * 7) * Math.min(1, (1 - v) * 5) ** 0.6,
  strap: (v) => Math.min(1, v * 10) * (1 - v * 0.7) ** 0.5,
  round: (v) => Math.sin(Math.PI * v) ** 0.6,
  lobed: (v) => (Math.sin(Math.PI * v ** 0.8) ** 0.7) * (0.55 + 0.45 * Math.abs(Math.cos(v * Math.PI * 2.5))),
};

/**
 * A curved leaf blade. Grows along +Y, width along X, upper face toward +Z.
 * fold: V-fold along the midrib. droop: bends the tip toward -Z. twist: rotates along length.
 */
export function leafBlade({ len = 1, wid = 0.4, shape = 'ovate', fold = 0.25, droop = 0.4, curl = 0, twist = 0, serr = 0, teeth = 10, seg = 9, wseg = 4, color = '#4f8f3a', tip = '#79b04f', seed = 1, ruffle = 0 } = {}) {
  if (STYLE.blocky) { seg = Math.min(seg, 3); wseg = 1; }
  const r = rand(seed);
  const pos = [], uv = [], colr = [], idx = [];
  const base = col(color), tipC = col(tip);
  const wf = SHAPES[shape] ?? SHAPES.ovate;
  for (let j = 0; j <= seg; j++) {
    const v = j / seg;
    let w = wf(v);
    if (serr) w *= 1 - serr * Math.abs(Math.sin(v * teeth * Math.PI));
    const ang = droop * v * v * 1.6;
    const cy = Math.sin(Math.PI / 2 - ang * 0.5) * v * len;
    const cz = -Math.sin(ang * 0.5) * v * len * 1.1;
    const tw = twist * v;
    for (let i = 0; i <= wseg * 2; i++) {
      const u = i / wseg - 1; // -1..1
      const x = u * w * wid * 0.5;
      const lift = Math.abs(u) * fold * w * wid * 0.5 + (curl * u * u * w * wid * 0.35) + ruffle * Math.sin(v * 17 + u * 3) * 0.02 * wid;
      const xt = x * Math.cos(tw), zt = x * Math.sin(tw);
      pos.push(xt, cy, cz + lift + zt);
      uv.push((u + 1) / 2, v);
      const c = base.clone().lerp(tipC, v * 0.8).multiplyScalar(0.92 + 0.12 * (1 - Math.abs(u)) + (r() - 0.5) * 0.04);
      colr.push(c.r, c.g, c.b);
    }
  }
  const row = wseg * 2 + 1;
  for (let j = 0; j < seg; j++) for (let i = 0; i < wseg * 2; i++) {
    const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

// ---- Stems, trunks, tubes ----------------------------------------------------

/** Tapered tube along a curve. points: Vector3[]; r0 at start, r1 at end. */
export function stem(points, r0 = 0.03, r1 = 0.015, { radial = 6, segs = null, color = '#5e8f3a', color2 = null, bark = false, seed = 3 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points);
  if (STYLE.blocky) { radial = 4; segs = Math.max(2, Math.min(segs ?? 99, points.length + 1)); r0 *= 1.18; r1 *= 1.18; }
  const n = segs ?? Math.max(3, points.length * 3);
  const frames = curve.computeFrenetFrames(n, false);
  const pos = [], uv = [], colr = [], idx = [];
  const c0 = col(color), c1 = col(color2 ?? color);
  const r = rand(seed);
  for (let j = 0; j <= n; j++) {
    const t = j / n;
    const p = curve.getPointAt(t);
    const rad = r0 + (r1 - r0) * t;
    for (let i = 0; i <= radial; i++) {
      const a = (i / radial) * TAU;
      const nrm = frames.normals[j].clone().multiplyScalar(Math.cos(a)).add(frames.binormals[j].clone().multiplyScalar(Math.sin(a)));
      const bump = bark ? 1 + 0.08 * Math.sin(a * 5 + t * 9) * (0.6 + r() * 0.4) : 1;
      pos.push(p.x + nrm.x * rad * bump, p.y + nrm.y * rad * bump, p.z + nrm.z * rad * bump);
      uv.push(i / radial, t * curve.getLength() * 2);
      const c = c0.clone().lerp(c1, t);
      colr.push(c.r, c.g, c.b);
    }
  }
  const row = radial + 1;
  for (let j = 0; j < n; j++) for (let i = 0; i < radial; i++) {
    const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

/** Points along a gently curving path from `start` in `dir` with length `len`. */
export function path(start, dir, len, { bend = 0.2, steps = 4, side = new V3(1, 0, 0), gravity = 0 } = {}) {
  const pts = [start.clone()];
  const d = dir.clone().normalize();
  let p = start.clone();
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const dd = d.clone().add(side.clone().multiplyScalar(bend * t)).add(new V3(0, -gravity * t * t, 0)).normalize();
    p = p.clone().add(dd.multiplyScalar(len / steps));
    pts.push(p);
  }
  return pts;
}

// ---- Fruit and round shapes ---------------------------------------------------

/**
 * Lathe a profile into a solid with optional ribs and bumps.
 * profile: [[radius, y], ...] from bottom to top.
 */
export function lathe(profile, { segs = 16, ribs = 0, ribDepth = 0.08, bumps = 0, color = '#d33', color2 = null, stripes = 0, stripeColor = null, seed = 7, smooth = 18 } = {}) {
  // resample the profile along a smooth spline so fruit outlines are round, not faceted
  let pts;
  if (STYLE.blocky) { pts = profile.map(([x, y]) => new THREE.Vector2(Math.max(0.0005, x), y)); segs = Math.min(segs, ribs ? 8 : 8); }
  else {
    const spline = new THREE.SplineCurve(profile.map(([x, y]) => new THREE.Vector2(x, y)));
    pts = spline.getPoints(Math.max(profile.length, smooth)).map((v) => new THREE.Vector2(Math.max(0.0005, v.x), v.y));
    pts[0].x = Math.max(0.0005, profile[0][0]); pts[pts.length - 1].x = Math.max(0.0005, profile[profile.length - 1][0]);
  }
  const g = new THREE.LatheGeometry(pts, segs);
  const p = g.attributes.position;
  const r = rand(seed);
  const ys = profile.map((q) => q[1]);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const colors = new Float32Array(p.count * 3);
  const c0 = col(color), c1 = col(color2 ?? color), cs = stripeColor ? col(stripeColor) : null;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    let k = 1;
    if (ribs) k -= ribDepth * (1 - Math.abs(Math.cos((a * ribs) / 2))) ** 1.5;
    if (bumps) k += bumps * (r() - 0.5);
    p.setXYZ(i, x * k, y, z * k);
    const t = (y - y0) / (y1 - y0 || 1);
    let c = c0.clone().lerp(c1, t);
    if (cs && stripes) {
      const s = Math.abs(Math.sin(a * stripes + Math.sin(t * 9) * 0.5));
      c = c.lerp(cs, s > 0.72 ? 0.85 : 0);
    }
    if (ribs) c.multiplyScalar(0.9 + 0.1 * Math.abs(Math.cos((a * ribs) / 2)));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

/** Ellipsoid with optional noise displacement (rocks, berries, heads). */
export function blob(rx, ry, rz, { detail = 2, noise = 0, color = '#888', seed = 5, flatBottom = false } = {}) {
  if (STYLE.blocky) return finish(new THREE.BoxGeometry(rx * 2, ry * 2, rz * 2), col(color));
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const r = rand(seed);
  const offs = Array.from({ length: 6 }, () => [r() * TAU, r() * TAU, 1 + r() * 2]);
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let k = 1;
    if (noise) for (const [a, b, f] of offs) k += (noise / offs.length) * Math.sin(x * f * 3 + a) * Math.cos(z * f * 3 + b + y * 2);
    x *= rx * k; y *= ry * k; z *= rz * k;
    if (flatBottom && y < 0) y *= 0.35;
    p.setXYZ(i, x, y, z);
  }
  // weld the faces so normals are shared: smooth, round shading instead of facets
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const w = mergeVertices(g, 1e-6);
  w.computeVertexNormals();
  return finish(w, col(color));
}

export const cyl = (rt, rb, h, { segs = 10, color = '#888', open = false } = {}) =>
  finish(new THREE.CylinderGeometry(rt, rb, h, STYLE.blocky ? Math.min(segs, 8) : segs, 1, open), col(color));
export const box = (w, h, d, { color = '#888' } = {}) => finish(new THREE.BoxGeometry(w, h, d), col(color));
export const sphere = (rad, { w = 12, h = 8, color = '#888' } = {}) => finish(STYLE.blocky ? new THREE.BoxGeometry(rad * 1.75, rad * 1.75, rad * 1.75) : new THREE.SphereGeometry(rad, w, h), col(color));
export const cone = (rad, h, { segs = 10, color = '#888' } = {}) => finish(new THREE.ConeGeometry(rad, h, STYLE.blocky ? Math.min(segs, 6) : segs), col(color));
export const torus = (R, r, { rs = 6, ts = 16, arc = TAU, color = '#888' } = {}) => finish(STYLE.blocky ? new THREE.TorusGeometry(R, r, 4, Math.min(ts, 8), arc) : new THREE.TorusGeometry(R, r, rs, ts, arc), col(color));

/** Rounded box via a lathe-free approach: box with bevel using ExtrudeGeometry. */
export function roundedBox(w, h, d, rad = 0.05, { color = '#888', segs = 2 } = {}) {
  if (STYLE.blocky) { rad = Math.min(rad, 0.03, Math.min(w, h, d) * 0.2); segs = 1; if (rad < 0.006) return box(w, h, d, { color }); }
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + rad, y);
  s.lineTo(x + w - rad, y); s.quadraticCurveTo(x + w, y, x + w, y + rad);
  s.lineTo(x + w, y + h - rad); s.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  s.lineTo(x + rad, y + h); s.quadraticCurveTo(x, y + h, x, y + h - rad);
  s.lineTo(x, y + rad); s.quadraticCurveTo(x, y, x + rad, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: d - rad * 2, bevelEnabled: true, bevelSize: rad, bevelThickness: rad, bevelSegments: segs, curveSegments: segs });
  g.translate(0, 0, -(d - rad * 2) / 2);
  g.computeVertexNormals();
  return finish(g, col(color));
}

/**
 * Foliage card cluster: three crossed quads using the alpha-tested foliage atlas.
 * Gives dense canopies for a few triangles. Tint comes from vertex colors.
 */
export function cards(size, { color = '#4f8f3a', color2 = null, seed = 1, n = 3, tilt = 0.25 } = {}) {
  const r = rand(seed);
  const list = [];
  if (STYLE.blocky) {
    // a clump of leafy cubes (Roblox "leaf blocks"); lighter ones on top
    const count = n + 1;
    for (let i = 0; i < count; i++) {
      const k = i === 0 ? 0.5 : 0.28 + r() * 0.14;
      const g = new THREE.BoxGeometry(size * k, size * k * 0.82, size * k);
      const c = col(color).lerp(col(color2 ?? color), i / count + r() * 0.25);
      g.rotateY(r() * Math.PI / 2);
      if (i) g.translate((r() - 0.5) * size * 0.6, (r() - 0.3) * size * 0.4 + size * 0.1, (r() - 0.5) * size * 0.6);
      list.push(finish(g, jitter(c, r, 0.07)));
    }
    return mergeGeometries(list, false);
  }
  for (let i = 0; i < n; i++) {
    const g = new THREE.PlaneGeometry(size, size * 0.85, 2, 2);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) p.setZ(k, (Math.abs(p.getX(k)) + Math.abs(p.getY(k))) * -0.18 * size);
    g.computeVertexNormals();
    const c = col(color).lerp(col(color2 ?? color), r());
    g.rotateY((i / n) * Math.PI + r() * 0.3);
    g.rotateX((r() - 0.5) * tilt * 2);
    // cheap "canopy" normals: point outward so lighting reads as a round clump
    const nrm = g.attributes.normal, pos = g.attributes.position;
    for (let k = 0; k < nrm.count; k++) {
      const v = new V3(pos.getX(k), pos.getY(k) + size * 0.25, pos.getZ(k)).normalize();
      nrm.setXYZ(k, v.x, v.y, v.z);
    }
    list.push(finish(g, jitter(c, r, 0.08)));
  }
  return mergeGeometries(list, false);
}

export const triCount = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
