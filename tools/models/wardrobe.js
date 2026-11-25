// The wardrobe: every item here has its own shape (and often its own printed fabric), inspired by the Mihao
// meme pictures. All designs are original: no brands, logos or other people's characters.
// Mesh names are what the client switches by: hat_<model>[__print], fit_<slot>_<model>__<part>, beard_<style>.
import * as THREE from 'three';
import { V3, TAU, place, roundedBox } from './lib/geo.js';

const GOLD = '#E8B53A', RED = '#C41E27', DARK = '#1A181D', WHITE = '#F4F1EA', CREAM = '#E9D6B8', NAVY = '#1F2A4D';

/** kit: { add, smoothGeo, roundGeo, lock, HEAD } from mihao.js */
export function buildWardrobe(rig, kit) {
  const { add, smoothGeo, roundGeo, lock, HEAD } = kit;
  const B = (slot, bone, w, h, d, color, pos, rot = [0, 0, 0]) => rig.part(slot, place(roundedBox(w, h, d, 0.02, { color }), { pos, rot }), bone);
  const round = (slot, bone, r, pos, color, n = 2.4, rot = [0, 0, 0]) => { const small = Math.max(...r) < 0.08; add(rig, slot, bone, smoothGeo(place(roundGeo(r[0], r[1], r[2], n, small ? 8 : 14, small ? 6 : 10), { pos, rot }), color)); };
  const flatShape = (slot, bone, pts, depth, color, pos, rot = [0, 0, 0]) => {
    const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
    g.translate(0, 0, -depth / 2);
    rig.part(slot, place(withColor(g, color), { pos, rot }), bone);
  };
  const withColor = (g, color) => {
    const out = g.index ? g.toNonIndexed() : g;
    const c = new THREE.Color(color), n = out.attributes.position.count, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
    out.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return out;
  };

  // ---- printed fabrics, painted on canvases ------------------------------------------------------
  const prints = {};
  const print = (name, draw) => {
    const c = document.createElement('canvas');
    c.width = c.height = 128; // fabrics are small on screen
    const g = c.getContext('2d');
    g.scale(0.5, 0.5);
    draw(g);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.userData.mimeType = 'image/jpeg';
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, map: t, roughness: 0.9 });
    m.name = `tex_print_${name}`;
    prints[name] = m;
  };
  const wrapped = (g, x, y, fn) => { for (const dx of [-256, 0, 256]) for (const dy of [-256, 0, 256]) { g.save(); g.translate(x + dx, y + dy); fn(); g.restore(); } };
  const base = (g, color) => { g.fillStyle = color; g.fillRect(0, 0, 256, 256); };
  const blob = (g, pts, color) => { g.fillStyle = color; g.beginPath(); pts.forEach(([x, y], i) => g[i ? 'lineTo' : 'moveTo'](x, y)); g.closePath(); g.fill(); };
  const dot = (g, x, y, rx, ry, color, a = 0) => { g.fillStyle = color; g.beginPath(); g.ellipse(x, y, rx, ry, a, 0, TAU); g.fill(); };
  const pawPrint = (g, color) => { dot(g, 0, 10, 20, 16, color); for (const [x, y] of [[-24, -10], [-9, -24], [9, -24], [24, -10]]) dot(g, x, y, 8, 10, color); };
  const ghost = (g) => {
    g.fillStyle = '#FFFFFF'; g.beginPath(); g.arc(0, -4, 22, Math.PI, 0); g.lineTo(22, 26);
    for (let i = 0; i < 4; i++) g.quadraticCurveTo(16 - i * 11, i % 2 ? 30 : 14, 11 - i * 11, 24);
    g.closePath(); g.fill();
    dot(g, -8, -4, 4, 5, '#3A2A55'); dot(g, 8, -4, 4, 5, '#3A2A55');
  };
  print('ghost', (g) => { base(g, '#9C86D8'); for (const [x, y] of [[50, 54], [178, 40], [112, 146], [236, 160], [44, 214], [178, 232]]) wrapped(g, x, y, () => ghost(g)); });
  print('lime', (g) => {
    base(g, '#9BDB23');
    for (const [x, y, c] of [[20, 30, '#2F8A22'], [130, 8, '#4FB224'], [200, 110, '#2F8A22'], [60, 130, '#D6F54A'], [120, 200, '#2F8A22'], [10, 220, '#4FB224']]) wrapped(g, x, y, () => blob(g, [[0, 0], [70, 14], [38, 28], [96, 52], [30, 46], [52, 76], [0, 44]], c));
  });
  print('stripes', (g) => { base(g, '#F1EEE4'); g.fillStyle = '#25386B'; for (let y = 10; y < 256; y += 64) g.fillRect(0, y, 256, 30); });
  print('aloha', (g) => {
    base(g, '#EE6A1F');
    for (const [x, y] of [[40, 50], [170, 90], [90, 180], [222, 220]]) wrapped(g, x, y, () => { for (let i = 0; i < 5; i++) dot(g, Math.cos((i / 5) * TAU) * 19, Math.sin((i / 5) * TAU) * 19, 18, 12, '#FFE9BE', (i / 5) * TAU); dot(g, 0, 0, 9, 9, '#C8202A'); });
    for (const [x, y, a] of [[120, 40, 0.5], [30, 130, -0.7], [180, 170, 1.2], [140, 240, -0.2]]) wrapped(g, x, y, () => { for (let i = -2; i <= 2; i++) dot(g, 0, 0, 36, 5, '#2E6B3A', a + i * 0.42); });
  });
  print('shadow', (g) => { base(g, '#1B1920'); for (const [x, y] of [[64, 70], [196, 186]]) wrapped(g, x, y, () => { g.scale(1.25, 1.25); g.rotate(-0.35); g.save(); g.scale(1.22, 1.22); pawPrint(g, '#F4F1EA'); g.restore(); pawPrint(g, '#C41E27'); }); });
  print('bluecamo', (g) => { base(g, '#25397E'); camoSpots(g, ['#3F6FC8', '#10193C', '#7FB2F2']); });
  print('greencamo', (g) => { base(g, '#5C6B3A'); camoSpots(g, ['#7E8A4E', '#2F3A22', '#A89A68']); });
  function camoSpots(g, colors) {
    let a = 9;
    const r = () => (a = (a * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 42; i++) { const x = r() * 256, y = r() * 256, c = colors[i % 3]; const pts = Array.from({ length: 7 }, (_, k) => { const q = 12 + r() * 24; return [Math.cos((k / 7) * TAU) * q * 1.4, Math.sin((k / 7) * TAU) * q * 0.8]; }); wrapped(g, x, y, () => blob(g, pts, c)); }
  }
  print('denim', (g) => { base(g, '#3D66A8'); for (let i = 0; i < 2600; i++) { g.fillStyle = i % 2 ? 'rgba(255,255,255,.14)' : 'rgba(10,20,60,.18)'; g.fillRect((i * 97) % 256, (i * 57) % 256, 2, 5); } });
  print('pyjama', (g) => { base(g, '#F6C9DA'); for (const [x, y] of [[48, 56], [176, 60], [112, 172], [240, 176]]) wrapped(g, x, y, () => { g.scale(0.7, 0.7); pawPrint(g, '#FFFFFF'); }); });

  /** A block whose printed fabric keeps the same pattern size on every face. */
  const cloth = (slot, name, bone, w, h, d, pos) => {
    rig.mats[slot] = prints[name];
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv;
    const sizes = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let i = 0; i < uv.count; i++) { const [a, b] = sizes[(i / 4) | 0]; uv.setXY(i, (uv.getX(i) * a) / 0.34 + pos[0], (uv.getY(i) * b) / 0.34 + pos[1]); }
    add(rig, slot, bone, smoothGeo(place(g, { pos })));
  };

  const sides = [[1, 'L'], [-1, 'R']];
  /** The jacket shape shared by tops: fabric is {print} or {color}. sleeves: 'long' | 'short'. */
  function top(model, fabric, { sleeves = 'long', cuff = null, collar = null, hem = null } = {}) {
    const main = `fit_shirt_${model}__main`, trim = `fit_shirt_${model}__trim`;
    const part = (bone, w, h, d, pos) => (fabric.print ? cloth(main, fabric.print, bone, w, h, d, pos) : B(main, bone, w, h, d, fabric.color, pos));
    part('chest', 0.645, 0.385, 0.345, [0, 1.27, 0]);
    part('spine', 0.66, 0.3, 0.365, [0, 0.95, 0]);
    part('neck', 0.36, 0.062, 0.28, [0, 1.477, 0]);
    for (const [s, side] of sides) {
      const x = 0.445 * s;
      part(`upperArm${side}`, 0.256, 0.345, 0.256, [x, 1.29, 0]);
      if (sleeves === 'long') part(`forearm${side}`, 0.26, 0.232, 0.26, [x, 1.015, 0]);
      else B(trim, `forearm${side}`, 0.225, 0.235, 0.225, CREAM, [x, 1.012, 0]);
      if (cuff) B(trim, `forearm${side}`, 0.276, 0.06, 0.276, cuff, [x, 0.915, 0]);
    }
    if (hem) B(trim, 'spine', 0.668, 0.05, 0.373, hem, [0, 0.825, 0]);
    if (collar) B(trim, 'neck', 0.37, 0.02, 0.29, collar, [0, 1.51, 0]);
    return trim;
  }
  const buttons = (slot, xs, color) => { for (const x of xs) for (const [y, bone, z] of [[1.28, 'chest', 0.182], [1.14, 'chest', 0.182], [1.0, 'spine', 0.192]]) round(slot, bone, [0.027, 0.027, 0.014], [x, y, z], color, 2); };
  const zip = (slot, color) => { B(slot, 'chest', 0.014, 0.37, 0.012, color, [0, 1.27, 0.176]); B(slot, 'spine', 0.014, 0.28, 0.012, color, [0, 0.96, 0.186]); B(slot, 'chest', 0.03, 0.05, 0.016, color, [0, 1.4, 0.182]); };

  // ghost hoodie and lime zigzag hoodie: soft cuffs, zip and a front pocket
  for (const [model, fab, soft] of [['ghost', { print: 'ghost' }, '#8770C4'], ['lime', { print: 'lime' }, '#6FB51C']]) {
    const t = top(model, fab, { cuff: soft, hem: soft });
    zip(t, '#E9E4F5');
    B(t, 'spine', 0.4, 0.12, 0.016, soft, [0, 0.93, 0.19]);
  }
  { // sailor shirt with a knotted red neckerchief
    const t = top('sailor', { print: 'stripes' }, { sleeves: 'short', collar: NAVY });
    for (const s of [1, -1]) B(t, 'chest', 0.27, 0.07, 0.02, RED, [0.115 * s, 1.385, 0.19], [0, 0, 0.5 * s]);
    round(t, 'chest', [0.055, 0.05, 0.03], [0, 1.31, 0.205], RED);
    for (const s of [1, -1]) flatShape(t, 'chest', [[0, 0], [0.1 * s, -0.17], [0.035 * s, -0.19], [-0.015 * s, -0.04]], 0.018, '#A8141D', [0.012 * s, 1.295, 0.2]);
  }
  { // punk aloha: flower shirt under a studded black vest
    const t = top('aloha', { print: 'aloha' }, { sleeves: 'short' });
    for (const s of [1, -1]) {
      B(t, 'chest', 0.21, 0.4, 0.03, DARK, [0.222 * s, 1.27, 0.178]);
      B(t, 'spine', 0.22, 0.28, 0.03, DARK, [0.222 * s, 0.96, 0.19]);
      B(t, 'chest', 0.2, 0.035, 0.37, DARK, [0.225 * s, 1.47, 0]);
      for (let i = 0; i < 4; i++) { const g = new THREE.ConeGeometry(0.028, 0.05, 4); rig.part(t, place(withColor(g, '#D8DCE4'), { pos: [(0.15 + i * 0.052) * s, 1.51, 0.14] }), 'chest'); }
      for (const [y, bone] of [[1.3, 'chest'], [1.16, 'chest'], [0.99, 'spine']]) { const g = new THREE.ConeGeometry(0.024, 0.04, 4); rig.part(t, place(withColor(g, '#D8DCE4'), { pos: [0.15 * s, y, 0.212], rot: [Math.PI / 2, 0, 0] }), bone); }
    }
    B(t, 'chest', 0.645, 0.38, 0.03, DARK, [0, 1.27, -0.178]);
    buttons(t, [0], '#F6EED8');
  }
  { // tactical vest over bare fur
    const t = top('tactical', { color: CREAM }, { sleeves: 'short' });
    B(t, 'chest', 0.62, 0.27, 0.07, '#4B5140', [0, 1.215, 0.17]);
    B(t, 'chest', 0.62, 0.27, 0.07, '#4B5140', [0, 1.215, -0.17]);
    B(t, 'spine', 0.69, 0.2, 0.39, '#41473A', [0, 0.99, 0]);
    for (const s of [1, -1]) { B(t, 'chest', 0.1, 0.17, 0.4, '#3A4034', [0.22 * s, 1.42, 0]); B(t, 'chest', 0.04, 0.05, 0.02, '#23261F', [0.22 * s, 1.34, 0.215]); }
    for (const x of [-0.21, 0, 0.21]) { B(t, 'spine', 0.17, 0.15, 0.06, '#565D4A', [x, 0.985, 0.21]); B(t, 'spine', 0.17, 0.03, 0.065, '#2F332A', [x, 1.05, 0.213]); }
    B(t, 'chest', 0.2, 0.12, 0.014, '#C41E27', [0, 1.2, 0.214]);
    pawBadge(t, 'chest', [0, 1.19, 0.224], 0.6, GOLD);
    B(t, 'spine', 0.71, 0.05, 0.4, '#23261F', [0, 0.845, 0]);
  }
  function pawBadge(slot, bone, pos, s, color) {
    round(slot, bone, [0.045 * s, 0.036 * s, 0.01], [pos[0], pos[1] - 0.012 * s, pos[2]], color);
    for (const [x, y] of [[-0.05, 0.03], [-0.018, 0.058], [0.018, 0.058], [0.05, 0.03]]) round(slot, bone, [0.018 * s, 0.022 * s, 0.01], [pos[0] + x * s, pos[1] + y * s, pos[2]], color);
  }
  { // shadow cloak: black with paw prints, a tall red-lined collar and a long skirt
    const t = top('shadow', { print: 'shadow' }, { cuff: '#8E1118' });
    cloth('fit_shirt_shadow__main', 'shadow', 'hips', 0.69, 0.22, 0.39, [0, 0.73, 0]);
    B(t, 'hips', 0.7, 0.04, 0.4, '#C41E27', [0, 0.62, 0]);
    for (const s of [1, -1]) {
      B(t, 'neck', 0.04, 0.17, 0.27, DARK, [0.2 * s, 1.52, 0], [0, 0, -0.28 * s]);
      B(t, 'neck', 0.014, 0.17, 0.25, '#C41E27', [0.178 * s, 1.52, 0.01], [0, 0, -0.28 * s]);
    }
    for (const [y, bone, h, z] of [[1.27, 'chest', 0.38, 0.178], [0.95, 'spine', 0.3, 0.188], [0.73, 'hips', 0.22, 0.2]]) B(t, bone, 0.03, h, 0.012, '#C41E27', [0, y, z]);
  }
  { // ship captain's coat: gold piping, brass buttons, shirt and tie, shoulder boards
    const t = top('captain', { color: NAVY }, { cuff: GOLD, hem: GOLD });
    flatShape(t, 'chest', [[-0.12, 0.14], [0.12, 0.14], [0, -0.04]], 0.012, WHITE, [0, 1.31, 0.178]);
    flatShape(t, 'chest', [[-0.028, 0.12], [0.028, 0.12], [0.04, -0.02], [0, -0.06], [-0.04, -0.02]], 0.014, DARK, [0, 1.3, 0.184]);
    for (const s of [1, -1]) {
      B(t, 'chest', 0.022, 0.22, 0.016, GOLD, [0.085 * s, 1.345, 0.182], [0, 0, -0.62 * s]);
      B(t, 'chest', 0.2, 0.035, 0.22, '#10182F', [0.26 * s, 1.475, 0]);
      for (let i = 0; i < 3; i++) B(t, 'chest', 0.02, 0.04, 0.225, GOLD, [(0.22 + i * 0.045) * s, 1.478, 0]);
    }
    buttons(t, [-0.12, 0.12], '#F2C94C');
  }
  { // grumpy blue camouflage with yellow cuffs, from the other side of "any last words?"
    top('lastwords', { print: 'bluecamo' }, { cuff: '#F5CD30', hem: '#F5CD30', collar: '#10193C' });
  }
  { // cosy red onesie with a belly heart
    const t = top('snug', { color: '#D8262F' }, { cuff: '#A8141D', hem: '#A8141D' });
    B(t, 'spine', 0.32, 0.22, 0.016, '#FFE3B8', [0, 0.97, 0.19]);
    flatShape(t, 'spine', [[0, -0.07], [-0.08, 0.01], [-0.055, 0.06], [0, 0.035], [0.055, 0.06], [0.08, 0.01]], 0.014, '#FF5C7A', [0, 0.97, 0.2]);
  }
  { // phoenix costume: layered felt feathers over the chest and a pair of wings
    const t = top('phoenix', { color: '#8E1118' }, { cuff: GOLD });
    const colours = ['#A8141D', '#D8262F', '#F0701E', '#F9A11E', '#FFD24A'];
    const feather = (bone, len, wid, color, pos, rot) => flatShape(t, bone, [[0, 0.02], [wid / 2, -len * 0.35], [0, -len], [-wid / 2, -len * 0.35]], 0.016, color, pos, rot);
    for (let row = 0; row < 5; row++) {
      const count = 6 - (row % 2);
      for (let i = 0; i < count; i++) feather(row < 3 ? 'chest' : 'spine', 0.15, 0.125, colours[Math.min(4, row + (Math.abs(i - (count - 1) / 2) < 1 ? 1 : 0))], [(i - (count - 1) / 2) * 0.108, 1.46 - row * 0.11, 0.185 + row * 0.006 + (i % 2) * 0.002], [-0.12, 0, 0]);
    }
    for (const s of [1, -1]) for (let row = 0; row < 4; row++) for (let i = 0; i < 6; i++) {
      const x = (0.26 + i * 0.13 + row * 0.015) * s, y = 1.52 - row * 0.12 + Math.sin(((i + 1) / 7) * Math.PI) * 0.24 - i * 0.012;
      feather('chest', 0.24 - row * 0.012 + i * 0.012, 0.15, colours[Math.min(4, row + (i > 3 ? 1 : 0))], [x, y, -0.23 - (3 - row) * 0.012 - i * 0.004], [0, 0, (0.25 + i * 0.12) * s]);
    }
  }

  // ---- trousers --------------------------------------------------------------------------------------
  function legs(model, fabric, { long = true, stripe = null, hem = null, pockets = null } = {}) {
    const main = `fit_pants_${model}__main`, trim = `fit_pants_${model}__trim`;
    const part = (bone, w, h, d, pos) => (fabric.print ? cloth(main, fabric.print, bone, w, h, d, pos) : B(main, bone, w, h, d, fabric.color, pos));
    part('hips', 0.625, 0.145, 0.336, [0, 0.755, 0]);
    for (const [s, side] of sides) {
      const x = 0.155 * s;
      part(`thigh${side}`, 0.302, 0.372, 0.312, [x, 0.615, 0]);
      if (long) part(`shin${side}`, 0.29, 0.33, 0.298, [x, 0.275, 0]);
      if (stripe) for (const [bone, y, h] of [[`thigh${side}`, 0.615, 0.372], ...(long ? [[`shin${side}`, 0.275, 0.33]] : [])]) B(trim, bone, 0.016, h, 0.07, stripe, [x + 0.152 * s, y, 0]);
      if (hem) B(trim, long ? `shin${side}` : `thigh${side}`, 0.31, 0.042, 0.32, hem, [x, long ? 0.15 : 0.455, 0]);
      if (pockets) { B(trim, `thigh${side}`, 0.05, 0.14, 0.16, pockets, [x + 0.162 * s, 0.57, 0]); B(trim, `thigh${side}`, 0.056, 0.028, 0.17, '#2F332A', [x + 0.162 * s, 0.645, 0]); }
    }
    return trim;
  }
  legs('navy', { color: '#1C2240' });
  legs('jeans', { print: 'denim' }, { hem: '#2A4C86' });
  { const t = legs('cargo', { print: 'greencamo' }, { pockets: '#6B7446' }); B(t, 'hips', 0.64, 0.04, 0.35, '#2F332A', [0, 0.8, 0]); }
  legs('sailor', { color: NAVY }, { long: false, hem: WHITE });
  legs('track', { color: '#17191F' }, { stripe: '#B4F02A', hem: '#B4F02A' });
  legs('pyjama', { print: 'pyjama' }, { hem: '#E58DB0' });
  legs('captain', { color: '#141C36' }, { stripe: GOLD });

  // ---- shoes -----------------------------------------------------------------------------------------
  function shoes(model, draw) { for (const [s, side] of sides) draw(`fit_shoes_${model}__main`, `foot${side}`, 0.155 * s, s); }
  shoes('court', (m, bone, x) => { B(m, bone, 0.29, 0.14, 0.42, '#17171B', [x, 0.07, 0.05]); B(m, bone, 0.292, 0.045, 0.43, '#F1EEE4', [x, 0.022, 0.052]); B(m, bone, 0.31, 0.12, 0.3, '#17171B', [x, 0.19, 0]); B(m, bone, 0.316, 0.025, 0.306, GOLD, [x, 0.25, 0]); });
  shoes('sneaker', (m, bone, x, s) => { round(m, bone, [0.142, 0.09, 0.22], [x, 0.095, 0.055], '#D8262F', 3); B(m, bone, 0.29, 0.055, 0.445, '#FFFFFF', [x, 0.028, 0.055]); round(m, bone, [0.12, 0.05, 0.07], [x, 0.085, 0.23], '#FFFFFF', 2.6); for (const z of [0.07, 0.12]) B(m, bone, 0.17, 0.018, 0.022, '#FFFFFF', [x, 0.188, z]); B(m, bone, 0.014, 0.055, 0.2, '#FFFFFF', [x + 0.158 * s, 0.095, 0.03], [0.35, 0, 0]); });
  shoes('sandal', (m, bone, x) => { round(m, bone, [0.15, 0.07, 0.2], [x, 0.088, 0.055], CREAM, 3); B(m, bone, 0.29, 0.045, 0.45, '#2E8BC8', [x, 0.022, 0.055]); for (const s of [1, -1]) B(m, bone, 0.19, 0.03, 0.04, '#FF7A2E', [x + 0.07 * s, 0.158, 0.09], [0, 0.65 * s, 0.25 * -s]); });
  shoes('rain', (m, bone, x) => { round(m, bone, [0.143, 0.092, 0.225], [x, 0.088, 0.055], '#FFC928', 3.2); B(m, bone, 0.315, 0.2, 0.305, '#FFC928', [x, 0.22, 0]); B(m, bone, 0.332, 0.04, 0.322, '#E39A10', [x, 0.325, 0]); B(m, bone, 0.288, 0.03, 0.44, '#8A5A12', [x, 0.015, 0.055]); });
  shoes('combat', (m, bone, x) => { round(m, bone, [0.145, 0.095, 0.23], [x, 0.092, 0.058], '#3B332A', 3.4); B(m, bone, 0.315, 0.19, 0.31, '#4A4034', [x, 0.215, 0]); B(m, bone, 0.294, 0.045, 0.465, '#17140F', [x, 0.022, 0.058]); for (const y of [0.17, 0.215, 0.26]) B(m, bone, 0.19, 0.018, 0.02, '#C9BCA0', [x, y, 0.158]); });
  shoes('bunny', (m, bone, x) => { round(m, bone, [0.17, 0.1, 0.23], [x, 0.095, 0.058], '#FFFFFF', 2.4); for (const s of [1, -1]) { round(m, bone, [0.032, 0.11, 0.025], [x + 0.058 * s, 0.24, 0.14], '#FFFFFF', 2.2, [0.35, 0, -0.22 * s]); round(m, bone, [0.016, 0.075, 0.012], [x + 0.058 * s, 0.245, 0.162], '#FF9CC2', 2.2, [0.35, 0, -0.22 * s]); round(m, bone, [0.016, 0.018, 0.012], [x + 0.05 * s, 0.13, 0.278], DARK, 2); } round(m, bone, [0.018, 0.013, 0.012], [x, 0.1, 0.287], '#FF7AA8', 2); });
  shoes('rocket', (m, bone, x, s) => { round(m, bone, [0.162, 0.095, 0.228], [x, 0.098, 0.056], '#C9D2DE', 3.2); B(m, bone, 0.315, 0.17, 0.3, '#C9D2DE', [x, 0.215, 0]); B(m, bone, 0.322, 0.03, 0.31, '#D8262F', [x, 0.29, 0]); for (const k of [-0.08, 0.08]) { const n = new THREE.CylinderGeometry(0.036, 0.052, 0.11, 10); rig.part(m, place(withColor(n, '#59606E'), { pos: [x + k, 0.14, -0.19] }), bone); const f = new THREE.ConeGeometry(0.044, 0.13, 8); rig.part(m, place(withColor(f, '#FF8A1E'), { pos: [x + k, 0.045, -0.21], rot: [Math.PI - 0.25, 0, 0] }), bone); } flatShape(m, bone, [[0, -0.06], [0.1, -0.09], [0, 0.08]], 0.018, '#D8262F', [x + 0.17 * s, 0.17, -0.04], [0, (Math.PI / 2), 0]); });

  // ---- hats and hoods --------------------------------------------------------------------------------
  const Y = HEAD.y;
  /** A hood around the head with an opening for the face, edged with a soft rim. */
  function hood(model, fabric, rimColor, { open = [0.275, 0.235, -0.035], grow = 1.075 } = {}) {
    const slot = fabric.print ? `hat_${model}__print` : `hat_${model}`;
    if (fabric.print) rig.mats[slot] = prints[fabric.print];
    const full = roundGeo(HEAD.w * grow, HEAD.h * grow, HEAD.d * grow, HEAD.n, 28, 20).toNonIndexed();
    const p = full.attributes.position, n = full.attributes.normal, uv = full.attributes.uv;
    const keep = [];
    const inside = (x, y) => (x / open[0]) ** 2 + ((y - open[2]) / open[1]) ** 2;
    for (let i = 0; i < p.count; i += 3) {
      const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
      if (cz > 0.03 && inside(cx, cy) < 1) continue; // the face shows through
      if (cy < -HEAD.h * 0.9) continue; // open at the neck
      keep.push(i, i + 1, i + 2);
    }
    const g = new THREE.BufferGeometry();
    for (const [name, at, size] of [['position', p, 3], ['normal', n, 3], ['uv', uv, 2]]) g.setAttribute(name, new THREE.Float32BufferAttribute(keep.flatMap((i) => Array.from({ length: size }, (_, k) => at.array[i * size + k])), size));
    if (fabric.print) { const u = g.attributes.uv; for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * 5, u.getY(i) * 2.6); }
    add(rig, slot, 'head', smoothGeo(place(g, { pos: [0, Y, 0] }), fabric.color ?? '#ffffff'));
    const rim = Array.from({ length: 33 }, (_, k) => {
      const a = (k / 32) * TAU, x = Math.cos(a) * open[0], y = Math.max(-HEAD.h * 0.9, open[2] + Math.sin(a) * open[1]);
      const z = HEAD.d * grow * Math.max(0.05, 1 - Math.abs(x / (HEAD.w * grow)) ** HEAD.n - Math.abs(y / (HEAD.h * grow)) ** HEAD.n) ** (1 / HEAD.n);
      return new V3(x, Y + y, z);
    });
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rim, true), 40, 0.032, 6, true);
    add(rig, `hat_${model}`, 'head', smoothGeo(tube, rimColor));
    return `hat_${model}`;
  }
  const monkeyEars = (slot, colour, inner) => { for (const s of [1, -1]) { round(slot, 'head', [0.13, 0.135, 0.055], [0.43 * s, Y + 0.03, 0.01], colour, 2); round(slot, 'head', [0.08, 0.085, 0.022], [0.435 * s, Y + 0.025, 0.058], inner, 2); } };
  hood('ghost', { print: 'ghost' }, '#8770C4');
  hood('lime', { print: 'lime' }, '#6FB51C');
  monkeyEars(hood('monkey', { color: '#7A4524' }, '#A8683A'), '#7A4524', '#E3B57E');
  { const h = hood('redhood', { color: '#D8262F' }, '#A8141D'); monkeyEars(h, '#D8262F', '#FFE3B8'); B(h, 'head', 0.045, 0.14, 0.045, '#A8141D', [0, Y + 0.38, 0]); round(h, 'head', [0.075, 0.075, 0.075], [0, Y + 0.49, 0], '#FFD24A', 2); }
  { // phoenix hood: feathered ears, a golden beak and a flame crest
    const h = hood('phoenix', { color: '#A8141D' }, '#7A0C13');
    const flame = (x, y, z, len, wid, color, lean) => flatShape(h, 'head', [[-wid, 0], [-wid * 0.55, len * 0.45], [-wid * 0.9, len * 0.62], [wid * 0.15, len], [wid * 0.1, len * 0.62], [wid, len * 0.3], [wid * 0.7, 0]], 0.03, color, [x, y, z], [0, 0, lean]);
    for (const [x, len, c, lean, z] of [[0, 0.42, '#FFC928', 0.05, 0.1], [-0.07, 0.3, '#F9A11E', 0.4, 0.085], [0.07, 0.31, '#F9A11E', -0.4, 0.085], [-0.12, 0.2, '#D8262F', 0.75, 0.07], [0.12, 0.2, '#D8262F', -0.75, 0.07]]) flame(x, Y + 0.27, z, len, 0.055, c, lean);
    flatShape(h, 'head', [[-0.065, 0.04], [0.065, 0.04], [0, -0.085]], 0.075, '#E8A21C', [0, Y + 0.225, 0.33]);
    for (const s of [1, -1]) for (let i = 0; i < 3; i++) flame((0.3 + i * 0.025) * s, Y + 0.13 - i * 0.075, 0.05, 0.2 - i * 0.02, 0.04, ['#FFC928', '#F0701E', '#D8262F'][i], (-0.55 - i * 0.28) * s);
  }
  { // shadow ninja headband with a paw plate and trailing ties
    const h = 'hat_headband';
    const ring = Array.from({ length: 40 }, (_, k) => { const a = (k / 40) * TAU; const cx = Math.cos(a), cz = Math.sin(a), y = 0.15; const shrink = (1 - Math.abs(y / HEAD.h) ** HEAD.n) ** (1 / HEAD.n); const q = (Math.abs(cx) ** HEAD.n + Math.abs(cz) ** HEAD.n) ** (-1 / HEAD.n); return new V3(cx * q * HEAD.w * shrink * 1.035, Y + y, cz * q * HEAD.d * shrink * 1.05); });
    const band = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ring, true), 48, 0.044, 6, true);
    add(rig, h, 'head', smoothGeo(band, '#17151B'));
    B(h, 'head', 0.28, 0.092, 0.03, '#C4CBD6', [0, Y + 0.15, 0.318]);
    for (const s of [1, -1]) for (const k of [-0.025, 0.025]) round(h, 'head', [0.01, 0.01, 0.008], [0.115 * s, Y + 0.15 + k, 0.336], '#6A7382', 2);
    pawBadge(h, 'head', [0, Y + 0.14, 0.336], 0.55, '#23262E');
    for (const [dy, a] of [[0.11, -0.5], [0.07, -1.0]]) add(rig, h, 'head', lock([[0.05, Y + 0.15, -0.31], [0.2, Y + dy, -0.4], [0.36, Y + dy + a * 0.12, -0.42]], [[0, 0.04], [0.7, 0.036], [1, 0.012]], { flat: 0.2, segs: 12, radial: 6, color: '#17151B' }));
  }
  { // sailor hat
    const h = 'hat_sailor';
    B(h, 'head', 0.5, 0.12, 0.44, WHITE, [0, Y + 0.33, 0]);
    round(h, 'head', [0.24, 0.1, 0.21], [0, Y + 0.41, 0], WHITE, 2.6);
    B(h, 'head', 0.512, 0.022, 0.452, NAVY, [0, Y + 0.345, 0]);
    B(h, 'head', 0.016, 0.075, 0.012, NAVY, [0, Y + 0.325, 0.228]);
    B(h, 'head', 0.055, 0.014, 0.012, NAVY, [0, Y + 0.345, 0.229]);
    for (const s of [1, -1]) B(h, 'head', 0.042, 0.014, 0.012, NAVY, [0.018 * s, Y + 0.295, 0.229], [0, 0, 0.6 * s]);
  }
  { // captain's peaked cap
    const h = 'hat_captain';
    B(h, 'head', 0.5, 0.09, 0.43, NAVY, [0, Y + 0.31, 0]);
    round(h, 'head', [0.33, 0.11, 0.29], [0, Y + 0.415, -0.005], WHITE, 3);
    round(h, 'head', [0.25, 0.022, 0.14], [0, Y + 0.265, 0.24], '#0E0E12', 2.6);
    B(h, 'head', 0.4, 0.024, 0.02, GOLD, [0, Y + 0.305, 0.225]);
    round(h, 'head', [0.075, 0.075, 0.018], [0, Y + 0.41, 0.283], NAVY, 2);
    pawBadge(h, 'head', [0, Y + 0.4, 0.3], 0.7, GOLD);
    for (const s of [1, -1]) round(h, 'head', [0.025, 0.025, 0.02], [0.2 * s, Y + 0.305, 0.222], GOLD, 2);
  }
  { // pink mohawk
    const h = 'hat_mohawk';
    for (let i = 0; i < 11; i++) {
      const k = i / 10, z = 0.21 - k * 0.46, base = Y + HEAD.h * (1 - Math.abs(z / HEAD.d) ** HEAD.n) ** (1 / HEAD.n) - 0.03;
      for (const dx of [-0.035, 0.035]) add(rig, h, 'head', lock([[dx, base, z], [dx * 1.2, base + 0.17, z - 0.03], [dx * 1.3, base + 0.2 + Math.sin(k * Math.PI) * 0.17, z - 0.1]], [[0, 0.036], [0.6, 0.024], [1, 0.001]], { flat: 0.55, segs: 8, radial: 6, color: i % 2 ? '#FF2E93' : '#D6177A' }));
    }
  }
  { // the cap from "any last words?": black band with a gold emblem, red dome and red knob
    const h = 'hat_mandarin';
    B(h, 'head', 0.52, 0.13, 0.45, DARK, [0, Y + 0.305, 0]);
    round(h, 'head', [0.235, 0.17, 0.205], [0, Y + 0.375, 0], '#C41E27', 2.2);
    round(h, 'head', [0.045, 0.05, 0.045], [0, Y + 0.57, 0], '#C41E27', 2);
    B(h, 'head', 0.07, 0.025, 0.07, GOLD, [0, Y + 0.53, 0]);
    const ring = new THREE.TorusGeometry(0.05, 0.011, 8, 20);
    add(rig, h, 'head', smoothGeo(place(ring, { pos: [0, Y + 0.305, 0.232] }), GOLD));
    B(h, 'head', 0.1, 0.013, 0.012, GOLD, [0, Y + 0.305, 0.232]);
    B(h, 'head', 0.013, 0.1, 0.012, GOLD, [0, Y + 0.305, 0.232]);
  }

  return prints;
}

/** Facial hair styles. All swing on the same bones and take the player's hair colour. */
export function buildBeards(rig, kit) {
  const { add, lock, HEAD } = kit;
  const Y = HEAD.y;
  const sides = [[1, 'L'], [-1, 'R']];
  const stache = (slot, path, widths, opt = {}) => { for (const [s, side] of sides) add(rig, slot, `stache${side}`, lock(path.map(([x, y, z]) => [x * s, Y + y, z]), widths, { flat: 0.5, segs: 18, radial: 6, ...opt })); };
  const chin = (slot, path, widths, opt = {}) => add(rig, slot, 'beard', lock(path.map(([x, y, z]) => [x, Y + y, z]), widths, { flat: 0.34, segs: 14, radial: 8, ...opt }));
  const wisps = (slot, len) => { for (const s of [1, -1]) chin(slot, [[0.04 * s, -0.2, 0.28], [0.072 * s, -0.2 - len * 0.4, 0.272], [0.05 * s, -0.2 - len, 0.252]], [[0, 0.026], [0.3, 0.027], [1, 0.001]], { flat: 0.4, segs: 9, radial: 6 }); };
  const classic = [[0.012, -0.168, 0.34], [0.085, -0.168, 0.35], [0.152, -0.215, 0.343], [0.183, -0.32, 0.335], [0.19, -0.49, 0.3], [0.174, -0.69, 0.272]];
  const thin = [[0, 0.013], [0.16, 0.03], [0.42, 0.021], [0.75, 0.014], [1, 0.0015]];

  stache('beard_classic', classic, thin);
  chin('beard_classic', [[0, -0.195, 0.286], [0, -0.29, 0.285], [0, -0.42, 0.262], [0.006, -0.59, 0.247]], [[0, 0.05], [0.22, 0.08], [0.62, 0.042], [1, 0.0012]]);
  wisps('beard_classic', 0.24);

  // the grand master: strands down to the knees
  stache('beard_long', [[0.012, -0.168, 0.34], [0.1, -0.17, 0.352], [0.2, -0.26, 0.35], [0.24, -0.52, 0.33], [0.2, -0.82, 0.29], [0.26, -1.02, 0.28]], [[0, 0.013], [0.14, 0.032], [0.5, 0.02], [0.8, 0.013], [1, 0.0015]]);
  chin('beard_long', [[0, -0.195, 0.286], [0.02, -0.4, 0.285], [-0.02, -0.65, 0.262], [0.01, -0.95, 0.255]], [[0, 0.055], [0.2, 0.085], [0.6, 0.045], [1, 0.0012]]);
  wisps('beard_long', 0.4);

  // wise cloud: short, thick and fluffy
  stache('beard_bushy', [[0.012, -0.165, 0.34], [0.1, -0.16, 0.35], [0.2, -0.21, 0.33], [0.26, -0.3, 0.29]], [[0, 0.025], [0.3, 0.062], [0.7, 0.045], [1, 0.004]], { flat: 0.6 });
  chin('beard_bushy', [[0, -0.19, 0.285], [0, -0.3, 0.29], [0, -0.43, 0.265], [0, -0.52, 0.25]], [[0, 0.1], [0.35, 0.17], [0.75, 0.1], [1, 0.01]], { flat: 0.42 });
  wisps('beard_bushy', 0.3);

  // curled tips, like a very smug official
  stache('beard_curly', [[0.012, -0.168, 0.34], [0.11, -0.17, 0.352], [0.23, -0.23, 0.345], [0.32, -0.2, 0.32], [0.34, -0.1, 0.3], [0.28, -0.085, 0.31], [0.27, -0.13, 0.315]], [[0, 0.013], [0.2, 0.035], [0.55, 0.022], [1, 0.0015]], { segs: 24 });
  chin('beard_curly', [[0, -0.195, 0.286], [0, -0.28, 0.285], [0.03, -0.38, 0.27], [-0.02, -0.43, 0.27]], [[0, 0.05], [0.3, 0.068], [1, 0.0012]]);

  // two braids with gold beads
  stache('beard_braid', classic, [[0, 0.013], [0.16, 0.03], [0.3, 0.012], [0.4, 0.026], [0.52, 0.012], [0.62, 0.025], [0.74, 0.011], [0.84, 0.022], [1, 0.0015]], { segs: 30 });
  for (const [s, side] of sides) {
    const bead = new THREE.SphereGeometry(0.024, 8, 6);
    bead.translate(0.19 * s, Y - 0.5, 0.3);
    const g = bead.toNonIndexed(), n = g.attributes.position.count, arr = new Float32Array(n * 3), c = new THREE.Color('#E8B53A');
    for (let i = 0; i < n; i++) arr.set([c.r / 0.9, c.g / 0.9, c.b / 0.9], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    add(rig, 'beard_braid', `stache${side}`, g);
  }
  chin('beard_braid', [[0, -0.195, 0.286], [0, -0.29, 0.285], [0, -0.42, 0.262], [0, -0.6, 0.247]], [[0, 0.05], [0.2, 0.065], [0.4, 0.028], [0.55, 0.05], [0.7, 0.022], [0.82, 0.038], [1, 0.0012]]);

  // short and tidy
  stache('beard_short', [[0.012, -0.168, 0.34], [0.09, -0.17, 0.35], [0.16, -0.215, 0.34], [0.185, -0.3, 0.32]], [[0, 0.013], [0.35, 0.03], [1, 0.0015]], { segs: 18 });
  chin('beard_short', [[0, -0.2, 0.286], [0, -0.28, 0.282], [0, -0.35, 0.268]], [[0, 0.05], [0.35, 0.058], [1, 0.0012]], { segs: 12 });
}
