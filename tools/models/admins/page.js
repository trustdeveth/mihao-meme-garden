// Renders and exports the admin models. Driven by build.mjs.
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Assets } from '../../../client/src/assets/assets.js';
import { Avatar } from '../../../client/src/render/characters.js';
import { LOOKS, buildAdmin, heat } from './looks.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

let assets, farmer;
async function init() {
  assets = await new Assets(renderer).init();
  farmer = await assets.character('farmer');
}

function lights(scene) {
  scene.add(new THREE.HemisphereLight('#fff6ea', '#6d6458', 1.5));
  const key = new THREE.DirectionalLight('#fff0dc', 2.0);
  key.position.set(-2.5, 4.5, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -2, near: 0.5, far: 20 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.015;
  scene.add(key);
  const fill = new THREE.DirectionalLight('#cfe0ff', 0.7);
  fill.position.set(4, 2, 2);
  scene.add(fill);
  const rim = new THREE.DirectionalLight('#ffe2c0', 1.0);
  rim.position.set(1.5, 3.5, -3);
  scene.add(rim);
}

const flat = (scene, geo, color, pos) => {
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, toneMapped: false }));
  m.position.set(...pos);
  scene.add(m);
  return m;
};

/** The dim hallway of the meme photo: pale floor on the left, a dark doorway, a white post, an olive wall. */
function hallway(scene, thermal) {
  scene.background = new THREE.Color('#56544a');
  const quad = (pts, color, z) => flat(scene, new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)))), color, [0, 0, z]);
  quad([[-3, -1], [3, -1], [3, 3.6], [-3, 3.6]], '#4c4a40', -1.6);
  quad([[-3, -1], [1.35, -1], [0.55, 1.78], [-3, 1.62]], '#aba49e', -1.59);
  quad([[-3, 1.62], [0.55, 1.78], [0.55, 3.6], [-3, 3.6]], '#16150f', -1.58);
  quad([[0.55, 1.78], [1.35, 1.02], [3, 0.72], [3, 0.86], [0.55, 1.93]], '#222019', -1.575);
  quad([[-0.98, 1.66], [-0.9, 1.66], [-0.9, 3.6], [-0.98, 3.6]], '#d9d8d2', -1.57);
  quad([[-0.82, 1.67], [-0.795, 1.67], [-0.795, 3.6], [-0.82, 3.6]], '#8f8e87', -1.569);
  if (thermal) {
    // the temperature scale beside a heat-camera picture
    flat(scene, new THREE.PlaneGeometry(0.082, 1.056), '#e8e6df', [0.66, 1.608, 0.095]);
    for (let i = 0; i < 60; i++) flat(scene, new THREE.PlaneGeometry(0.068, 0.0178), heat(i / 59), [0.66, 1.1 + i * 0.0172, 0.1]);
  }
}

function studio(scene) {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#3a0d10'); grad.addColorStop(0.6, '#8f1c20'); grad.addColorStop(1, '#4a1012');
  g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
  scene.background = new THREE.CanvasTexture(c);
  scene.background.colorSpace = THREE.SRGBColorSpace;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 48), new THREE.ShadowMaterial({ opacity: 0.38 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
}

function avatarFor(look) {
  const a = new Avatar(buildAdmin(farmer, look), assets.mats);
  a.play('signature');
  a.idleT = 0.4;
  for (let i = 0; i < 12; i++) a.tick(0.05);
  if (look.thermal) a.root.traverse((o) => { o.castShadow = false; });
  return a;
}

/** view: 'portrait' (like the photo) or 'full' (whole body); turn: the model's angle in radians. */
function shot(id, view, w, h, turn = 0) {
  const look = LOOKS.find((l) => l.id === id);
  const scene = new THREE.Scene();
  lights(scene);
  const a = avatarFor(look);
  a.root.rotation.y = turn;
  scene.add(a.root);
  const cam = new THREE.PerspectiveCamera(view === 'portrait' ? 24 : 26, w / h, 0.05, 60);
  if (view === 'portrait') {
    hallway(scene, look.thermal);
    cam.position.set(0, 1.86, 4.05);
    cam.lookAt(0, 1.68, 0);
  } else {
    studio(scene);
    cam.position.set(0, 1.8, 6.1);
    cam.lookAt(0, 1.21, 0);
  }
  renderer.setSize(w, h, false);
  renderer.render(scene, cam);
  return renderer.domElement.toDataURL('image/png').split(',')[1];
}

const toBase64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** A standalone .glb of one admin, with the game's animations and the photo pose as "signature". */
async function exportGLB(id, { forGame = false } = {}) {
  const { scene, animations } = buildAdmin(farmer, LOOKS.find((l) => l.id === id));
  if (forGame) { // the village is public: it gets the clean looks
    const drop = [];
    scene.traverse((o) => { if (/^(smoke|stain)_prop/.test(o.name)) drop.push(o); });
    for (const o of drop) o.parent.remove(o);
  }
  const buf = await new GLTFExporter().parseAsync(scene, { binary: true, animations, maxTextureSize: 1024 });
  // load it again to make sure the file really works
  const back = await new GLTFLoader().parseAsync(buf.slice(0), '');
  let meshes = 0, tris = 0;
  back.scene.traverse((o) => { if (o.isMesh) { meshes++; tris += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; } });
  return { data: toBase64(buf), meshes, tris: Math.round(tris), clips: back.animations.map((c) => c.name) };
}

window.admins = { init, shot, exportGLB, list: LOOKS.map(({ id, name }) => ({ id, name })) };
