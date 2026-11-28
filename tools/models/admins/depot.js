// Meme Depot pictures: the game's own Mihao (and its original wardrobe) acting out garden jokes in the garden.
// Driven by depot.mjs. The garden itself comes from memes.js.
import * as THREE from 'three';
import { Avatar } from '../../../client/src/render/characters.js';
import { studio } from './memes.js';

const SIZE = 1600;
const out = document.createElement('canvas');
out.width = out.height = SIZE;
const ctx = out.getContext('2d');
let kit, balloon;

async function init() {
  await window.memes.init();
  kit = studio();
  balloon = (await kit.assets.prop('balloon')).scene;
}

// ---------------------------------------------------------------- the cats
const OUTFITS = {
  official: { hat: 'mandarin', pants: 'legs_navy', shoes: 'feet_court' },
  gardener: { hat: 'bare' },
  lime: { hat: 'lime_hood', shirt: 'top_lime', pants: 'legs_track', shoes: 'feet_sneaker' },
  ghost: { hat: 'ghost_hood', shirt: 'top_ghost', pants: 'legs_pyjama', shoes: 'feet_bunny' },
  sailor: { hat: 'sailor_hat', shirt: 'top_sailor', pants: 'legs_sailor', shoes: 'feet_sandal' },
  captain: { hat: 'captain_cap', shirt: 'top_captain', pants: 'legs_captain', shoes: 'feet_court', beard: 'curly' },
  grandmaster: { hat: 'headband', shirt: 'top_shadow', pants: 'legs_navy', shoes: 'feet_court', beard: 'long' },
  phoenix: { hat: 'phoenix_hood', shirt: 'top_phoenix', pants: 'denim', shoes: 'feet_rocket' },
};

/** c: {look, pose, at (moment in the pose), x, z, turn, scale} */
function mihao(c) {
  const a = new Avatar(kit.farmer, kit.assets.mats);
  a.applyProfile({ shirt: 'plaid_red', pants: 'denim', shoes: 'boots', skin: null, hair: null, beard: 'classic', height: 1, ...OUTFITS[c.look ?? 'official'] });
  a.play(c.pose ?? 'idle');
  a.idleT = c.at ?? 0.5;
  for (let i = 0; i < 14; i++) { a.idleT = c.at ?? 0.5; a.tick(0.05); a.idleT = c.at ?? 0.5; }
  a.root.position.set(c.x ?? 0, c.y ?? 0, c.z ?? 0);
  a.root.rotation.y = c.turn ?? 0;
  a.root.scale.setScalar(c.scale ?? 1);
  return a.root;
}

// ---------------------------------------------------------------- props
const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...o });
function mesh(group, geo, color, pos = [0, 0, 0], rot = [0, 0, 0], scale = null, o) {
  const m = new THREE.Mesh(geo, typeof color === 'string' ? mat(color, o) : color);
  m.position.set(...pos); m.rotation.set(...rot);
  if (scale) m.scale.set(...scale);
  m.castShadow = true; m.receiveShadow = true;
  group.add(m);
  return m;
}
const ball = (g, r, color, pos, scale, o) => mesh(g, new THREE.SphereGeometry(r, 28, 20), color, pos, [0, 0, 0], scale, o);
const box = (g, w, h, d, color, pos, rot, o) => mesh(g, new THREE.BoxGeometry(w, h, d), color, pos, rot, null, o);
const cyl = (g, r0, r1, h, color, pos, rot, o) => mesh(g, new THREE.CylinderGeometry(r0, r1, h, 28), color, pos, rot, null, o);

const PROPS = {
  /** The game's Sky Balloon, sized to p.height. */
  balloon(g, p) {
    const o = balloon.clone(true);
    o.scale.setScalar((p.height ?? 1.8) / new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3()).y);
    o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    g.add(o);
  },
  teacup(g) {
    cyl(g, 0.27, 0.22, 0.035, '#f6efe2', [0, 0.02, 0]);
    cyl(g, 0.17, 0.12, 0.22, '#fbf6ee', [0, 0.15, 0], [0, 0, 0], { roughness: 0.3 });
    cyl(g, 0.172, 0.165, 0.035, '#c21b22', [0, 0.215, 0]);
    cyl(g, 0.15, 0.15, 0.012, '#8a4a16', [0, 0.258, 0]);
    mesh(g, new THREE.TorusGeometry(0.075, 0.022, 10, 24, Math.PI), '#fbf6ee', [0.165, 0.15, 0], [0, 0, -Math.PI / 2]);
    for (let i = 0; i < 5; i++) ball(g, 0.035 + i * 0.008, '#ffffff', [Math.sin(i * 2) * 0.05, 0.34 + i * 0.1, 0], [1, 1.2, 0.7], { transparent: true, opacity: 0.5 - i * 0.07, depthWrite: false });
  },
  magnifier(g) {
    mesh(g, new THREE.TorusGeometry(0.17, 0.026, 12, 40), '#e0aa2e', [0, 0, 0], [0, 0, 0], null, { metalness: 0.7, roughness: 0.3 });
    mesh(g, new THREE.CircleGeometry(0.168, 40), '#cfeaff', [0, 0, 0], [0, 0, 0], null, { transparent: true, opacity: 0.24, roughness: 0.05, metalness: 0.3, depthWrite: false });
    ball(g, 0.03, '#ffffff', [-0.07, 0.07, 0.01], [1.5, 0.7, 0.1], { transparent: true, opacity: 0.8 });
    cyl(g, 0.035, 0.042, 0.34, '#6b3f1f', [0.23, -0.23, 0], [0, 0, Math.PI / 4]);
  },
  gift(g) {
    box(g, 0.78, 0.6, 0.62, '#c8202a', [0, 0.3, 0]);
    box(g, 0.86, 0.15, 0.7, '#dd2a35', [0, 0.65, 0]);
    box(g, 0.13, 0.76, 0.72, '#f2b632', [0, 0.37, 0]);
    box(g, 0.88, 0.17, 0.13, '#f2b632', [0, 0.65, 0]);
    for (const s of [-1, 1]) mesh(g, new THREE.TorusGeometry(0.13, 0.045, 12, 28), '#f2b632', [s * 0.13, 0.84, 0], [0, 0, s * -0.5], [1.2, 0.8, 1]);
    ball(g, 0.075, '#ffd45a', [0, 0.77, 0]);
  },
  cake(g) {
    cyl(g, 0.52, 0.52, 0.05, '#f6efe2', [0, 0.03, 0]);
    cyl(g, 0.42, 0.42, 0.28, '#e9b46a', [0, 0.19, 0]);
    cyl(g, 0.43, 0.43, 0.07, '#ff8fb8', [0, 0.35, 0]);
    cyl(g, 0.28, 0.28, 0.22, '#e9b46a', [0, 0.49, 0]);
    cyl(g, 0.29, 0.29, 0.065, '#fff1d8', [0, 0.62, 0]);
    for (let i = 0; i < 12; i++) ball(g, 0.055, i % 2 ? '#d4232b' : '#fff1d8', [Math.sin(i / 12 * 6.283) * 0.4, 0.4, Math.cos(i / 12 * 6.283) * 0.4]);
    for (const x of [-0.13, 0, 0.13]) {
      cyl(g, 0.022, 0.022, 0.2, '#3a8aff', [x, 0.75, 0]);
      ball(g, 0.033, '#ffd23a', [x, 0.9, 0], [0.8, 1.5, 0.8], { emissive: new THREE.Color('#ffb000'), emissiveIntensity: 1.4 });
    }
  },
  trophy(g) {
    const gold = { metalness: 0.75, roughness: 0.25, emissive: new THREE.Color('#7a5200'), emissiveIntensity: 0.45 };
    box(g, 0.5, 0.2, 0.4, '#5a3418', [0, 0.1, 0]);
    cyl(g, 0.07, 0.15, 0.28, '#ffc93a', [0, 0.34, 0], [0, 0, 0], gold);
    cyl(g, 0.36, 0.14, 0.46, '#ffd23a', [0, 0.7, 0], [0, 0, 0], gold);
    cyl(g, 0.38, 0.38, 0.05, '#ffe27a', [0, 0.94, 0], [0, 0, 0], gold);
    for (const s of [-1, 1]) mesh(g, new THREE.TorusGeometry(0.15, 0.035, 10, 28, Math.PI), '#ffc93a', [s * 0.3, 0.74, 0], [0, 0, s * -Math.PI / 2], null, gold);
  },
  fish(g) {
    cyl(g, 0.5, 0.44, 0.05, '#f4ede0', [0, 0.03, 0]);
    const shine = { metalness: 0.45, roughness: 0.35 };
    ball(g, 0.3, '#e8a02c', [-0.05, 0.17, 0], [1.3, 0.45, 0.62], shine);
    mesh(g, new THREE.ConeGeometry(0.15, 0.22, 4), '#d98a1c', [0.42, 0.17, 0], [0, 0, Math.PI / 2], [1, 1, 0.35], shine);
    ball(g, 0.035, '#ffffff', [-0.31, 0.23, 0.11]);
    ball(g, 0.018, '#14100d', [-0.32, 0.235, 0.14]);
  },
  /** A thick patch of lawn with tufts, for a cat that is really touching grass. */
  grass(g) {
    cyl(g, 1.45, 1.5, 0.07, '#5fae35', [0, 0.035, 0]);
    let k = 11;
    const r = () => ((k = (k * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 320; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 1.42, h = 0.09 + r() * 0.2;
      mesh(g, new THREE.ConeGeometry(0.024, h, 5), ['#7bd043', '#4f9a2c', '#8fdc55'][i % 3], [Math.cos(a) * d, 0.07 + h / 2, Math.sin(a) * d * 0.75], [(r() - 0.5) * 0.5, 0, (r() - 0.5) * 0.5]);
    }
  },
  pumpkin(g, p) {
    const r = (p.size ?? 0.6) / 2, gold = !!p.gold;
    const skin = gold ? { roughness: 0.22, metalness: 0.65, emissive: new THREE.Color('#b87800'), emissiveIntensity: 0.55 } : { roughness: 0.5 };
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const lobe = ball(g, r * 0.52, gold ? (i % 2 ? '#ffd23a' : '#f5b81c') : (i % 2 ? '#f07a14' : '#e56a0c'), [Math.sin(a) * r * 0.5, r * 0.72, Math.cos(a) * r * 0.5], [0.85, 1.38, 1], skin);
      lobe.rotation.y = a;
    }
    cyl(g, r * 0.08, r * 0.14, r * 0.45, '#4f6b22', [0, r * 1.5, 0], [0, 0, 0.28]);
    if (gold) { const l = new THREE.PointLight('#ffd860', 5, 4, 2); l.position.set(0, r * 2.2, 0.4); g.add(l); }
  },
  crate(g, p) {
    const h = p.h ?? 0.8;
    box(g, 0.8, h, 0.7, '#a86c34', [0, h / 2, 0]);
    for (const y of [0.07, h - 0.07]) box(g, 0.86, 0.1, 0.76, '#7d4c20', [0, y, 0]);
  },
  sprout(g) {
    box(g, 0.9, 0.12, 0.7, '#5a3418', [0, 0.06, 0]);
    cyl(g, 0.022, 0.03, 0.3, '#5f9a2c', [0, 0.27, 0]);
    for (const s of [-1, 1]) ball(g, 0.13, '#74c23a', [s * 0.12, 0.43, 0], [1.1, 0.35, 0.6]).rotation.z = s * 0.45;
  },
  coins(g) {
    const gold = { metalness: 0.7, roughness: 0.28, emissive: new THREE.Color('#7a5200'), emissiveIntensity: 0.45 };
    [[0, 0, 11], [0.3, 0.1, 7], [-0.3, 0.06, 8], [0.16, 0.34, 4], [-0.14, 0.32, 3], [0.48, -0.1, 3]].forEach(([x, z, n]) => {
      for (let i = 0; i < n; i++) cyl(g, 0.14, 0.14, 0.045, '#ffc93a', [x + Math.sin(i * 7) * 0.012, 0.03 + i * 0.05, z], [0, 0, 0], gold);
    });
    for (let i = 0; i < 9; i++) cyl(g, 0.13, 0.13, 0.035, '#ffd65a', [Math.sin(i * 2.3) * 0.62, 0.03, 0.28 + Math.cos(i * 1.7) * 0.22], [0.1, i, 0.08], gold);
  },
  umbrella(g) {
    cyl(g, 0.022, 0.022, 1.35, '#5a3a1a', [0, -0.35, 0]);
    for (let i = 0; i < 8; i++) mesh(g, new THREE.ConeGeometry(0.9, 0.36, 1, 1, true, (i / 8) * Math.PI * 2, Math.PI / 4), i % 2 ? '#d4232b' : '#f2b632', [0, 0.42, 0], [0, 0, 0], null, { side: THREE.DoubleSide, flatShading: true });
    ball(g, 0.05, '#f2b632', [0, 0.63, 0]);
  },
  can(g) {
    cyl(g, 0.2, 0.23, 0.3, '#2f8fd0', [0, 0, 0], [0, 0, 0], { metalness: 0.4, roughness: 0.35 });
    cyl(g, 0.035, 0.06, 0.42, '#2f8fd0', [-0.3, 0.07, 0], [0, 0, 1.05]);
    cyl(g, 0.09, 0.05, 0.07, '#1f6fa8', [-0.49, 0.18, 0], [0, 0, 1.05]);
    mesh(g, new THREE.TorusGeometry(0.17, 0.028, 10, 28, Math.PI), '#1f6fa8', [0.03, 0.15, 0]);
    for (let i = 0; i < 22; i++) ball(g, 0.022, '#9bd8ff', [-0.55 - (i % 5) * 0.045 - (i % 3) * 0.02, 0.12 - Math.floor(i / 5) * 0.14 - (i % 2) * 0.05, ((i % 4) - 1.5) * 0.05], [0.8, 1.7, 0.8], { emissive: new THREE.Color('#3a8ad0'), emissiveIntensity: 0.5 });
  },
  /** A heap of the game's own crops. */
  heap(g, p) {
    let k = 3;
    const r = () => ((k = (k * 16807) % 2147483647) / 2147483647);
    const ids = ['pumpkin', 'watermelon', 'tomato', 'pineapple', 'pepper', 'mango', 'strawberry', 'pear'];
    for (let i = 0; i < (p.n ?? 34); i++) {
      const id = ids[i % ids.length];
      const f = kit.crops.get(id).fruit.clone(true);
      f.position.set(0, 0, 0); f.visible = true;
      const h = new THREE.Group(); h.add(f);
      const s = new THREE.Box3().setFromObject(h).getSize(new THREE.Vector3());
      h.scale.setScalar((0.24 + r() * 0.16) / Math.max(s.x, s.y, s.z, 0.01));
      const a = r() * Math.PI * 2, d = r() * (p.spread ?? 0.75);
      h.position.set(Math.cos(a) * d, 0.1 + Math.max(0, (p.spread ?? 0.75) - d) * 0.55 * r(), Math.sin(a) * d * 0.6);
      h.rotation.y = r() * 6;
      h.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      g.add(h);
    }
  },
};

// ---------------------------------------------------------------- words and 2D effects
const impact = (s) => `${s}px Impact, "Arial Narrow", sans-serif`;
function outline(text, x, y, size, fill = '#fff') {
  ctx.font = impact(size);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.lineWidth = size / 5.5;
  ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.strokeText(text, x + size / 24, y + size / 16);
  ctx.strokeStyle = '#14100d'; ctx.strokeText(text, x, y);
  ctx.fillStyle = fill; ctx.fillText(text, x, y);
}
function fitted(text, y, size, fill) {
  ctx.font = impact(size);
  while (ctx.measureText(text).width > SIZE - 110) ctx.font = impact((size -= 4));
  outline(text, SIZE / 2, y, size, fill);
}
function bubble(text, x, y) {
  ctx.font = 'bold 62px Arial, sans-serif';
  const w = ctx.measureText(text).width + 70;
  ctx.save();
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#14100d'; ctx.lineWidth = 9; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(x - 30, y + 50); ctx.lineTo(x - 6, y + 135); ctx.lineTo(x + 46, y + 50); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.roundRect(x - w / 2, y - 62, w, 124, 56); ctx.fill(); ctx.stroke();
  ctx.fillRect(x - 24, y + 46, 62, 13);
  ctx.fillStyle = '#14100d'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y + 3);
  ctx.restore();
}
function storm() {
  ctx.fillStyle = 'rgba(20,28,64,.22)'; ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.strokeStyle = 'rgba(200,225,255,.5)'; ctx.lineWidth = 3;
  for (let i = 0; i < 420; i++) {
    const x = (i * 613) % (SIZE + 200) - 100, y = (i * 271) % SIZE, len = 30 + (i % 5) * 12;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - len * 0.28, y + len); ctx.stroke();
  }
  ctx.strokeStyle = '#fffbd0'; ctx.lineWidth = 15; ctx.shadowColor = '#fff2a0'; ctx.shadowBlur = 55;
  ctx.beginPath(); [[1350, -20], [1255, 240], [1345, 270], [1210, 580]].forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](x, y)); ctx.stroke();
  ctx.shadowBlur = 0;
}

/** A rubber stamp pressed over the picture. [text, colour, x, y, size] */
function stampMark(text, colour, x = SIZE / 2, y = SIZE - 330, size = 220) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(-0.16);
  ctx.font = impact(size); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + size * 0.55, h = size * 1.4;
  ctx.fillStyle = 'rgba(255,250,236,.9)';
  ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, 28); ctx.fill();
  ctx.strokeStyle = colour; ctx.lineWidth = 18; ctx.stroke();
  ctx.lineWidth = 6; ctx.beginPath(); ctx.roundRect(-w / 2 + 24, -h / 2 + 24, w - 48, h - 48, 16); ctx.stroke();
  ctx.fillStyle = colour; ctx.fillText(text, 0, 8);
  ctx.restore();
}
const spread = (i, a, b) => ((i * a) % b) / b; // the same scatter every time
function effects(spec) {
  if (spec.snow) {
    ctx.fillStyle = 'rgba(190,220,255,.2)'; ctx.fillRect(0, 0, SIZE, SIZE);
    for (let i = 0; i < 420; i++) { ctx.fillStyle = `rgba(255,255,255,${0.55 + spread(i, 7, 41) * 0.45})`; ctx.beginPath(); ctx.arc(spread(i, 613, 1009) * SIZE, spread(i, 397, 997) * SIZE, 2 + spread(i, 13, 29) * 8, 0, 7); ctx.fill(); }
  }
  if (spec.heat) {
    const g = ctx.createLinearGradient(0, 0, 0, SIZE);
    g.addColorStop(0, 'rgba(255,120,0,.34)'); g.addColorStop(1, 'rgba(255,60,0,.08)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.strokeStyle = 'rgba(255,235,170,.55)'; ctx.lineWidth = 9; ctx.lineCap = 'round';
    for (const [x, y] of [[250, 620], [340, 560], [1250, 640], [1350, 580], [1180, 520]]) { ctx.beginPath(); for (let k = 0; k <= 20; k++) ctx[k ? 'lineTo' : 'moveTo'](x + Math.sin(k * 0.8) * 22, y - k * 10); ctx.stroke(); }
  }
  if (spec.shootingStars) {
    for (const [x, y, len] of [[330, 340, 280], [1420, 420, 330], [1180, 290, 200], [560, 560, 170], [230, 640, 230]]) {
      const g = ctx.createLinearGradient(x, y, x + len, y - len * 0.55);
      g.addColorStop(0, 'rgba(255,255,220,.95)'); g.addColorStop(1, 'rgba(255,255,220,0)');
      ctx.strokeStyle = g; ctx.lineWidth = 9; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y - len * 0.55); ctx.stroke();
      ctx.fillStyle = '#fffbe0'; ctx.shadowColor = '#fff2a0'; ctx.shadowBlur = 30; ctx.beginPath(); ctx.arc(x, y, 10, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
    }
  }
  if (spec.confetti) {
    const colours = ['#e4333b', '#ffd84a', '#5dbb46', '#2f80ed', '#ff7ab6', '#ffffff'];
    for (let i = 0; i < 170; i++) {
      ctx.save(); ctx.translate(spread(i, 613, 1009) * SIZE, spread(i, 397, 997) * SIZE * 0.8); ctx.rotate(i * 2.4);
      ctx.fillStyle = colours[i % 6]; ctx.strokeStyle = '#14100d'; ctx.lineWidth = 2;
      ctx.fillRect(-14, -7, 28, 14); ctx.strokeRect(-14, -7, 28, 14); ctx.restore();
    }
  }
  if (spec.hearts) {
    for (const [x, y, s] of [[300, 520, 70], [1300, 470, 95], [1190, 760, 52], [390, 880, 48], [1420, 900, 62], [210, 720, 40]]) {
      ctx.beginPath(); ctx.moveTo(x, y + s * 0.75);
      ctx.bezierCurveTo(x - s * 1.5, y - s * 0.2, x - s * 0.7, y - s * 1.2, x, y - s * 0.35);
      ctx.bezierCurveTo(x + s * 0.7, y - s * 1.2, x + s * 1.5, y - s * 0.2, x, y + s * 0.75);
      ctx.fillStyle = '#e8344a'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 9; ctx.fill(); ctx.stroke();
    }
  }
  if (spec.zzz) for (const [i, size] of [90, 125, 165].entries()) outline('Z', spec.zzz[0] + i * 105, spec.zzz[1] - i * 110, size, '#cfe4ff');
}

// ---------------------------------------------------------------- framing
const CAMERAS = {
  face: { pos: [0, 1.98, 2.75], look: [0, 1.72, 0], fov: 29 },
  half: { pos: [0, 2.3, 4.75], look: [0, 1.62, 0], fov: 29 },
  full: { pos: [0, 2.35, 6.3], look: [0, 1.4, 0], fov: 29 },
  wide: { pos: [0, 2.6, 8.4], look: [0, 1.35, 0], fov: 31 },
  panel: { pos: [0, 2.4, 7.2], look: [0, 1.35, 0], fov: 29 }, // the middle half, a tall frame: words above, ground below
};

/** spec: see depot.mjs. words=false gives the blank template. */
function make(spec, words = true, mark = true) {
  if (spec.panels) return twoPanels(spec);
  const { renderer } = kit;
  renderer.setSize(SIZE, SIZE, false);
  const sc = { time: spec.time ?? 'day', spot: spec.spot ?? 'open', crops: spec.crops ?? ['pumpkin', 'tomato', 'watermelon', 'strawberry'] };
  const preset = CAMERAS[spec.camera ?? 'half'];
  const cam = new THREE.PerspectiveCamera(preset.fov, 1, 0.05, 140);
  // lift > 0 aims lower, so the cats and the things on the ground move up, clear of the bottom words
  const lift = spec.lift ?? 0;
  cam.position.set(preset.pos[0], preset.pos[1] - lift * 0.4, preset.pos[2]);
  cam.lookAt(preset.look[0], preset.look[1] - lift, preset.look[2]);
  cam.updateMatrixWorld();

  renderer.setClearColor(0x000000, 0);
  renderer.render(kit.garden(sc), cam);
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.filter = `blur(${spec.camera === 'face' ? 5 : 3}px) saturate(1.1)`;
  ctx.drawImage(renderer.domElement, -10, -10, SIZE + 20, SIZE + 20);
  ctx.filter = 'none';

  const T = kit.TIMES[sc.time];
  const dark = sc.time === 'night' || sc.time === 'dusk';
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(dark ? '#e6dcff' : '#fff6ea', '#6d6a4a', dark ? 1.35 : 1.45));
  const key = new THREE.DirectionalLight(dark ? '#ffe6d2' : '#fff0d8', dark ? 1.7 : 2.0);
  key.position.set(-2.5, 5, 4.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  Object.assign(key.shadow.camera, { left: -7, right: 7, top: 6, bottom: -3, near: 0.5, far: 22 });
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.015;
  scene.add(key);
  for (const x of [-3, 3]) { const rim = new THREE.DirectionalLight(T.rim[0], T.rim[1]); rim.position.set(x, 2.8, -2.6); scene.add(rim); }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(18, 10), new THREE.ShadowMaterial({ opacity: 0.34 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = 0.055; floor.receiveShadow = true;
  scene.add(floor);
  for (const c of spec.cats ?? []) scene.add(mihao(c));
  for (const p of spec.props ?? []) {
    const g = new THREE.Group();
    PROPS[p.kind](g, p);
    g.position.set(...(p.pos ?? [0, 0, 0]));
    g.rotation.set(...(p.rot ?? [0, 0, 0]));
    if (p.scale) g.scale.setScalar(p.scale);
    scene.add(g);
  }
  renderer.render(scene, cam);
  ctx.drawImage(renderer.domElement, 0, 0);

  if (spec.storm) storm();
  effects(spec);
  const v = ctx.createRadialGradient(SIZE / 2, SIZE * 0.46, SIZE * 0.36, SIZE / 2, SIZE / 2, SIZE * 0.77);
  v.addColorStop(0, 'rgba(10,6,0,0)'); v.addColorStop(1, 'rgba(10,6,0,.32)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, SIZE, SIZE);

  if (words && spec.stamp) stampMark(...spec.stamp);
  if (words) {
    if (spec.top) fitted(spec.top, 150, spec.topSize ?? 170, spec.topColor ?? '#fff');
    if (spec.bubble) bubble(...spec.bubble);
    if (spec.bottom) fitted(spec.bottom, SIZE - (spec.sub ? 225 : 150), spec.bottomSize ?? 170, spec.bottomColor ?? '#ffd84a');
    if (spec.sub) fitted(spec.sub, SIZE - 108, 76, '#fff');
  }
  if (mark) watermark();
  return out.toDataURL('image/jpeg', 0.92).split(',')[1];
}

function watermark() {
  ctx.font = impact(34); ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';
  ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(20,16,13,.85)'; ctx.strokeText('mihaomeme.garden', SIZE - 22, SIZE - 20);
  ctx.fillStyle = '#fff'; ctx.fillText('mihaomeme.garden', SIZE - 22, SIZE - 20);
}

/** Two scenes side by side, each with its own words above the cat. */
function twoPanels(spec) {
  const halves = spec.panels.map((panel) => {
    make({ ...panel, camera: 'panel', lift: 0 }, false, false);
    const half = document.createElement('canvas');
    half.width = SIZE / 2; half.height = SIZE;
    half.getContext('2d').drawImage(out, SIZE / 4, 0, SIZE / 2, SIZE, 0, 0, SIZE / 2, SIZE);
    return half;
  });
  ctx.clearRect(0, 0, SIZE, SIZE);
  halves.forEach((half, i) => {
    ctx.drawImage(half, (i * SIZE) / 2, 0);
    const size = 104;
    ctx.font = impact(size);
    const lines = [''];
    for (const word of spec.panels[i].label.split(' ')) {
      const next = `${lines.at(-1)} ${word}`.trim();
      if (ctx.measureText(next).width > SIZE / 2 - 80 && lines.at(-1)) lines.push(word); else lines[lines.length - 1] = next;
    }
    lines.forEach((line, n) => outline(line, (i * SIZE) / 2 + SIZE / 4, 110 + n * 122, size, i ? '#ffd84a' : '#fff'));
  });
  ctx.fillStyle = '#14100d'; ctx.fillRect(SIZE / 2 - 9, 0, 18, SIZE);
  watermark();
  return out.toDataURL('image/jpeg', 0.92).split(',')[1];
}

/** The wide picture that announces the depot: six of its memes as cards, a waving cat on each side. */
async function banner(cards, link) {
  const W = 2400, H = 1350;
  const { renderer } = kit;
  const pictures = await Promise.all(cards.map((src) => new Promise((done, fail) => { const i = new Image(); i.onload = () => done(i); i.onerror = fail; i.src = src; })));
  renderer.setSize(W, H, false);
  out.width = W; out.height = H;
  const sc = { time: 'sunrise', spot: 'open', crops: ['pumpkin', 'tomato', 'watermelon', 'strawberry'] };
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.05, 140);
  cam.position.set(0, 2.15, 8);
  cam.lookAt(0, 1.4, 0);
  cam.updateMatrixWorld();
  renderer.setClearColor(0x000000, 0);
  renderer.render(kit.garden(sc), cam);
  ctx.filter = 'blur(4px) saturate(1.1)';
  ctx.drawImage(renderer.domElement, -10, -10, W + 20, H + 20);
  ctx.filter = 'none';

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#fff6ea', '#6d6a4a', 1.5));
  const key = new THREE.DirectionalLight('#fff0d8', 2.0);
  key.position.set(-2.5, 5, 4.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  Object.assign(key.shadow.camera, { left: -8, right: 8, top: 6, bottom: -3, near: 0.5, far: 22 });
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.015;
  scene.add(key);
  for (const x of [-4, 4]) { const rim = new THREE.DirectionalLight(kit.TIMES.sunrise.rim[0], 2.0); rim.position.set(x, 2.8, -2.6); scene.add(rim); }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 10), new THREE.ShadowMaterial({ opacity: 0.34 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = 0.055; floor.receiveShadow = true;
  scene.add(floor);
  scene.add(mihao({ pose: 'wave', at: 0.55, x: -2.76, turn: 0.3 }));
  scene.add(mihao({ look: 'sailor', pose: 'wave', at: 1.0, x: 2.94, turn: -0.3 }));
  renderer.render(scene, cam);
  ctx.drawImage(renderer.domElement, 0, 0);

  const shade = ctx.createLinearGradient(0, 0, 0, 330);
  shade.addColorStop(0, 'rgba(30,10,0,.55)'); shade.addColorStop(1, 'rgba(30,10,0,0)');
  ctx.fillStyle = shade; ctx.fillRect(0, 0, W, 330);

  // two rows of three cards, each a little askew
  const size = 420, tilt = [-0.05, 0.018, 0.052, 0.04, -0.022, -0.048];
  pictures.forEach((picture, i) => {
    const x = W / 2 + ((i % 3) - 1) * 462, y = 525 + Math.floor(i / 3) * 442 + (i % 3 === 1 ? -8 : 10);
    ctx.save();
    ctx.translate(x, y); ctx.rotate(tilt[i]);
    ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 34; ctx.shadowOffsetY = 16;
    ctx.fillStyle = '#fff6df'; ctx.fillRect(-size / 2 - 14, -size / 2 - 14, size + 28, size + 28);
    ctx.shadowColor = 'transparent';
    ctx.drawImage(picture, -size / 2, -size / 2, size, size);
    ctx.lineWidth = 6; ctx.strokeStyle = '#17120f'; ctx.strokeRect(-size / 2 - 14, -size / 2 - 14, size + 28, size + 28);
    ctx.restore();
  });

  const centred = (text, y, px, fill) => {
    ctx.font = impact(px);
    while (ctx.measureText(text).width > W - 140) ctx.font = impact((px -= 4));
    outline(text, W / 2, y, px, fill);
  };
  centred('MIHAO MEME GARDEN DEPOT', 105, 150, '#ffd84a');
  centred('IS OPEN!', 232, 100, '#fff');

  ctx.font = impact(70);
  const w = ctx.measureText(link).width + 110;
  ctx.fillStyle = 'rgba(0,0,0,.38)'; ctx.beginPath(); ctx.roundRect(W / 2 - w / 2 + 10, H - 132, w, 108, 20); ctx.fill();
  ctx.fillStyle = '#17120f'; ctx.beginPath(); ctx.roundRect(W / 2 - w / 2, H - 142, w, 108, 20); ctx.fill();
  ctx.fillStyle = '#f2b632'; ctx.beginPath(); ctx.roundRect(W / 2 - w / 2 + 6, H - 136, w - 12, 96, 16); ctx.fill();
  ctx.fillStyle = '#b3181b'; ctx.beginPath(); ctx.roundRect(W / 2 - w / 2 + 13, H - 129, w - 26, 82, 12); ctx.fill();
  outline(link, W / 2, H - 87, 66, '#fff');

  const data = out.toDataURL('image/jpeg', 0.94).split(',')[1];
  renderer.setSize(SIZE, SIZE, false);
  out.width = out.height = SIZE;
  return data;
}

window.depot = { init, make, banner };
