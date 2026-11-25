// The Sky Balloon: a giant Mihao head with its red dome cap and long moustache, carrying Captain Puff in a
// red and gold basket. Parts the game moves on their own are named: balloon_hair and balloon_flame.
import * as THREE from 'three';
import { V3, TAU, place, roundedBox, triCount } from './lib/geo.js';
import { headShell, smoothGeo, lock, HEAD } from './mihao.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const GOLD = '#F2B632', RED = '#C41E27', RED_DARK = '#8E1118', CREAM = '#FFF1D6', DARK = '#1A181D', WOOD = '#8A5A2E', WHITE = '#FBF7EE';
const K = 5.2; // how many times bigger than the player's head
const FACE_Y = 5.45;

export function balloonProp(headImage) {
  const parts = new Map(); // mesh name -> geometries
  const add = (name, geo, color = null) => (parts.get(name) ?? parts.set(name, []).get(name)).push(smoothGeo(geo, color ?? '#ffffff'));
  const solid = (w, h, d, color, pos, rot = [0, 0, 0], name = 'plain') => add(name, place(new THREE.BoxGeometry(w, h, d), { pos, rot }), color);
  const soft = (w, h, d, color, pos, rot = [0, 0, 0], name = 'plain') => add(name, place(roundedBox(w, h, d, 0.03, { color }), { pos, rot }));
  const ball = (r, color, pos, name = 'plain', seg = 9) => add(name, place(new THREE.SphereGeometry(r, seg, Math.ceil(seg * 0.75)), { pos }), color);
  const rod = (a, b, r, color, name = 'plain') => {
    const from = new V3(...a), dir = new V3(...b).sub(from);
    const g = new THREE.CylinderGeometry(r, r, dir.length(), 5, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), dir.clone().normalize()));
    g.translate(from.x + dir.x / 2, from.y + dir.y / 2, from.z + dir.z / 2);
    add(name, g, color);
  };
  const big = (geo, y = FACE_Y) => { geo.scale(K, K, K); geo.translate(0, y - HEAD.y * K, 0); return geo; };

  // ---- the envelope: one huge Mihao head ----
  const shell = headShell(28, 20);
  shell.scale(K, K, K);
  shell.translate(0, FACE_Y, 0);
  add('face', shell);
  for (const s of [1, -1]) {
    const ear = new THREE.ConeGeometry(0.13 * K, 0.3 * K, 18, 1);
    ear.scale(1, 1, 0.46);
    const uv = ear.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.66 + uv.getX(i) * 0.16, 0.5 + uv.getY(i) * 0.3);
    add('face', place(ear, { pos: [0.255 * K * s, FACE_Y + 0.31 * K, -0.1], rot: [0, 0, -0.42 * s] }));
    const inner = new THREE.ConeGeometry(0.082 * K, 0.21 * K, 12, 1);
    inner.scale(1, 1, 0.2);
    add('plain', place(inner, { pos: [0.249 * K * s, FACE_Y + 0.29 * K, 0.22], rot: [0, 0, -0.42 * s] }), '#F0A79C');
  }
  // eyebrows and moustache, in the same shapes as the player's
  const Y = HEAD.y;
  for (const s of [1, -1]) {
    add('hair', big(lock([[0.055 * s, Y + 0.103, 0.31], [0.15 * s, Y + 0.128, 0.3], [0.25 * s, Y + 0.113, 0.265], [0.345 * s, Y + 0.06, 0.21], [0.39 * s, Y - 0.025, 0.18]], [[0, 0.004], [0.25, 0.017], [0.6, 0.012], [1, 0.001]], { flat: 0.4, segs: 12, radial: 5 })));
    add('hair', big(lock([[0.012 * s, Y - 0.168, 0.345], [0.09 * s, Y - 0.17, 0.357], [0.17 * s, Y - 0.22, 0.35], [0.215 * s, Y - 0.34, 0.335], [0.225 * s, Y - 0.5, 0.3], [0.205 * s, Y - 0.66, 0.29]], [[0, 0.013], [0.16, 0.034], [0.42, 0.023], [0.75, 0.015], [1, 0.0015]], { flat: 0.5, segs: 16, radial: 6 })));
    for (let k = 0; k < 3; k++) add('hair', big(lock([[0.1 * s, Y - 0.115 - k * 0.025, 0.33], [0.3 * s, Y - 0.1 - k * 0.045, 0.31], [0.47 * s, Y - 0.11 - k * 0.075, 0.23]], [[0, 0.004], [1, 0.001]], { segs: 7, radial: 4 })));
  }
  add('hair', big(lock([[0, Y - 0.195, 0.29], [0, Y - 0.3, 0.3], [0, Y - 0.42, 0.285], [0.006, Y - 0.56, 0.27]], [[0, 0.055], [0.22, 0.085], [0.62, 0.045], [1, 0.0015]], { flat: 0.34, segs: 14, radial: 9 })));

  // the red dome cap with its black band, gold emblem and knob
  const capY = FACE_Y + HEAD.h * K - 0.12;
  const ring = (r1, r2, h, color, y, name = 'plain') => add(name, place(new THREE.CylinderGeometry(r1, r2, h, 18, 1), { pos: [0, y, -0.05] }), color);
  ring(0.93, 0.98, 0.34, DARK, capY + 0.08);
  ring(0.955, 0.955, 0.05, GOLD, capY - 0.07);
  const dome = new THREE.SphereGeometry(0.88, 18, 7, 0, TAU, 0, Math.PI / 2);
  dome.scale(1, 0.72, 1);
  add('plain', place(dome, { pos: [0, capY + 0.25, -0.05] }), RED);
  ball(0.17, RED, [0, capY + 1.03, -0.05]);
  ring(0.13, 0.17, 0.12, GOLD, capY + 0.9);
  add('metal', place(new THREE.TorusGeometry(0.15, 0.035, 8, 20), { pos: [0, capY + 0.08, 0.92] }), GOLD);
  solid(0.3, 0.045, 0.04, GOLD, [0, capY + 0.08, 0.93], [0, 0, 0], 'metal');
  solid(0.045, 0.3, 0.04, GOLD, [0, capY + 0.08, 0.93], [0, 0, 0], 'metal');

  // ---- the skirt under the head: red and gold stripes down to the burner opening ----
  const top = FACE_Y - HEAD.h * K + 0.22, mouth = 2.75;
  for (let i = 0; i < 16; i++) add('plain', new THREE.CylinderGeometry(1.22, 0.62, top - mouth, 2, 1, true, (i / 16) * TAU, TAU / 16).translate(0, (top + mouth) / 2, -0.05), i % 2 ? GOLD : RED);
  ring(0.65, 0.65, 0.1, GOLD, mouth, 'metal');
  ring(1.23, 1.23, 0.1, RED_DARK, top - 0.02);
  // little flags all round the rim
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * TAU, g = new THREE.ConeGeometry(0.12, 0.28, 3);
    g.scale(1, 1, 0.16);
    add('plain', place(g, { pos: [Math.sin(a) * 1.27, top - 0.22, Math.cos(a) * 1.27 - 0.05], rot: [Math.PI, a, 0] }), ['#FFD24A', '#5DBB46', '#2F80ED', '#FF7AB6'][i % 4]);
  }

  // ---- ropes from the skirt to the basket, the burner and its flame ----
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) rod([x * 0.45, mouth, z * 0.45 - 0.05], [x * 0.72, 1.3, z * 0.72], 0.025, '#5A3A1E');
  ring(0.2, 0.24, 0.2, '#59606E', 2.28, 'metal');
  for (const s of [1, -1]) rod([s * 0.2, 2.28, 0], [s * 0.64, 2.02, 0], 0.022, '#59606E', 'metal');
  for (const [r, h, color, y] of [[0.22, 0.72, '#FF8A1E', 2.72], [0.13, 0.52, '#FFE14A', 2.63]]) add('flame', place(new THREE.ConeGeometry(r, h, 10, 1), { pos: [0, y, 0] }), color);

  // ---- the basket: red lacquer, gold rims, posts, a paw on the front, sandbags and lanterns ----
  soft(1.5, 0.9, 1.5, RED, [0, 0.62, 0]);
  for (const y of [0.2, 1.07]) soft(1.64, 0.14, 1.64, GOLD, [0, y, 0]);
  for (const y of [0.44, 0.82]) soft(1.54, 0.05, 1.54, RED_DARK, [0, y, 0]);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { soft(0.13, 1.22, 0.13, WOOD, [x * 0.73, 0.72, z * 0.73]); ball(0.1, GOLD, [x * 0.73, 1.39, z * 0.73], 'metal', 10); }
  const paw = (x, y, z, r, color) => { const g = new THREE.SphereGeometry(r, 8, 6); g.scale(1, 0.86, 0.22); add('plain', place(g, { pos: [x, y, z] }), color); };
  paw(0, 0.56, 0.79, 0.17, GOLD);
  for (const [x, y] of [[-0.2, 0.74], [-0.07, 0.83], [0.07, 0.83], [0.2, 0.74]]) paw(x, y, 0.79, 0.075, GOLD);
  for (const s of [1, -1]) {
    rod([s * 0.82, 1.0, 0.2], [s * 0.93, 0.6, 0.2], 0.016, '#5A3A1E');
    const bag = new THREE.SphereGeometry(0.17, 10, 8); bag.scale(1, 1.25, 1);
    add('plain', place(bag, { pos: [s * 0.95, 0.46, 0.2] }), '#C9A56A');
    rod([s * 0.73, 1.3, 0.73], [s * 1.0, 1.18, 0.88], 0.018, DARK);
    const lantern = new THREE.SphereGeometry(0.16, 10, 7); lantern.scale(1, 1.15, 1);
    add('glow', place(lantern, { pos: [s * 1.0, 0.95, 0.88] }), '#FF4A2E');
    for (const y of [1.14, 0.76]) soft(0.14, 0.06, 0.14, GOLD, [s * 1.0, y, 0.88]);
    soft(0.04, 0.2, 0.04, GOLD, [s * 1.0, 0.62, 0.88]);
  }

  // ---- Captain Puff peeking over the front of the basket, paws on the rim ----
  const little = headShell(16, 12);
  little.scale(1.15, 1.15, 1.15);
  little.translate(0, 1.5, 0.38);
  add('face', little);
  for (const s of [1, -1]) {
    const ear = new THREE.ConeGeometry(0.14, 0.32, 10, 1); ear.scale(1, 1, 0.5);
    const uv = ear.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.66 + uv.getX(i) * 0.16, 0.5 + uv.getY(i) * 0.3);
    add('face', place(ear, { pos: [s * 0.28, 1.88, 0.34], rot: [0, 0, -0.34 * s] }));
    const m = lock([[0.015 * s, Y - 0.168, 0.34], [0.12 * s, Y - 0.18, 0.352], [0.19 * s, Y - 0.3, 0.34], [0.2 * s, Y - 0.52, 0.32]], [[0, 0.014], [0.25, 0.032], [1, 0.0015]], { flat: 0.5, segs: 12, radial: 6 });
    m.scale(1.15, 1.15, 1.15); m.translate(0, 1.5 - Y * 1.15, 0.38);
    add('plain', m, WHITE);
    soft(0.27, 0.16, 0.2, WHITE, [s * 0.36, 1.19, 0.76]);
  }
  soft(0.56, 0.1, 0.46, '#1F2A4D', [0, 1.86, 0.38]);
  const hatTop = new THREE.SphereGeometry(0.34, 12, 6); hatTop.scale(1, 0.42, 0.88);
  add('plain', place(hatTop, { pos: [0, 1.97, 0.36] }), WHITE);
  soft(0.44, 0.035, 0.2, '#0E0E12', [0, 1.81, 0.66]);
  ball(0.05, GOLD, [0, 1.95, 0.68], 'metal', 8);

  // ---- put it together ----
  const face = new THREE.Texture(headImage);
  face.colorSpace = THREE.SRGBColorSpace;
  face.needsUpdate = true;
  face.userData.mimeType = 'image/jpeg';
  const faceMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: face, roughness: 0.85, emissive: new THREE.Color(0.2, 0.2, 0.2), emissiveMap: face });
  faceMat.name = 'tex_balloonface';
  const own = (name, o) => { const m = new THREE.MeshStandardMaterial({ vertexColors: true, ...o }); m.name = name; return m; };
  const materials = {
    face: faceMat,
    plain: own('mg_plain', {}),
    metal: own('mg_metal', {}),
    hair: own('tex_balloonhair', { roughness: 0.8, emissive: new THREE.Color(0.22, 0.22, 0.2) }),
    glow: own('tex_balloonglow', { roughness: 0.5, emissive: new THREE.Color('#ff7a2a'), emissiveIntensity: 0.55 }),
    flame: own('tex_balloonflame', { roughness: 1, emissive: new THREE.Color('#ff9a1e'), emissiveIntensity: 1.1, transparent: true, opacity: 0.93 }),
  };
  const root = new THREE.Group();
  root.name = 'balloon';
  let tris = 0;
  for (const [name, list] of parts) {
    const g = mergeGeometries(list, false);
    // the flame grows from the burner and the moustache swings from the muzzle: give them their own pivots
    const pivot = name === 'flame' ? [0, 2.38, 0] : name === 'hair' ? [0, FACE_Y - 0.8, 1.7] : [0, 0, 0];
    g.translate(-pivot[0], -pivot[1], -pivot[2]);
    const mesh = new THREE.Mesh(g, materials[name]);
    mesh.name = `balloon_${name}`;
    mesh.position.set(...pivot);
    root.add(mesh);
    tris += triCount(g);
  }
  return { id: 'balloon', root, tris: Math.round(tris) };
}
