// Meme pictures of the admin cats in the Mihao Meme Garden. The garden is built from the game's own trees,
// crops and props; every cat gets its own corner and time of day. Driven by memes.mjs.
import * as THREE from 'three';
import { Assets } from '../../../client/src/assets/assets.js';
import { Avatar } from '../../../client/src/render/characters.js';
import { LOOKS, buildAdmin, heat } from './looks.js';

const SIZE = 2048;
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(SIZE, SIZE, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const out = document.createElement('canvas');
out.width = out.height = SIZE;
const ctx = out.getContext('2d', { willReadFrequently: true });

let assets, farmer;
const props = new Map(), crops = new Map();

/** Time of day: sky from top to horizon, haze, and the colours of the lights. */
const TIMES = {
  sunrise: { sky: ['#274a9c', '#ef8f78', '#ffe29a'], fog: '#ffd39a', hemi: ['#ffeeda', '#66702e', 1.35], sun: ['#ffd490', 2.5], rim: ['#ffb450', 2.4], cloud: '#fff0d2', hill: '#7c9a3e', glow: 'rgba(255,206,100,.5)', lamps: 0.4 },
  day: { sky: ['#2f7fe0', '#7fc0f5', '#d8f0ff'], fog: '#cfe8f6', hemi: ['#eaf4ff', '#5f7a38', 1.45], sun: ['#fff0d4', 2.4], rim: ['#ffe6b8', 1.2], cloud: '#ffffff', hill: '#6fae48', glow: 'rgba(255,244,200,.34)', lamps: 0 },
  golden: { sky: ['#4a72c4', '#f1a877', '#ffe0a3'], fog: '#f6cf9c', hemi: ['#ffe9d0', '#6d6a30', 1.3], sun: ['#ffd08a', 2.6], rim: ['#ff9f4a', 1.9], cloud: '#ffe6cc', hill: '#8c9e3c', glow: 'rgba(255,190,90,.42)', lamps: 0.5 },
  blossom: { sky: ['#6f9be8', '#d9b6e8', '#ffe3ea'], fog: '#f4d9e6', hemi: ['#fff0f6', '#6f8a52', 1.5], sun: ['#fff0e6', 2.1], rim: ['#ffc0dc', 1.5], cloud: '#fff4f8', hill: '#86b86a', glow: 'rgba(255,214,235,.4)', lamps: 0 },
  dusk: { sky: ['#1d2360', '#7a3f8a', '#f0835c'], fog: '#8a557a', hemi: ['#c9b6ff', '#3f3a2c', 1.15], sun: ['#ffb08a', 1.8], rim: ['#ff6a8a', 2.2], cloud: '#b57a9e', hill: '#4a5a3a', glow: 'rgba(255,130,110,.32)', lamps: 1.6 },
  night: { sky: ['#050a24', '#142458', '#35508c'], fog: '#223464', hemi: ['#a9bfff', '#1f2a24', 1.0], sun: ['#bcd0ff', 1.4], rim: ['#ffb04a', 2.4], cloud: '#33477a', hill: '#1f3a34', glow: 'rgba(255,180,80,.26)', lamps: 2.6 },
};

/** Each cat's corner of the garden and its words. */
const SCENES = {
  'green-hoodie': { time: 'golden', spot: 'beds', crops: ['pumpkin', 'tomato', 'watermelon', 'pepper'], caption: 'CHILLING IN THE GARDEN', sub: 'very relaxed. very mihao.' },
  'orange-bun': { time: 'blossom', spot: 'blossom', crops: ['cherryblossom', 'strawberry', 'pinklily', 'tomato'], caption: 'WATER FIRST. TALK LATER.', sub: 'the garden comes first.' },
  'turban-cape': { time: 'day', spot: 'bamboo', crops: ['dragonfruit', 'eggplant', 'beanstalk', 'watermelon'], caption: 'MY BEARD IS LONGER', sub: 'and my beans are taller.' },
  'helmet-pilot': { time: 'day', spot: 'mill', crops: ['pineapple', 'tomato', 'carrot', 'blueberry'], caption: 'CLEARED FOR HARVEST', sub: 'sky balloon departs soon. mihao.' },
  'team-china': { time: 'golden', spot: 'market', crops: ['mango', 'pear', 'nectarine', 'tomato'], caption: 'GOOD FORTUNE, GARDENER', sub: 'big harvest today. mihao.' },
  'lucky-dice': { time: 'night', spot: 'plaza', crops: ['starflower', 'moonblossom', 'orchid', 'candyblossom'], caption: 'FEELING LUCKY?', sub: 'rare crops grow at night.' },
  thermal: { time: 'day', spot: 'beds', crops: ['pepper', 'cactus', 'tomato', 'pumpkin'], caption: 'HOT CROPS DETECTED', sub: 'temperature: very mihao.', thermal: true },
  'red-puffer': { time: 'dusk', spot: 'plaza', crops: ['pepper', 'dragonfruit', 'strawberry', 'cacao'], caption: 'ANY LAST WORDS?', sub: 'before you pick my peppers.' },
  'pink-hair': { time: 'dusk', spot: 'blossom', crops: ['candyblossom', 'strawberry', 'cherryblossom', 'sugarapple'], caption: 'WHO TOUCHED MY CROPS?', sub: 'mihao is not amused.' },
  ansem: { time: 'golden', spot: 'market', crops: ['watermelon', 'tomato', 'pumpkin', 'strawberry'], caption: 'GARDEN SECURITY', sub: 'no pests allowed. mihao.' },
  'cinnamon-knight': { time: 'golden', spot: 'castle', crops: ['pumpkin', 'strawberry', 'cacao', 'pepper'], caption: 'DEFEND THE CINNAMON', sub: 'sir mihao is on duty.' },
};

async function init() {
  assets = await new Assets(renderer).init();
  farmer = await assets.character('farmer');
  for (const id of ['tree_oak', 'tree_round', 'tree_birch', 'tree_pine', 'bush', 'fence', 'flowers', 'fountain', 'lamp', 'bench', 'crate', 'home_cottage', 'home_castle', 'home_windmill', 'home_treehouse', 'stall_market', 'stall_seeds', 'arch', 'scarecrow', 'gnome', 'goldgnome', 'birdbath', 'minimill', 'balloon', 'rock0', 'rock1']) props.set(id, (await assets.prop(id)).scene);
  for (const id of ['bamboo', ...Object.values(SCENES).flatMap((sc) => sc.crops)]) if (!crops.has(id)) crops.set(id, await assets.crop(id));
  await document.fonts.ready;
}

let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

// ---------------------------------------------------------------- the garden
function garden(sc) {
  const T = TIMES[sc.time];
  seed = [...sc.spot, ...sc.time, ...sc.crops.join('')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 2147483646, 7) + 1;
  const scene = new THREE.Scene();
  const sky = document.createElement('canvas');
  sky.width = 4; sky.height = 512;
  const g = sky.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, T.sky[0]); grad.addColorStop(0.17, T.sky[1]); grad.addColorStop(0.31, T.sky[2]); grad.addColorStop(1, T.sky[2]);
  g.fillStyle = grad; g.fillRect(0, 0, 4, 512);
  scene.background = new THREE.CanvasTexture(sky);
  scene.background.colorSpace = THREE.SRGBColorSpace;
  scene.fog = new THREE.Fog(T.fog, 18, 70);
  scene.add(new THREE.HemisphereLight(T.hemi[0], T.hemi[1], T.hemi[2]));
  const sun = new THREE.DirectionalLight(T.sun[0], T.sun[1]);
  sun.position.set(-7, 10, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 45 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);

  const shadowed = (o) => o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  const add = (id, x, z, s = 1, ry = 0, y = 0) => {
    const o = props.get(id).clone(true);
    o.position.set(x, y, z); o.scale.setScalar(s); o.rotation.y = ry;
    shadowed(o); scene.add(o);
    return o;
  };
  const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...o });
  const box = (w, h, d, mat, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof mat === 'string' ? std(mat) : mat);
    m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true; scene.add(m);
    return m;
  };
  const textured = (name, repeat, color) => {
    const src = assets.mats[name];
    const m = std(color, { roughness: 0.95 });
    if (src?.map) { m.map = src.map.clone(); m.map.repeat.set(repeat, repeat); m.map.needsUpdate = true; }
    return m;
  };

  // lawn with soft patches, and a stone path leading back from the cat
  const lawn = new THREE.Mesh(new THREE.CircleGeometry(80, 80), std('#68a83c'));
  lawn.rotation.x = -Math.PI / 2; lawn.receiveShadow = true; scene.add(lawn);
  const greens = ['#74b544', '#5d9a35', '#7dbd4a', '#639f39'];
  for (let i = 0; i < 700; i++) { const s = 0.25 + rnd() * 0.75; box(s, 0.012, s, greens[i % 4], (rnd() - 0.5) * 44, 0.004 + rnd() * 0.008, 3 - rnd() * 34).castShadow = false; }
  const stones = ['#e8c795', '#dcb885', '#efd3a5', '#d5ad7a'];
  for (let z = 3; z > -17; z -= 0.46) for (let i = -2; i <= 2; i++) {
    const bend = Math.sin(z * 0.2) * 0.6;
    box(0.43, 0.05, 0.43, stones[Math.floor(rnd() * 4)], i * 0.455 + bend + (Math.round(z / 0.46) % 2 ? 0.1 : 0), 0.022 + rnd() * 0.006, z).castShadow = false;
  }

  // crop beds on both sides of the path: wooden frames, dark soil and the game's grown crops with their fruit
  const soil = textured('soil', 2, '#6b3f1f');
  const plant = (id, x, z, s) => {
    const model = crops.get(id);
    const group = new THREE.Group();
    const stem = model.stages[4].clone(true);
    stem.position.set(0, 0, 0); stem.visible = true;
    group.add(stem);
    for (const a of model.anchors) {
      const f = model.fruit.clone(true);
      f.position.copy(a.pos); f.visible = true; f.scale.multiplyScalar(1.45); // plump fruit reads from afar
      group.add(f);
    }
    group.traverse((o) => { o.visible = true; if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const size = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
    group.scale.setScalar(Math.min(s / Math.max(size.y, 0.3), (s * 1.3) / Math.max(size.x, 0.3)));
    group.position.set(x, 0.16, z);
    group.rotation.y = rnd() * 6.28;
    scene.add(group);
  };
  const tall = { bamboo: 2.1, beanstalk: 2.3, cherryblossom: 2.2, candyblossom: 1.9, coconut: 2.2, cacao: 1.6, mango: 1.8, pear: 1.7, nectarine: 1.6, sugarapple: 1.5 };
  let n = 0;
  for (const side of [-1, 1]) for (const [row, z] of [-2.9, -5.1, -7.4].entries()) {
    if (sc.spot === 'open' && row === 0) continue;
    const cx = side * ((sc.spot === 'open' ? 3.1 : 2.42) + row * 0.2);
    box(2.2, 0.16, 1.55, soil, cx, 0.08, z);
    for (const dz of [-0.82, 0.82]) box(2.36, 0.22, 0.11, '#a86c34', cx, 0.11, z + dz);
    for (const dx of [-1.14, 1.14]) box(0.11, 0.22, 1.75, '#935a2a', cx + dx, 0.11, z);
    const id = sc.crops[(n++) % sc.crops.length];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) plant(id, cx - 0.7 + i * 0.7 + (rnd() - 0.5) * 0.15, z - 0.36 + j * 0.72, (tall[id] ?? 0.85) * (0.82 + rnd() * 0.3) * (row === 0 ? 0.88 : 1));
  }

  // flowers and bushes along the path
  for (let i = 0; i < 24; i++) {
    const side = i % 2 ? 1 : -1;
    add('flowers', side * (1.28 + rnd() * 0.2), -1.2 - rnd() * 11, 0.5 + rnd() * 0.35, rnd() * 6);
  }
  for (let i = 0; i < 26; i++) add(i % 3 ? 'flowers' : 'bush', (i % 2 ? 1 : -1) * (5 + rnd() * 5), -1 - rnd() * 11, 0.7 + rnd() * 0.6, rnd() * 6);
  for (let x = -17; x <= 17; x += 2.05) if (Math.abs(x) > 1.9) add('fence', x, -9.4, 1);
  if (sc.spot === 'blossom' || sc.spot === 'beds') add('arch', Math.sin(-9.4 * 0.2) * 0.6, -9.4, 1.25);
  add('lamp', -1.75, -6.4, 1); add('lamp', 2.1, -7.8, 1);

  // trees around the back, then hills
  const kinds = sc.spot === 'blossom' ? ['tree_round', 'tree_oak', 'tree_birch'] : ['tree_oak', 'tree_round', 'tree_birch', 'tree_pine'];
  const pinkLeaf = new Map();
  const spots = [[-8.5, -11], [-12.5, -7], [-6, -14], [8.8, -11.5], [12.8, -7.5], [6.2, -15], [-3.6, -18], [3.8, -19], [-16, -13], [16, -13], [-10.5, -19], [11, -19], [-21, -6], [21, -6], [-15, -24], [15, -24], [-6, -27], [7, -28], [-25, -17], [25, -17], [0, -31], [-10.5, -3], [11, -3.2]];
  spots.forEach(([x, z], i) => {
    const t = add(kinds[i % kinds.length], x + (rnd() - 0.5), z, 0.85 + rnd() * 0.35, rnd() * 6);
    if (sc.spot !== 'blossom' || i % 4 === 3) return;
    const col = ['#ff9ec4', '#ffbcd6', '#f580b0'][i % 3];
    t.traverse((o) => {
      if (!o.isMesh || !/foliage|blossom|leaf/i.test(o.material.name)) return;
      const key = `${o.material.uuid}${col}`;
      if (!pinkLeaf.has(key)) { const m = o.material.clone(); m.vertexColors = false; m.map = null; m.alphaTest = 0; m.color = new THREE.Color(col); m.emissive = new THREE.Color(col); m.emissiveIntensity = 0.12; pinkLeaf.set(key, m); }
      o.material = pinkLeaf.get(key);
    });
  });
  for (let i = 0; i < 11; i++) {
    const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), std(T.hill, { flatShading: true }));
    hill.scale.set(11 + rnd() * 9, 3 + rnd() * 4.5, 8);
    hill.position.set(-50 + i * 10 + rnd() * 4, -0.6, -40 - rnd() * 12);
    scene.add(hill);
  }

  // what makes this corner its own
  const S = {
    open: () => { add('home_cottage', 5.6, -15, 0.62, -0.45); add('home_treehouse', -5.8, -15, 0.62, 0.4); },
    beds: () => { add('home_cottage', 3.9, -15, 0.6, -0.45); add('scarecrow', -1.95, -4.0, 1.2, 0.35); add('crate', 1.6, -2.3, 0.7, 0.4); add('gnome', -1.5, -2.0, 0.9, 0.5); },
    blossom: () => { add('home_treehouse', -4.0, -15, 0.62, 0.4); add('birdbath', 1.75, -3.4, 1.15); add('bench', -2.05, -3.6, 1.0, 0.6); },
    bamboo: () => { add('rock0', -1.72, -2.8, 0.8, 1); add('rock1', 1.8, -3.2, 0.75, 2); for (let i = 0; i < 30; i++) plant('bamboo', (i % 2 ? 1 : -1) * (1.9 + rnd() * 2.2), -8.2 - rnd() * 3.4, 2.7 + rnd() * 1.3); },
    mill: () => { add('home_windmill', -3.1, -15, 0.62, 0.35); add('balloon', 2.85, -12, 0.36, 0, 1.9); add('minimill', 1.95, -4.6, 0.55, -0.3); add('crate', -1.65, -2.4, 0.7, 0.3); },
    market: () => { add('stall_market', -2.2, -4.7, 0.92, 0.55); add('stall_seeds', 2.25, -4.9, 0.92, -0.55); add('crate', 1.55, -2.5, 0.7, 0.5); add('crate', -1.62, -2.6, 0.6, 1.1); add('home_cottage', -3.9, -15.5, 0.6, 0.45); },
    plaza: () => { add('fountain', -2.3, -5.0, 0.82); add('goldgnome', 1.65, -2.7, 1.2, -0.5); add('home_cottage', 4.0, -15.5, 0.6, -0.45); add('lamp', 1.85, -3.9, 1); add('bench', 2.5, -5.4, 0.95, -0.8); },
    castle: () => { add('home_castle', -3.7, -16, 0.56, 0.4); add('goldgnome', -1.62, -2.6, 1.2, 0.5); add('crate', 1.62, -2.5, 0.8, 0.35); add('crate', 1.95, -2.95, 0.6, 0.9); },
  };
  S[sc.spot]();

  // two strings of red lanterns over the path
  const red = std('#d4232b', { roughness: 0.55, emissive: new THREE.Color('#c01a20'), emissiveIntensity: 0.25 + T.lamps * 0.3 });
  const gold = std('#f2b632', { roughness: 0.4, metalness: 0.4, emissive: new THREE.Color('#7a5200'), emissiveIntensity: 0.4 });
  for (const [zz, yy, shift] of [[-5.6, 3.38, 0], [-8.6, 3.55, 0.5]]) {
    const pts = Array.from({ length: 41 }, (_, i) => { const x = -9 + i * 0.45; return new THREE.Vector3(x, yy - Math.cos((x / 9) * Math.PI * 1.5) * 0.16 + Math.abs(x) * 0.035, zz); });
    const line = new THREE.CatmullRomCurve3(pts);
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(line, 80, 0.012, 6), std('#4a2a18')));
    for (let i = 0; i < 17; i++) {
      const p = line.getPoint((i + 0.5 + shift * 0.5) / 18);
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 16), red);
      l.scale.y = 0.82; l.position.set(p.x, p.y - 0.22, p.z); scene.add(l);
      for (const dy of [0.15, -0.15]) box(0.13, 0.045, 0.13, gold, p.x, p.y - 0.22 + dy, p.z);
      box(0.018, 0.13, 0.018, gold, p.x, p.y - 0.45, p.z);
      if (T.lamps > 1 && i % 3 === 1) { const light = new THREE.PointLight('#ff8a3a', T.lamps * 1.2, 4.2, 2); light.position.set(p.x, p.y - 0.4, p.z + 0.25); scene.add(light); }
    }
  }
  if (T.lamps) for (const [x, z] of [[-2.15, -3.9], [2.15, -6.3]]) { const light = new THREE.PointLight('#ffc26a', T.lamps * 5, 6.5, 2); light.position.set(x, 2.1, z + 0.35); scene.add(light); }

  // blocky clouds, and stars at night
  const cloud = new THREE.MeshBasicMaterial({ color: T.cloud, fog: false, transparent: true, opacity: sc.time === 'night' ? 0.5 : 0.93 });
  for (const [x, y, z] of [[-17, 9.4, -52], [13, 10.6, -55], [27, 7.2, -50], [-31, 7.6, -48], [-2, 12.5, -58]]) for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(2.4 + rnd() * 3, 0.8 + rnd() * 0.9, 1.5), cloud);
    m.position.set(x + (i - 2) * 1.5, y + (i === 2 ? 0.75 : rnd() * 0.3), z + rnd());
    scene.add(m);
  }
  if (sc.time === 'night' || sc.time === 'dusk') {
    const dot = new THREE.MeshBasicMaterial({ color: '#fff6d8', fog: false });
    for (let i = 0; i < (sc.time === 'night' ? 260 : 90); i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.05 + rnd() * 0.06, 6, 4), dot); m.position.set((rnd() - 0.5) * 70, 6 + rnd() * 17, -60); scene.add(m); }
    const moon = new THREE.Mesh(new THREE.SphereGeometry(1.35, 32, 20), new THREE.MeshBasicMaterial({ color: '#fff2c4', fog: false }));
    moon.position.set(12.5, 10.6, -57); scene.add(moon);
  }
  // petals, leaves or fireflies in the air
  const air = sc.spot === 'blossom' ? ['#ffb3d1', '#ff8fbc', '#ffd6e6'] : sc.time === 'night' || sc.time === 'dusk' ? ['#ffe46a', '#fff3b0', '#ffc23a'] : ['#8fd04a', '#f2c23a', '#6fb83a'];
  const glowing = sc.time === 'night' || (sc.time === 'dusk' && sc.spot !== 'blossom');
  for (let i = 0; i < 70; i++) {
    const m = new THREE.Mesh(glowing ? new THREE.SphereGeometry(0.022, 8, 6) : new THREE.CircleGeometry(0.045, 7), new THREE.MeshBasicMaterial({ color: air[i % 3], side: THREE.DoubleSide, fog: false }));
    m.position.set((rnd() - 0.5) * 9, 0.4 + rnd() * 3.2, -0.8 - rnd() * 6);
    m.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    scene.add(m);
  }
  return scene;
}

/** A few big blooms right in front of the lens, far out of focus, in the bottom corners. */
function foreground(sc, cam) {
  const scene = new THREE.Scene();
  const T = TIMES[sc.time];
  scene.add(new THREE.HemisphereLight(T.hemi[0], T.hemi[1], T.hemi[2] + 0.4));
  const sun = new THREE.DirectionalLight(T.sun[0], T.sun[1]);
  sun.position.set(-3, 5, 4);
  scene.add(sun);
  for (const [nx, ny, s, ry] of [[-1.04, -0.99, 0.5, 0.4], [-0.82, -1.1, 0.4, 2.1], [1.03, -0.97, 0.52, 3.6], [0.83, -1.12, 0.38, 5.2]]) {
    const o = props.get('flowers').clone(true);
    const p = new THREE.Vector3(nx, ny, 0.5).unproject(cam).sub(cam.position).normalize().multiplyScalar(2.5).add(cam.position);
    o.position.copy(p); o.position.y -= 0.06; o.scale.setScalar(s); o.rotation.y = ry;
    scene.add(o);
  }
  return scene;
}

// ---------------------------------------------------------------- the cat
function cat(sc, look, clean) {
  const scene = new THREE.Scene();
  const T = TIMES[sc.time];
  const dark = sc.time === 'night' || sc.time === 'dusk';
  scene.add(new THREE.HemisphereLight(dark ? '#e6dcff' : '#fff6ea', '#6d6a4a', dark ? 1.4 : 1.45));
  const key = new THREE.DirectionalLight(dark ? '#ffe6d2' : '#fff0d8', dark ? 1.75 : 2.0);
  key.position.set(-2.5, 4.5, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -2, near: 0.5, far: 20 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.015;
  scene.add(key);
  const fill = new THREE.DirectionalLight('#cfe0ff', 0.55);
  fill.position.set(4, 2, 2);
  scene.add(fill);
  for (const x of [-3, 3]) { // light from the garden catching both edges of the cat
    const rim = new THREE.DirectionalLight(T.rim[0], T.rim[1]);
    rim.position.set(x, 2.8, -2.6);
    scene.add(rim);
  }
  const a = new Avatar(buildAdmin(farmer, look), assets.mats);
  a.play('signature');
  a.idleT = 0.4;
  for (let i = 0; i < 12; i++) a.tick(0.05);
  a.root.traverse((o) => {
    if (clean && /^(smoke|stain)_prop/.test(o.name)) o.visible = false;
    if (look.thermal) o.castShadow = false;
  });
  scene.add(a.root);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 6), new THREE.ShadowMaterial({ opacity: 0.34 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = 0.06; floor.receiveShadow = true;
  scene.add(floor);
  return scene;
}

// ---------------------------------------------------------------- putting the picture together
const font = (s) => `${s}px Impact, "Arial Narrow", sans-serif`;
function words(text, x, y, size, fill) {
  ctx.font = font(size);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.lineWidth = size / 6;
  ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.strokeText(text, x + size / 22, y + size / 15);
  ctx.strokeStyle = '#17120f'; ctx.strokeText(text, x, y);
  ctx.fillStyle = fill; ctx.fillText(text, x, y);
}
function caption(sc) {
  let size = 158;
  ctx.font = font(size);
  while (ctx.measureText(sc.caption).width > SIZE - 300) ctx.font = font((size -= 4));
  const w = ctx.measureText(sc.caption).width + size * 1.1, h = size * 1.46, x = SIZE / 2, y = SIZE - 390;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(-0.028);
  for (const [pad, col, off] of [[0, 'rgba(0,0,0,.42)', 20], [0, '#17120f', 0], [10, '#f2b632', 0], [24, '#b3181b', 0]]) { ctx.fillStyle = col; ctx.fillRect(-w / 2 + pad + off, -h / 2 + pad + off, w - pad * 2, h - pad * 2); }
  words(sc.caption, 0, 6, size, '#fff');
  ctx.font = font(84);
  const sw = ctx.measureText(sc.sub).width + 90;
  ctx.fillStyle = 'rgba(23,18,15,.92)';
  ctx.beginPath(); ctx.roundRect(-sw / 2, h / 2 + 16, sw, 122, 18); ctx.fill();
  words(sc.sub, 0, h / 2 + 79, 84, '#ffe996');
  ctx.restore();
  words('mihaomeme.garden  ·  #MihaoGarden', SIZE / 2, SIZE - 62, 62, '#fff');
}

/** The garden as a heat camera sees it: everything cool, so the hot cat stands out. */
function coolDown() {
  const d = ctx.getImageData(0, 0, SIZE, SIZE), c = new THREE.Color(), table = [];
  for (let i = 0; i < 256; i++) { heat(0.02 + (i / 255) * 0.47, c).convertLinearToSRGB(); table.push([c.r * 255, c.g * 255, c.b * 255]); }
  for (let i = 0; i < d.data.length; i += 4) {
    const t = table[Math.round(0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2])];
    d.data[i] = t[0]; d.data[i + 1] = t[1]; d.data[i + 2] = t[2];
  }
  ctx.putImageData(d, 0, 0);
}
function heatScale() {
  const x = SIZE - 190, top = 190, h = 900;
  ctx.fillStyle = '#e8e6df'; ctx.fillRect(x - 10, top - 10, 84, h + 20);
  const c = new THREE.Color();
  for (let i = 0; i < 225; i++) { heat(1 - i / 224, c); ctx.fillStyle = `#${c.getHexString()}`; ctx.fillRect(x, top + i * 4, 64, 5); }
}

/** id: which admin; captioned: with the meme words (framed wider); clean: without the smoking and stain parts. */
function picture(id, { captioned = false, clean = false } = {}) {
  const look = LOOKS.find((l) => l.id === id), sc = SCENES[id];
  const cam = new THREE.PerspectiveCamera(captioned ? 29 : 26.5, 1, 0.05, 140);
  cam.position.set(0, 2.3, captioned ? 4.75 : 4.2);
  cam.lookAt(0, captioned ? 1.33 : 1.66, 0);
  cam.updateMatrixWorld();

  // 1. the garden, softly out of focus
  renderer.setClearColor(0x000000, 0);
  renderer.render(garden(sc), cam);
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.filter = 'blur(3.6px) saturate(1.1)';
  ctx.drawImage(renderer.domElement, -12, -12, SIZE + 24, SIZE + 24);
  ctx.filter = 'none';
  if (sc.thermal) coolDown();
  else {
    const glow = ctx.createRadialGradient(SIZE / 2, SIZE * 0.36, 60, SIZE / 2, SIZE * 0.36, SIZE * 0.5);
    glow.addColorStop(0, TIMES[sc.time].glow); glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = glow; ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.globalCompositeOperation = 'source-over';
  }

  // 2. the cat, sharp, with its shadow on the path
  renderer.render(cat(sc, look, clean), cam);
  ctx.drawImage(renderer.domElement, 0, 0);

  // 3. near flowers, very soft
  if (!sc.thermal) {
    renderer.render(foreground(sc, cam), cam);
    ctx.filter = 'blur(13px)';
    ctx.drawImage(renderer.domElement, 0, 0);
    ctx.filter = 'none';
  }
  const v = ctx.createRadialGradient(SIZE / 2, SIZE * 0.45, SIZE * 0.36, SIZE / 2, SIZE / 2, SIZE * 0.76);
  v.addColorStop(0, 'rgba(10,6,0,0)'); v.addColorStop(1, 'rgba(10,6,0,.34)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, SIZE, SIZE);
  if (sc.thermal) heatScale();
  if (captioned) caption(sc);
  return out.toDataURL(captioned ? 'image/jpeg' : 'image/png', 0.93).split(',')[1];
}

/**
 * A wide picture of support: Ansem's cat in front at sunrise, the admin cats standing behind.
 * No website, ticker or promotion on it, on purpose.
 */
function supportPoster({ title, sub: line, from }) {
  const W = 2400, H = 1350;
  const sc = { time: 'sunrise', spot: 'open', crops: ['pumpkin', 'tomato', 'watermelon', 'strawberry'] };
  renderer.setSize(W, H, false);
  out.width = W; out.height = H;
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.05, 140);
  cam.position.set(0, 2.55, 7.7);
  cam.lookAt(0, 1.72, -0.6);
  cam.updateMatrixWorld();

  renderer.render(garden(sc), cam);
  ctx.filter = 'blur(2.6px) saturate(1.08)';
  ctx.drawImage(renderer.domElement, -8, -8, W + 16, H + 16);
  ctx.filter = 'none';
  // the sun coming up behind them
  const sx = W / 2, sy = H * 0.36;
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2;
    const ray = ctx.createRadialGradient(sx, sy, 60, sx, sy, 1350);
    ray.addColorStop(0, 'rgba(255,226,140,.26)'); ray.addColorStop(1, 'rgba(255,226,140,0)');
    ctx.fillStyle = ray;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.arc(sx, sy, 1500, a, a + 0.085); ctx.closePath(); ctx.fill();
  }
  const sun = ctx.createRadialGradient(sx, sy, 30, sx, sy, 720);
  sun.addColorStop(0, 'rgba(255,240,180,.8)'); sun.addColorStop(0.4, 'rgba(255,190,90,.34)'); sun.addColorStop(1, 'rgba(255,160,60,0)');
  ctx.fillStyle = sun; ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';

  // the cats: Ansem in front, the others in a wide V behind
  const scene = cat(sc, LOOKS.find((l) => l.id === 'ansem'), true);
  const hero = scene.children.find((o) => o.name.startsWith('mihao_admin_') || o.getObjectByName?.('hips'));
  hero.position.set(0, 0, 0.75);
  const key = scene.children.find((o) => o.isDirectionalLight && o.castShadow);
  Object.assign(key.shadow.camera, { left: -8, right: 8, top: 6, bottom: -4, near: 0.5, far: 25 });
  key.shadow.camera.updateProjectionMatrix();
  LOOKS.filter((l) => l.id !== 'ansem').forEach((look, i) => {
    const step = Math.floor(i / 2) + 1, side = i % 2 ? 1 : -1;
    const a = new Avatar(buildAdmin(farmer, look), assets.mats);
    a.play('signature'); a.idleT = 0.4;
    for (let n = 0; n < 12; n++) a.tick(0.05);
    a.root.traverse((o) => {
      if (/^(smoke|stain)_prop/.test(o.name)) o.visible = false; // the clean looks for a public post
      if (look.thermal) o.castShadow = false;
    });
    a.root.position.set(side * (0.24 + step * 0.785), 0, 0.35 - step * 0.62);
    a.root.rotation.y = -side * 0.1;
    scene.add(a.root);
  });
  renderer.render(scene, cam);
  ctx.drawImage(renderer.domElement, 0, 0);

  const shade = ctx.createLinearGradient(0, H - 330, 0, H);
  shade.addColorStop(0, 'rgba(20,8,0,0)'); shade.addColorStop(1, 'rgba(20,8,0,.78)');
  ctx.fillStyle = shade; ctx.fillRect(0, H - 330, W, 330);
  const put = (text, y, size, fill) => {
    ctx.font = font(size);
    while (ctx.measureText(text).width > W - 160) ctx.font = font((size -= 4));
    words(text, W / 2, y, size, fill);
  };
  put(title, 170, 196, '#ffd84a');
  put(line, H - 150, 112, '#fff');
  put(from, H - 52, 50, '#ffe996');
  const data = out.toDataURL('image/jpeg', 0.94).split(',')[1];
  renderer.setSize(SIZE, SIZE, false);
  out.width = out.height = SIZE;
  return data;
}

/** The roadmap as one wide picture: four stages of a garden, a cat above each. No dates on purpose. */
const ROADMAP = [
  { cat: 'green-hoodie', name: 'PLANTED', status: 'LIVE NOW', colour: '#2f8a3a', items: ['3D multiplayer garden', '29 crops and wild weather', 'Meme poses and contests', 'Wardrobe, photos and clips', 'Post to X'] },
  { cat: 'orange-bun', name: 'SPROUTING', status: 'NEXT', colour: '#1f6fb8', items: ['Admin 3D cats in the game', 'Connect X and admin gift claim', 'Easier ways to keep your garden safe'] },
  { cat: 'helmet-pilot', name: 'BLOOMING', status: 'TOKEN LAUNCH, PLANNED', colour: '#b3181b', items: ['Safety checks come first', 'MGRD on Solana via Pump.fun', 'Weekly rewards and token shop', 'Burns from shop sales', 'Perks for Mihao meme holders'] },
  { cat: 'cinnamon-knight', name: 'HARVEST', status: 'LATER', colour: '#a86a12', items: ['Bridge to BNB Chain, after safety checks', 'Seasonal garden events', 'More community cats', 'Better play on phones'] },
];

function roadmapPoster() {
  const W = 2400, H = 1350;
  const sc = { time: 'day', spot: 'open', crops: ['pumpkin', 'tomato', 'watermelon', 'strawberry'] };
  renderer.setSize(W, H, false);
  out.width = W; out.height = H;
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.05, 140);
  cam.position.set(0, 1.5, 8);
  cam.lookAt(0, 0.7, 0);
  cam.updateMatrixWorld();
  renderer.render(garden(sc), cam);
  ctx.filter = 'blur(5px) saturate(1.05)';
  ctx.drawImage(renderer.domElement, -12, -12, W + 24, H + 24);
  ctx.filter = 'none';

  const column = (i) => 40 + i * 590 + 275; // centre of each card, in pixels
  const scene = cat(sc, LOOKS.find((l) => l.id === ROADMAP[0].cat), true);
  const first = scene.children.find((o) => o.getObjectByName?.('hips'));
  const perUnit = H / 2 / (Math.tan(THREE.MathUtils.degToRad(15)) * cam.position.distanceTo(new THREE.Vector3(0, 0.7, 0)));
  const place = (o, i) => { o.scale.setScalar(0.7); o.position.set((column(i) - W / 2) / perUnit, 0, 0); };
  place(first, 0);
  ROADMAP.slice(1).forEach((stage, n) => {
    const a = new Avatar(buildAdmin(farmer, LOOKS.find((l) => l.id === stage.cat)), assets.mats);
    a.play('signature'); a.idleT = 0.4;
    for (let t = 0; t < 12; t++) a.tick(0.05);
    place(a.root, n + 1);
    scene.add(a.root);
  });
  const key = scene.children.find((o) => o.isDirectionalLight && o.castShadow);
  Object.assign(key.shadow.camera, { left: -8, right: 8, top: 6, bottom: -4, near: 0.5, far: 25 });
  key.shadow.camera.updateProjectionMatrix();
  renderer.render(scene, cam);
  ctx.drawImage(renderer.domElement, 0, 0);

  words('MIHAO MEME GARDEN ROADMAP', W / 2, 108, 128, '#ffd84a');
  const top = 560, bottom = 1240;
  ROADMAP.forEach((stage, i) => {
    const x = column(i) - 275, w = 550;
    ctx.fillStyle = 'rgba(0,0,0,.38)';
    ctx.beginPath(); ctx.roundRect(x + 12, top + 14, w, bottom - top, 28); ctx.fill();
    ctx.fillStyle = '#fff6df';
    ctx.beginPath(); ctx.roundRect(x, top, w, bottom - top, 28); ctx.fill();
    ctx.fillStyle = stage.colour;
    ctx.beginPath(); ctx.roundRect(x, top, w, 190, [28, 28, 0, 0]); ctx.fill();
    ctx.lineWidth = 9; ctx.strokeStyle = '#17120f';
    ctx.beginPath(); ctx.roundRect(x, top, w, bottom - top, 28); ctx.stroke();
    words(`${i + 1}. ${stage.name}`, column(i), top + 68, 76, '#fff');
    words(stage.status, column(i), top + 148, 50, '#ffe996');
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    let y = top + 236;
    for (const item of stage.items) {
      ctx.font = 'bold 32px Arial, sans-serif';
      const lines = [''];
      for (const word of item.split(' ')) {
        const next = `${lines.at(-1)} ${word}`.trim();
        if (ctx.measureText(next).width > w - 106 && lines.at(-1)) lines.push(word); else lines[lines.length - 1] = next;
      }
      ctx.fillStyle = stage.colour;
      ctx.beginPath(); ctx.arc(x + 44, y, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2a1a10';
      for (const line of lines) { ctx.fillText(line, x + 72, y + 2); y += 38; }
      y += 18;
    }
    if (y > bottom + 12) throw new Error(`the text of ${stage.name} does not fit its card`);
  });
  words('MGRD has not launched. Plans can change; no dates, prices or profits.  mihaomeme.garden', W / 2, 1298, 46, '#fff');
  const data = out.toDataURL('image/jpeg', 0.94).split(',')[1];
  renderer.setSize(SIZE, SIZE, false);
  out.width = out.height = SIZE;
  return data;
}

/** For other picture makers (depot.js): the garden and what it is built from, once init() has run. */
export const studio = () => ({ renderer, garden, TIMES, assets, farmer, crops });

window.memes = { init, picture, supportPoster, roadmapPoster, list: LOOKS.map(({ id }) => id) };
