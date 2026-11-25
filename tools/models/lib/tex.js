// Procedural textures drawn on canvas (runs in the browser). Each returns {color, normal} canvases.
// Color maps are light and mostly neutral: vertex colors carry each crop's hue, maps add detail.
import { rand } from './geo.js';

const mk = (s) => { const c = document.createElement('canvas'); c.width = c.height = s; return c; };

/** Value noise in [0,1], tileable. */
function noise2(seed, size = 64) {
  const r = rand(seed);
  const g = Array.from({ length: size * size }, () => r());
  const at = (x, y) => g[((y % size + size) % size) * size + ((x % size + size) % size)];
  const sm = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = sm(x - xi), yf = sm(y - yi);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
}
function fbm(n, x, y, oct = 4) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += a * n(x * f, y * f); a *= 0.5; f *= 2; } return s; }

/** Build a normal map canvas from a height function sampled on the same grid. */
function normalFrom(height, size, strength = 2) {
  const c = mk(size), ctx = c.getContext('2d'), img = ctx.createImageData(size, size);
  const h = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (h(x + 1, y) - h(x - 1, y)) * strength, dy = (h(x, y + 1) - h(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    const i = (y * size + x) * 4;
    img.data[i] = ((-dx / l) * 0.5 + 0.5) * 255;
    img.data[i + 1] = ((dy / l) * 0.5 + 0.5) * 255;
    img.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function fromFn(size, seed, fn, normalStrength = 2) {
  const c = mk(size), ctx = c.getContext('2d'), img = ctx.createImageData(size, size);
  const height = new Float32Array(size * size);
  const n = noise2(seed, 64);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const [r, g, b, hgt] = fn(x / size, y / size, n);
    const i = (y * size + x) * 4;
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    height[y * size + x] = hgt;
  }
  ctx.putImageData(img, 0, 0);
  return { color: c, normal: normalFrom(height, size, normalStrength) };
}

const clamp255 = (v) => Math.max(0, Math.min(255, v));
const gray = (v, tint = [1, 1, 1]) => [clamp255(v * 255 * tint[0]), clamp255(v * 255 * tint[1]), clamp255(v * 255 * tint[2])];

/** Leaf: midrib down the centre (u = 0.5), lateral veins angled toward the tip, fine cell noise. */
export const leaf = (size = 512) => fromFn(size, 11, (u, v, n) => {
  const dx = Math.abs(u - 0.5);
  const mid = Math.exp(-((dx / 0.012) ** 2));
  const lateral = Math.abs(Math.sin((v - dx * 0.9) * 46)) ** 18 * (1 - dx * 1.6);
  const vein = Math.max(mid, lateral * 0.55);
  const cell = fbm(n, u * 40, v * 40, 3);
  const base = 0.86 + cell * 0.1 - vein * 0.0;
  const light = base + vein * 0.12;
  return [...gray(light, [0.98, 1, 0.96]), -vein * 0.8 + cell * 0.15];
}, 3);

export const bark = (size = 512) => fromFn(size, 23, (u, v, n) => {
  const ridges = Math.abs(Math.sin(u * 28 + fbm(n, u * 6, v * 2) * 6)) ** 0.6;
  const cracks = fbm(n, u * 18, v * 5, 4);
  const h = ridges * 0.7 + cracks * 0.5;
  const b = 0.55 + h * 0.35;
  return [...gray(b, [1, 0.92, 0.82]), h];
}, 4);

/** Dirt plate: studs again, with darker and lighter bricks so planting spots read clearly. */
export const soil = (size = 512) => fromFn(size, 31, (u, v, n) => {
  const N = 4;
  const fu = (u * N) % 1 - 0.5, fv = (v * N) % 1 - 0.5;
  const d = Math.hypot(fu, fv);
  const stud = d < 0.28 ? 1 : 0;
  const cell = fbm(n, Math.floor(u * N) * 3.1, Math.floor(v * N) * 3.1, 2);
  const b = 0.84 + cell * 0.14 + stud * 0.08;
  return [...gray(b, [1, 0.95, 0.9]), stud * 0.8];
}, 3);

/** Plastic planks: broad boards with a dark seam, no grain. */
export const wood = (size = 512) => fromFn(size, 41, (u, v) => {
  const plank = Math.floor(v * 4);
  const seam = Math.abs(((v * 4) % 1) - 0.5) > 0.47 ? 0 : 1;
  const b = (0.92 + (plank % 2) * 0.06) * (seam ? 1 : 0.62);
  return [...gray(b, [1, 1, 1]), seam * 0.5];
}, 2);

export const stone = (size = 512) => fromFn(size, 53, (u, v, n) => {
  const f = fbm(n, u * 10, v * 10, 5);
  const speck = fbm(n, u * 80, v * 80, 2) > 0.62 ? 0.06 : 0;
  const b = 0.68 + f * 0.25 + speck;
  return [...gray(b, [0.98, 0.97, 0.95]), f];
}, 3);

/** Plaza bricks: big square plates with a dark gap and a bevel. */
export const paving = (size = 512) => fromFn(size, 59, (u, v) => {
  const tile = 4;
  const tu = (u * tile) % 1, tv = (v * tile) % 1;
  const edge = Math.min(tu, 1 - tu, tv, 1 - tv);
  const gap = edge < 0.03 ? 0 : 1;
  const bevel = edge < 0.08 ? 0.93 : 1;
  const id = Math.floor(u * tile) * 5 + Math.floor(v * tile) * 3;
  const tint = 0.96 + ((id * 17) % 5) / 100;
  return [...gray(gap ? bevel * tint : 0.45, [1, 1, 1]), gap * Math.min(1, edge * 14)];
}, 3);

export const fabric = (size = 256) => fromFn(size, 61, (u, v) => {
  const w = (Math.sin(u * 220) * Math.sin(v * 220)) * 0.5 + 0.5;
  return [...gray(0.9 + w * 0.08), w * 0.3];
}, 1.5);

export const petal = (size = 256) => fromFn(size, 67, (u, v, n) => {
  const veins = Math.abs(Math.sin((u - 0.5) * 40 / (0.3 + v))) ** 6 * 0.25;
  const b = 0.9 + fbm(n, u * 8, v * 8, 2) * 0.08 - veins * 0.1 + v * 0.04;
  return [...gray(b), -veins];
}, 1.2);

export const skin = (size = 256) => fromFn(size, 71, (u, v, n) => {
  const pores = fbm(n, u * 90, v * 90, 2);
  const speck = fbm(n, u * 140 + 3, v * 140, 1) > 0.7 ? -0.06 : 0;
  return [...gray(0.92 + pores * 0.07 + speck), pores * 0.4];
}, 1.2);

/** Roblox baseplate: a grid of round studs (8 x 8 per tile), flat plastic between them. */
export const grass = (size = 512) => fromFn(size, 83, (u, v) => {
  const N = 8;
  const fu = (u * N) % 1 - 0.5, fv = (v * N) % 1 - 0.5;
  const d = Math.hypot(fu, fv);
  const stud = d < 0.3 ? 1 : 0;
  const rim = d < 0.3 ? Math.min(1, (0.3 - d) / 0.05) : 0;
  const b = 0.9 + stud * 0.1 + (stud && fu + fv < -0.15 ? -0.06 : 0);
  return [...gray(b, [1, 1, 1]), rim * 0.9];
}, 3.5);

export const fur = (size = 256) => fromFn(size, 89, (u, v, n) => {
  const strands = fbm(n, u * 140, v * 20, 3);
  return [...gray(0.82 + strands * 0.18), strands];
}, 1.6);

/** Alpha-tested foliage atlas: a clump of painted leaves (for canopy cards). */
function clump(size, seed, drawOne) {
  const c = mk(size), ctx = c.getContext('2d');
  const r = rand(seed);
  ctx.clearRect(0, 0, size, size);
  const n = 46;
  for (let i = 0; i < n; i++) {
    const ang = r() * Math.PI * 2, rad = Math.sqrt(r()) * size * 0.38;
    const x = size / 2 + Math.cos(ang) * rad, y = size / 2 + Math.sin(ang) * rad * 0.9;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang + Math.PI / 2 + (r() - 0.5) * 1.2);
    drawOne(ctx, r, size, 1 - rad / (size * 0.5));
    ctx.restore();
  }
  const height = new Float32Array(size * size);
  const d = ctx.getImageData(0, 0, size, size).data;
  for (let i = 0; i < size * size; i++) height[i] = d[i * 4 + 3] / 255 * (d[i * 4 + 1] / 255);
  return { color: c, normal: normalFrom(height, size, 2) };
}

export const foliage = (size = 512) => clump(size, 97, (ctx, r, s, centre) => {
  const L = s * (0.09 + r() * 0.05), W = L * 0.42;
  const shade = Math.floor(150 + centre * 70 + r() * 30);
  const g = ctx.createLinearGradient(0, -L / 2, 0, L / 2);
  g.addColorStop(0, `rgb(${shade - 25},${shade},${shade - 40})`);
  g.addColorStop(1, `rgb(${shade + 10},${shade + 30},${shade - 20})`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, -L / 2);
  ctx.quadraticCurveTo(W, -L * 0.1, 0, L / 2);
  ctx.quadraticCurveTo(-W, -L * 0.1, 0, -L / 2);
  ctx.fill();
  ctx.strokeStyle = `rgba(255,255,230,0.35)`;
  ctx.lineWidth = Math.max(1, s / 400);
  ctx.beginPath(); ctx.moveTo(0, -L / 2); ctx.lineTo(0, L / 2); ctx.stroke();
});

export const blossoms = (size = 512) => clump(size, 101, (ctx, r, s, centre) => {
  const R = s * (0.03 + r() * 0.015);
  const shade = Math.floor(205 + centre * 40 + r() * 10);
  for (let k = 0; k < 5; k++) {
    ctx.save();
    ctx.rotate((k / 5) * Math.PI * 2);
    ctx.fillStyle = `rgb(${shade},${shade - 8},${shade - 4})`;
    ctx.beginPath();
    ctx.ellipse(0, -R * 0.75, R * 0.5, R * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = 'rgb(255,214,120)';
  ctx.beginPath(); ctx.arc(0, 0, R * 0.22, 0, Math.PI * 2); ctx.fill();
});

export const ALL = { foliage, blossoms, leaf, bark, soil, wood, stone, paving, fabric, petal, skin, grass, fur };
