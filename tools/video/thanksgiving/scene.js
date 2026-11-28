// Happy Thanksgiving video: a harvest feast built from the game's own cats, crops and props.
// render.mjs loads this page and asks for the frames one by one, in order.
import * as THREE from 'three';
import { Assets } from '../../../client/src/assets/assets.js';
import { Avatar } from '../../../client/src/render/characters.js';

export const W = 1920, H = 1080, FPS = 30;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const out = document.getElementById('out');
const ctx = out.getContext('2d');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(36, W / H, 0.1, 400);

let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

// ---------------------------------------------------------------- sky and light
{
  const c = document.createElement('canvas');
  c.width = 4; c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  for (const [at, col] of [[0, '#3f78d0'], [0.3, '#86aee6'], [0.46, '#ffc795'], [0.56, '#ffe2ae'], [1, '#ffe2ae']]) grad.addColorStop(at, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  scene.background = tex;
  scene.fog = new THREE.Fog('#f3cfa6', 36, 95);
}
scene.add(new THREE.HemisphereLight('#e6efff', '#6f5a3a', 1.35));
const sun = new THREE.DirectionalLight('#ffe6c2', 2.4);
sun.position.set(7, 11, 9);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 50 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun);
const rim = new THREE.DirectionalLight('#ff9d5c', 1.1);
rim.position.set(-9, 6, -8);
scene.add(rim);

// ---------------------------------------------------------------- blocky building helpers
const mats = new Map();
const mat = (color, o = {}) => {
  const k = color + JSON.stringify(o);
  if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...o }));
  return mats.get(k);
};
function mesh(geo, color, x, y, z, parent = scene, o) {
  const m = new THREE.Mesh(geo, typeof color === 'string' ? mat(color, o) : color);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
const box = (w, h, d, color, x, y, z, parent, o) => mesh(new THREE.BoxGeometry(w, h, d), color, x, y, z, parent, o);
const cyl = (r0, r1, h, color, x, y, z, parent, seg = 28, o) => mesh(new THREE.CylinderGeometry(r0, r1, h, seg), color, x, y, z, parent, o);
const ball = (r, color, x, y, z, parent, o) => mesh(new THREE.SphereGeometry(r, 20, 14), color, x, y, z, parent, o);
const tube = (pts, r, color, parent) => mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 20, r, 8), color, 0, 0, 0, parent);

// ---------------------------------------------------------------- the turkey (very much alive)
function makeTurkey() {
  const t = new THREE.Group();
  const body = new THREE.Group();
  t.add(body);
  const b = ball(0.46, '#7a4524', 0, 0.62, 0, body); b.scale.set(1.05, 0.95, 1.0);
  ball(0.3, '#8f5530', 0, 0.54, 0.24, body);
  const tail = new THREE.Group();
  tail.position.set(0, 0.7, -0.34);
  body.add(tail);
  const rows = [[11, 0.95, ['#a8321f', '#d4641f'], 0], [9, 0.74, ['#e89a26', '#f3b53b'], 0.05], [7, 0.52, ['#5a2f17', '#7a4524'], 0.1]];
  for (const [n, len, cols, dz] of rows) {
    for (let i = 0; i < n; i++) {
      const a = -1.5 + (3 * i) / (n - 1);
      const f = new THREE.Group();
      f.rotation.z = -a;
      f.position.z = dz;
      tail.add(f);
      box(0.17, len, 0.05, cols[i % 2], 0, len / 2, 0, f);
      cyl(0.085, 0.085, 0.05, cols[i % 2], 0, len, 0, f, 16).rotation.x = Math.PI / 2;
      cyl(0.045, 0.045, 0.06, '#fff1cf', 0, len, 0.004, f, 12).rotation.x = Math.PI / 2;
    }
  }
  for (const s of [-1, 1]) {
    const wing = box(0.1, 0.34, 0.46, '#5a2f17', s * 0.47, 0.6, 0, body);
    wing.rotation.z = s * 0.18;
    cyl(0.035, 0.035, 0.3, '#e89a26', s * 0.17, 0.15, 0.04, t, 10);
    box(0.17, 0.05, 0.24, '#e89a26', s * 0.17, 0.03, 0.11, t);
  }
  const head = new THREE.Group();
  head.position.set(0, 1.22, 0.3);
  body.add(head);
  tube([[0, 0.8, 0.28], [0, 1.02, 0.38], [0, 1.18, 0.31]], 0.095, '#b9553c', body);
  ball(0.19, '#c96a4c', 0, 0, 0, head);
  for (const s of [-1, 1]) {
    ball(0.062, '#ffffff', s * 0.085, 0.055, 0.14, head);
    ball(0.032, '#16100c', s * 0.083, 0.055, 0.196, head);
    box(0.11, 0.028, 0.03, '#3a1d10', s * 0.088, 0.13, 0.17, head).rotation.z = s * -0.22;
  }
  const beak = mesh(new THREE.ConeGeometry(0.07, 0.19, 4), '#f3b53b', 0, -0.015, 0.25, head);
  beak.rotation.x = Math.PI / 2;
  const wattle = ball(0.055, '#d3202a', 0.02, -0.15, 0.17, head); wattle.scale.set(0.8, 1.8, 0.8);
  // the Mihao beard: two long white whiskers, hidden until the turkey says the word
  const beard = new THREE.Group();
  head.add(beard);
  for (const s of [-1, 1]) {
    tube([[s * 0.02, -0.045, 0.24], [s * 0.13, -0.065, 0.24], [s * 0.18, -0.2, 0.23], [s * 0.15, -0.36, 0.24]], 0.021, '#fbf6ea', beard);
    mesh(new THREE.ConeGeometry(0.021, 0.09, 8), '#fbf6ea', s * 0.137, -0.4, 0.242, beard).rotation.z = Math.PI + s * -0.28;
  }
  beard.visible = false;
  t.userData = { head, beard, body, tail };
  return t;
}

// ---------------------------------------------------------------- food
function pie(x, y, z, s = 1) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.scale.setScalar(s);
  scene.add(g);
  cyl(0.33, 0.26, 0.11, '#c98a45', 0, 0.055, 0, g);
  cyl(0.29, 0.29, 0.025, '#d9661c', 0, 0.12, 0, g);
  mesh(new THREE.TorusGeometry(0.31, 0.045, 10, 32), '#e6ad62', 0, 0.12, 0, g).rotation.x = Math.PI / 2;
  ball(0.075, '#fff6e2', 0, 0.165, 0, g).scale.y = 0.75;
}
function fishPlatter(x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  scene.add(g);
  const plate = cyl(0.72, 0.62, 0.06, '#f4ede0', 0, 0.03, 0, g); plate.scale.z = 0.62;
  const body = ball(0.4, '#e8a02c', -0.06, 0.19, 0, g, { metalness: 0.45, roughness: 0.35 }); body.scale.set(1.3, 0.42, 0.62);
  const tail = mesh(new THREE.ConeGeometry(0.2, 0.28, 4), '#d98a1c', 0.55, 0.18, 0, g);
  tail.rotation.z = Math.PI / 2; tail.scale.z = 0.35;
  ball(0.04, '#fff', -0.42, 0.25, 0.14, g);
  ball(0.021, '#16100c', -0.43, 0.255, 0.175, g);
  for (let i = 0; i < 7; i++) ball(0.055, i % 2 ? '#4f8f2f' : '#d83a2a', -0.55 + i * 0.18, 0.09, 0.3 - Math.abs(i - 3) * 0.015, g);
}
function corn(x, y, z, ry) {
  const g = new THREE.Group();
  g.position.set(x, y + 0.09, z);
  g.rotation.y = ry;
  scene.add(g);
  const c = mesh(new THREE.CapsuleGeometry(0.085, 0.3, 6, 12), '#f4c430', 0, 0, 0, g);
  c.rotation.z = Math.PI / 2;
  for (let i = -3; i <= 3; i++) mesh(new THREE.TorusGeometry(0.086, 0.009, 6, 18), '#dca51f', i * 0.048, 0, 0, g).rotation.y = Math.PI / 2;
  const leaf = mesh(new THREE.ConeGeometry(0.09, 0.3, 6), '#7ea53a', 0.24, -0.02, 0, g);
  leaf.rotation.z = Math.PI / 2; leaf.scale.z = 0.5;
}
const flames = [];
function candle(x, y, z) {
  cyl(0.11, 0.13, 0.04, '#c99a2e', x, y + 0.02, z, scene, 18, { metalness: 0.7, roughness: 0.35 });
  cyl(0.05, 0.05, 0.34, '#fff1d0', x, y + 0.21, z, scene, 14);
  const f = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), new THREE.MeshBasicMaterial({ color: '#ffcf4a' }));
  f.position.set(x, y + 0.45, z);
  scene.add(f);
  const light = new THREE.PointLight('#ffb14a', 1.4, 3.2, 2);
  light.position.copy(f.position);
  scene.add(light);
  flames.push({ f, light, p: rnd() * 9 });
}
function cup(x, y, z) {
  cyl(0.085, 0.07, 0.2, '#b3181b', x, y + 0.1, z, scene, 18, { roughness: 0.4 });
  cyl(0.087, 0.087, 0.03, '#f2b632', x, y + 0.19, z, scene, 18, { metalness: 0.6, roughness: 0.35 });
}

function pumpkin(x, y, z, size, ry = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;
  scene.add(g);
  const r = size / 2;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const lobe = ball(r * 0.52, i % 2 ? '#f07a14' : '#e56a0c', Math.sin(a) * r * 0.5, r * 0.72, Math.cos(a) * r * 0.5, g, { roughness: 0.5 });
    lobe.scale.set(0.85, 1.38, 1);
    lobe.rotation.y = a;
  }
  const stem = cyl(r * 0.08, r * 0.14, r * 0.45, '#4f6b22', 0, r * 1.5, 0, g, 8);
  stem.rotation.z = 0.28;
}

// ---------------------------------------------------------------- the feast
const TOP = 1.02; // table top height
const cats = [];
let turkey, assets;
const leaves = [];

export async function build() {
  assets = await new Assets(renderer).init();

  // ground
  const ground = mesh(new THREE.CircleGeometry(90, 64), '#6f8f3a', 0, 0, 0);
  ground.rotation.x = -Math.PI / 2;
  ground.castShadow = false;
  const patch = ['#7b9c40', '#628233', '#8aa645', '#7d8a38'];
  for (let i = 0; i < 520; i++) {
    const x = (rnd() - 0.5) * 60, z = (rnd() - 0.62) * 46;
    const s = 0.5 + rnd() * 1.2;
    const q = box(s, 0.012 + rnd() * 0.012, s, patch[i % 4], x, 0.004, z);
    q.castShadow = false;
  }
  // a plank floor under the table
  for (let i = 0; i < 24; i++) box(0.56, 0.05, 7.4, i % 2 ? '#9a6233' : '#8a562b', -6.6 + i * 0.575, 0.03, -0.2);

  // table: boards, red runner with gold edges, legs
  for (let i = 0; i < 5; i++) box(8.6, 0.12, 0.34, i % 2 ? '#a86a35' : '#b87840', 0, TOP - 0.06, -0.69 + i * 0.345);
  box(8.5, 0.012, 0.78, '#a81c20', 0, TOP + 0.006, 0);
  for (const s of [-1, 1]) {
    box(8.5, 0.014, 0.05, '#f2b632', 0, TOP + 0.008, s * 0.34);
    box(0.78, 0.4, 0.02, '#a81c20', s * 4.31, TOP - 0.2, 0).rotation.y = Math.PI / 2;
    for (const x of [-4, 4]) box(0.2, TOP - 0.1, 0.2, '#7a4a22', x, (TOP - 0.1) / 2, s * 0.6);
  }
  fishPlatter(-1.25, TOP, 0.1);
  fishPlatter(1.35, TOP, 0.1);
  pie(0, TOP, 0.22, 1.12);
  pie(-2.75, TOP, 0.3);
  pie(2.8, TOP, 0.28);
  for (const [x, z, r] of [[-3.5, 0.35, 0.4], [-0.62, 0.5, -0.3], [0.7, 0.52, 0.5], [3.6, 0.3, -0.5], [-2.15, -0.3, 1.2]]) corn(x, TOP, z, r);
  for (const x of [-2.05, 2.05]) candle(x, TOP, -0.1);
  candle(-3.85, TOP, -0.2); candle(3.85, TOP, -0.2);
  for (const x of [-3.15, -1.9, -0.5, 0.55, 2.2, 3.25]) cup(x, TOP, 0.52);

  // the game's own crops as decorations
  const crop = async (id, x, y, z, s, ry = 0) => {
    const { fruit } = await assets.crop(id);
    const g = new THREE.Group();
    const f = fruit.clone(true);
    f.position.set(0, 0, 0);
    f.visible = true;
    g.add(f);
    const bb = new THREE.Box3().setFromObject(g);
    const size = bb.getSize(new THREE.Vector3());
    const k = s / Math.max(size.x, size.y, size.z);
    f.scale.multiplyScalar(k);
    const bb2 = new THREE.Box3().setFromObject(g);
    const c = bb2.getCenter(new THREE.Vector3());
    f.position.x -= c.x; f.position.z -= c.z; f.position.y -= bb2.min.y;
    g.position.set(x, y, z);
    g.rotation.y = ry;
    g.traverse((o) => { if (o.isMesh) { o.visible = true; o.castShadow = true; o.receiveShadow = true; } });
    scene.add(g);
  };
  pumpkin(-4.0, TOP, 0.22, 0.52, 0.4);
  pumpkin(4.05, TOP, 0.2, 0.48, 2.1);
  await crop('watermelon', -2.0, TOP, 0.34, 0.34, 0.8);
  await crop('pear', 0.62, TOP, -0.25, 0.3);
  await crop('mango', -0.6, TOP, -0.25, 0.28);
  await crop('nectarine', 2.45, TOP, -0.3, 0.26);
  await crop('banana', -3.1, TOP, -0.25, 0.34, 1.1);
  await crop('pineapple', 3.15, TOP, -0.28, 0.52);
  for (const [x, z, s] of [[-5.3, 1.3, 1.1], [-5.9, 0.4, 0.8], [-4.75, 2.0, 0.65], [5.25, 1.2, 1.15], [5.95, 0.35, 0.75], [4.75, 2.05, 0.6], [-7.4, -2.2, 1.0], [7.5, -2.0, 0.95], [-3.4, 1.9, 0.42]]) pumpkin(x, 0.05, z, s * 0.9, rnd() * 6);

  // autumn trees, far enough back to frame the table
  const autumn = ['#d9541e', '#e8872a', '#f2b632', '#b83a24', '#c96a1f'];
  const prop = async (id, x, z, s = 1, ry = 0, y = 0) => {
    const g = (await assets.prop(id)).scene.clone(true);
    g.position.set(x, y, z);
    g.scale.setScalar(s);
    g.rotation.y = ry;
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(g);
    return g;
  };
  const leafy = new Map();
  const spots = [[-9, -7], [-13, -2], [-6.5, -11], [9.5, -7], [13, -2.5], [6.5, -11.5], [-1.5, -15], [3, -17], [-17, -9], [17, -9], [-12, -16], [12, -16], [-22, -3], [22, -3], [-5, -22], [8, -23], [-19, -20], [19, -20], [-27, -14], [27, -14], [0, -28]];
  for (let i = 0; i < spots.length; i++) {
    const [x, z] = spots[i];
    const g = await prop(['tree_oak', 'tree_round', 'tree_birch'][i % 3], x, z, 1.0 + rnd() * 0.35, rnd() * 6);
    const col = autumn[i % autumn.length];
    g.traverse((o) => {
      if (!o.isMesh || !/foliage|blossom|leaf/i.test(o.material.name)) return;
      const k = `${o.material.uuid}${col}`;
      if (!leafy.has(k)) {
        const m = o.material.clone();
        m.vertexColors = false; m.map = null; m.alphaTest = 0; m.color = new THREE.Color(col);
        leafy.set(k, m);
      }
      o.material = leafy.get(k);
    });
  }
  await prop('home_cottage', -9.2, -12.5, 1.0, 0.5);
  await prop('scarecrow', 6.6, -3.6, 1.1, -0.45);
  await prop('lamp', -6.4, -2.4, 1.0);
  await prop('lamp', 6.2, -1.6, 1.0);
  await prop('crate', -6.5, 1.7, 0.9, 0.4);
  for (let i = -9; i <= 9; i += 2.2) await prop('fence', i * 1.25, -8.6, 1);

  // strings of flags above the table
  for (const [y, z] of [[4.25, -2.6], [4.7, -4.2]]) {
    const pts = [];
    for (let i = 0; i <= 28; i++) { const x = -8 + (i / 28) * 16; pts.push([x, y - Math.sin((i / 28) * Math.PI * 2) ** 2 * 0.38, z]); }
    tube(pts, 0.015, '#4a2c14', scene);
    for (let i = 1; i < 28; i++) {
      const f = mesh(new THREE.ConeGeometry(0.17, 0.4, 3), autumn[(i + Math.round(y)) % autumn.length], pts[i][0], pts[i][1] - 0.22, z, scene);
      f.rotation.x = Math.PI; f.scale.z = 0.12;
    }
  }

  // the cats
  const farmer = await assets.character('farmer');
  const guest = (x, z, ry, look, scale = 1) => {
    const a = new Avatar(farmer, assets.mats, { scale });
    a.applyProfile({ hat: 'bare', shirt: 'plaid_red', pants: 'denim', shoes: 'boots', skin: null, hair: null, beard: 'classic', height: scale, ...look });
    a.root.position.set(x, 0.05, z);
    a.root.rotation.y = ry;
    scene.add(a.root);
    cats.push(a);
    return a;
  };
  guest(0, -1.35, 0, { hat: 'mandarin', pants: 'legs_navy', shoes: 'feet_court' }, 1.1); // the host
  guest(-1.9, -1.3, 0.1, { hat: 'lime_hood', shirt: 'top_lime', pants: 'legs_track', shoes: 'feet_sneaker' });
  guest(1.95, -1.3, -0.1, { hat: 'sailor_hat', shirt: 'top_sailor', pants: 'legs_sailor', shoes: 'feet_sandal' });
  guest(-3.65, -1.15, 0.28, { hat: 'ghost_hood', shirt: 'top_ghost', pants: 'legs_pyjama', shoes: 'feet_bunny' });
  guest(3.7, -1.15, -0.28, { hat: 'captain_cap', shirt: 'top_captain', pants: 'legs_captain', shoes: 'feet_court', beard: 'curly' });
  guest(-5.0, 0.1, 1.15, { hat: 'phoenix_hood', shirt: 'top_phoenix', pants: 'denim', shoes: 'feet_rocket' }, 0.94);

  for (const [id, x, z, ry, s] of [['pet_dog', -2.45, 2.1, 0.35, 1.6], ['pet_bunny', 2.4, 2.2, -0.35, 1.6], ['pet_capybara', 4.1, 1.75, -0.6, 1.4]]) {
    const a = new Avatar(await assets.character(id), assets.mats, { scale: s });
    a.root.position.set(x, 0.05, z);
    a.root.rotation.y = ry;
    scene.add(a.root);
    cats.push(a);
  }

  // the turkey: its own seat at the right end of the table
  turkey = makeTurkey();
  scene.add(turkey);

  // falling leaves
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.5); shape.quadraticCurveTo(0.42, 0.18, 0, -0.5); shape.quadraticCurveTo(-0.42, 0.18, 0, 0.5);
  const lg = new THREE.ShapeGeometry(shape, 8);
  for (let i = 0; i < 190; i++) {
    const m = new THREE.Mesh(lg, new THREE.MeshStandardMaterial({ color: autumn[i % autumn.length], side: THREE.DoubleSide, roughness: 0.8, emissive: autumn[i % autumn.length], emissiveIntensity: 0.18 }));
    m.scale.setScalar(0.11 + rnd() * 0.12);
    scene.add(m);
    leaves.push({ m, x: (rnd() - 0.5) * 18, z: -9 + rnd() * 14, y: rnd() * 8, v: 0.45 + rnd() * 0.55, p: rnd() * 6.28, w: 0.2 + rnd() * 0.5 });
  }
  // a few lying on the ground
  for (let i = 0; i < 240; i++) {
    const m = new THREE.Mesh(lg, leaves[i % leaves.length].m.material);
    m.scale.setScalar(0.12 + rnd() * 0.12);
    m.rotation.set(-Math.PI / 2, 0, rnd() * 6.28);
    m.position.set((rnd() - 0.5) * 24, 0.068 + rnd() * 0.008, -7 + rnd() * 13);
    scene.add(m);
  }
  await document.fonts.ready;
}

// ---------------------------------------------------------------- shots
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const back = (t) => { t = Math.max(0, Math.min(1, t)); return 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2; };
const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);

// the turkey stands on the floor beside the host for the opening, then takes its seat at the table
const STAGE = { x: 0, y: 0.05, z: 3.4 };
const SEAT = { x: 5.05, y: 0.05, z: 0.25 };

/** Every shot: when it starts, how long, camera from -> to as [px,py,pz, lx,ly,lz, fov], and its words. */
export const SHOTS = [
  { id: 'ask', len: 2.5, cam: [[0, 2.5, 2.4, 0, 1.76, -1.35, 33], [0, 2.4, 1.6, 0, 1.86, -1.35, 31]], hide: true, big: [[0.4, 'ANY LAST WORDS?']] },
  { id: 'turkey', len: 3.0, cam: [[0.25, 1.55, 8.1, 0, 0.78, 3.4, 31], [0.1, 1.46, 6.9, 0, 0.83, 3.4, 30]], big: [[1.15, 'MIHAO.', 'gold']] },
  { id: 'spared', len: 2.5, cam: [[0, 2.38, 2.1, 0, 1.84, -1.35, 31], [0, 2.4, 1.6, 0, 1.88, -1.35, 30]], hide: true, big: [[0.25, 'RESPECT. PULL UP A CHAIR.']] },
  { id: 'title', len: 3.5, cam: [[-2.8, 4.1, 13.2, 0, 2.25, -1, 34], [0, 3.5, 12.0, 0, 2.2, -1, 33]], title: true },
  { id: 'left', len: 2.5, cam: [[-5.6, 2.7, 5.6, -3.0, 1.45, -0.8, 34], [-2.6, 2.6, 5.7, -1.9, 1.5, -0.9, 34]], cap: 'THANKFUL FOR THE HARVEST', sub: 'pumpkin pie. very mihao.' },
  { id: 'right', len: 2.5, cam: [[2.2, 2.6, 5.9, 2.2, 1.4, -0.6, 34], [5.7, 2.65, 5.6, 3.6, 1.3, -0.3, 34]], cap: 'THANKFUL FOR NEW FRIENDS', sub: 'turkey is safe. mihao.' },
  { id: 'you', len: 2.5, cam: [[0, 2.9, 6.8, 0, 1.75, -1.2, 33], [0, 2.55, 4.6, 0, 1.95, -1.3, 32]], cap: 'THANKFUL FOR YOU', sub: 'every gardener. very mihao.' },
  { id: 'end', len: 5.0, cam: [[0, 3.2, 10.8, 0, 2.15, -1, 35], [0, 3.8, 12.6, 0, 2.3, -1, 35]], end: true },
];
let at = 0;
for (const s of SHOTS) { s.at = at; at += s.len; }
export const DURATION = at;

// ---------------------------------------------------------------- words
const font = (s) => `${s}px Impact, "Arial Narrow", sans-serif`;
function words(text, x, y, size, { fill = '#fff', scale = 1, angle = 0, alpha = 1 } = {}) {
  if (scale <= 0.02 || alpha <= 0.02) return;
  ctx.save();
  ctx.translate(x, y); ctx.rotate((angle * Math.PI) / 180); ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;
  ctx.font = font(size);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(6, size / 6);
  ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.strokeText(text, size / 22, size / 16);
  ctx.strokeStyle = '#17120f'; ctx.strokeText(text, 0, 0);
  ctx.fillStyle = fill; ctx.fillText(text, 0, 0);
  ctx.restore();
}
function banner(text, x, y, size, { scale = 1, angle = -2.2, alpha = 1 } = {}) {
  if (scale <= 0.02 || alpha <= 0.02) return;
  ctx.save();
  ctx.translate(x, y); ctx.rotate((angle * Math.PI) / 180); ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;
  ctx.font = font(size);
  const w = ctx.measureText(text).width + size * 1.1, h = size * 1.44;
  for (const [pad, col, dx] of [[0, 'rgba(0,0,0,.4)', 12], [0, '#17120f', 0], [6, '#f2b632', 0], [14, '#b3181b', 0]]) {
    ctx.fillStyle = col;
    ctx.fillRect(-w / 2 + pad + dx, -h / 2 + pad + dx, w - pad * 2, h - pad * 2);
  }
  ctx.restore();
  words(text, x, y, size, { scale, angle, alpha });
}
function pill(text, x, y, size, scale) {
  if (scale <= 0.02) return;
  ctx.save();
  ctx.translate(x, y); ctx.rotate((-2.2 * Math.PI) / 180); ctx.scale(scale, scale);
  ctx.font = font(size);
  const w = ctx.measureText(text).width + 56;
  ctx.fillStyle = 'rgba(23,18,15,.92)';
  ctx.beginPath(); ctx.roundRect(-w / 2, -size * 0.7, w, size * 1.4, 10); ctx.fill();
  ctx.restore();
  words(text, x, y, size, { fill: '#ffe996', scale, angle: -2.2 });
}

// ---------------------------------------------------------------- one frame
let current = null;
export function frame(n) {
  const T = n / FPS, dt = 1 / FPS;
  const i = Math.max(0, SHOTS.findLastIndex((s) => s.at <= T + 1e-6));
  const s = SHOTS[i], t = T - s.at, p = Math.min(1, t / s.len);

  if (current !== s.id) {
    current = s.id;
    const host = cats[0];
    if (s.id === 'ask' || s.id === 'spared') host.play('stance');
    if (s.id === 'title') { host.play('idle'); cats.forEach((a, k) => { if (k < 6) a.oneShot('wave'); }); }
    if (s.id === 'right') cats[4].oneShot('wave');
    if (s.id === 'you') host.play('point');
    if (s.id === 'end') cats.slice(0, 6).forEach((a) => a.play('dance'));
  }
  // happy hops on the beat while they celebrate
  if (['title', 'left', 'right', 'end'].includes(s.id)) {
    const beat = Math.floor(T / 0.5);
    if (Math.floor((T - dt) / 0.5) !== beat) cats[(beat * 4) % cats.length]?.cheer(0.45);
    if (s.id === 'end' && beat % 4 === 0 && Math.floor((T - dt) / 0.5) !== beat) cats.forEach((a) => a.cheer(0.55));
  }
  for (const a of cats) a.tick(dt);

  // the turkey
  const opening = i < 3;
  const where = opening ? STAGE : SEAT;
  const tk = turkey.userData;
  turkey.position.set(where.x, where.y, where.z);
  turkey.rotation.y = opening ? 0 : -0.55;
  turkey.scale.setScalar(opening ? 1 : 1.3);
  turkey.visible = !s.hide;
  const said = !opening || (s.id === 'turkey' && t >= 1.15);
  tk.beard.visible = said;
  tk.beard.scale.setScalar(s.id === 'turkey' ? Math.max(0.01, back((t - 1.15) / 0.3)) : 1);
  // it trembles before the answer, then holds its head high
  const nervous = s.id === 'turkey' && t < 1.15;
  turkey.position.x += nervous ? Math.sin(T * 55) * 0.012 : 0;
  tk.head.rotation.z = nervous ? Math.sin(T * 9) * 0.07 : Math.sin(T * 2.2) * 0.04;
  tk.head.rotation.x = said ? -0.06 : 0.1;
  tk.body.position.y = said && !nervous ? Math.abs(Math.sin(T * Math.PI * 2)) * (opening ? 0 : 0.06) : 0;
  tk.tail.scale.setScalar(s.id === 'turkey' && t >= 1.15 ? 1 + 0.14 * back((t - 1.15) / 0.35) : 1);

  for (const l of leaves) {
    const y = ((l.y - T * l.v) % 8 + 8) % 8;
    l.m.position.set(l.x + Math.sin(T * 1.3 + l.p) * l.w, y + 0.1, l.z + Math.cos(T * 0.9 + l.p) * l.w * 0.6);
    l.m.rotation.set(T * 1.4 + l.p, T * 0.9 + l.p * 2, Math.sin(T + l.p));
    // none right in front of the lens in the close-ups
    l.m.visible = l.m.position.distanceTo(camera.position) > 3.2;
  }
  for (const c of flames) {
    const k = 1 + Math.sin(T * 17 + c.p) * 0.13 + Math.sin(T * 29 + c.p * 2) * 0.08;
    c.f.scale.set(1, 1.7 * k, 1);
    c.light.intensity = 1.4 * k;
  }

  const k = ease(p);
  const [px, py, pz, lx, ly, lz, fov] = mix(s.cam[0], s.cam[1], k);
  let shake = 0;
  if (s.id === 'turkey' && t >= 1.15) shake = Math.max(0, 1 - (t - 1.15) / 0.3) * 0.07;
  camera.position.set(px + Math.sin(T * 71) * shake, py + Math.cos(T * 83) * shake, pz);
  camera.lookAt(lx, ly, lz);
  camera.fov = fov;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);

  ctx.drawImage(renderer.domElement, 0, 0, W, H);
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.42, W / 2, H / 2, H * 1.05);
  v.addColorStop(0, 'rgba(40,10,0,0)'); v.addColorStop(1, 'rgba(30,10,0,.3)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);

  for (const [when, text, tone] of s.big ?? []) {
    if (t < when) continue;
    const gold = tone === 'gold';
    words(text, W / 2, H - (gold ? 150 : 140), gold ? 210 : text.length > 18 ? 112 : 150, { fill: gold ? '#ffd84a' : '#fff', scale: back((t - when) / 0.28), angle: gold ? -4 : 0 });
  }
  if (s.title) {
    words('HAPPY', W / 2, 150, 190, { fill: '#fff', scale: back((t - 0.1) / 0.32), angle: -3 });
    if (t > 0.5) words('THANKSGIVING', W / 2, 345, 235, { fill: '#ffd84a', scale: back((t - 0.5) / 0.32), angle: -3 });
    if (t > 1.3) banner('FROM MIHAO MEME GARDEN', W / 2, H - 130, 76, { scale: back((t - 1.3) / 0.3) });
  }
  if (s.cap) {
    const leave = Math.max(0, Math.min(1, (t - (s.len - 0.14)) / 0.14));
    banner(s.cap, W / 2, H - 178 + leave * 90, 88, { scale: t > 0.08 ? back((t - 0.08) / 0.3) : 0, alpha: 1 - leave });
    if (t > 0.45) pill(s.sub, W / 2, H - 68 + leave * 90, 52, back((t - 0.45) / 0.25) * (leave ? 1 - leave : 1));
  }
  if (s.end) {
    words('HAPPY THANKSGIVING', W / 2, 145, 170, { fill: '#ffd84a', scale: back(t / 0.32), angle: -2 });
    if (t > 0.45) words('stay thankful. stay mihao.', W / 2, 305, 78, { scale: back((t - 0.45) / 0.3), angle: -2 });
    if (t > 1.0) banner('MIHAO MEME GARDEN', W / 2, H - 205, 94, { scale: back((t - 1.0) / 0.3) });
    if (t > 1.5) pill('mihaomeme.garden   #MihaoGarden', W / 2, H - 78, 56, back((t - 1.5) / 0.3));
  }

  // a quick warm flash on each cut, then fades at both ends
  if (i && t < 0.1) { ctx.fillStyle = `rgba(255,244,222,${0.6 * (1 - t / 0.1)})`; ctx.fillRect(0, 0, W, H); }
  const dark = Math.max(T < 0.4 ? 1 - T / 0.4 : 0, T > DURATION - 0.6 ? (T - (DURATION - 0.6)) / 0.6 : 0);
  if (dark > 0) { ctx.fillStyle = `rgba(0,0,0,${Math.min(1, dark)})`; ctx.fillRect(0, 0, W, H); }
}

window.video = { build, frame, SHOTS, DURATION, FPS, jpeg: () => out.toDataURL('image/jpeg', 0.95).split(',')[1] };
