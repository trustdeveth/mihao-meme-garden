// Runs in headless Chrome: builds textures + models, exports GLB, renders review images.
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CROPS } from '/shared/src/data/crops.js';
import { createMaterials } from '/client/src/assets/materials.js';
import { ALL as TEX } from '../lib/tex.js';
import { triCount } from '../lib/geo.js';
import { buildPlant, buildFruit, SPECIES } from '../plants.js';
import { buildCharacters, buildFarmer } from '../characters.js';
import { loadHeadImage } from '../mihao.js';
import { WEAR, AVATAR, DEFAULT_AVATAR } from '/shared/src/data/features.js';
import { outfitVisible, furTexture } from '/client/src/render/outfit.js';
import { buildProps } from '../props.js';

const headImage = () => loadHeadImage('/tools/models/source/mihao-head.png');
const save = (path, dataUrlOrB64) => window.mgSave(path, dataUrlOrB64.includes(',') ? dataUrlOrB64.split(',')[1] : dataUrlOrB64);
const placeholder = (slot) => { const m = new THREE.MeshStandardMaterial({ vertexColors: true }); m.name = `mg_${slot}`; return m; };
const ab64 = (buf) => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };

let texCanvases = null;
function textures() {
  if (texCanvases) return texCanvases;
  texCanvases = {};
  for (const [name, fn] of Object.entries(TEX)) texCanvases[name] = fn(name === 'fabric' || name === 'petal' || name === 'skin' || name === 'fur' ? 256 : 512);
  return texCanvases;
}
function liveMaterials() {
  const tc = textures();
  const tex = {};
  for (const [k, v] of Object.entries(tc)) tex[k] = { map: new THREE.CanvasTexture(v.color), normal: new THREE.CanvasTexture(v.normal) };
  return createMaterials(tex);
}

async function exportGLB(root, animations = []) {
  // weld identical vertices so the files are indexed and much smaller
  root.traverse((o) => {
    if (o.isMesh && !o.isSkinnedMesh && !o.geometry.index) o.geometry = mergeVertices(o.geometry, 1e-5);
  });
  const exporter = new GLTFExporter();
  const buf = await exporter.parseAsync(root, { binary: true, animations, onlyVisible: false, includeCustomExtensions: false });
  return buf;
}

/** One crop -> group with stage nodes, LOD1 nodes, fruit and anchors. */
export function cropGroup(id) {
  const root = new THREE.Group();
  root.name = `crop_${id}`;
  const stats = { lod0: [], lod1: [] };
  let anchors = [];
  for (let stage = 0; stage <= 4; stage++) {
    for (const [suffix, detail] of [['', 1], ['_l1', 0.35]]) {
      const { meshes, anchors: an } = buildPlant(id, stage, detail);
      const g = new THREE.Group();
      g.name = `stage${stage}${suffix}`;
      let tris = 0;
      for (const [slot, geo] of Object.entries(meshes)) {
        const m = new THREE.Mesh(geo, placeholder(slot));
        m.name = `${g.name}_${slot}`;
        g.add(m);
        tris += triCount(geo);
      }
      (suffix ? stats.lod1 : stats.lod0).push(Math.round(tris));
      root.add(g);
      if (stage === 4 && !suffix) anchors = an;
    }
  }
  const fruit = new THREE.Group();
  fruit.name = 'fruit';
  let ftris = 0;
  for (const [slot, geo] of Object.entries(buildFruit(id))) {
    if (!geo) continue;
    const m = new THREE.Mesh(geo, placeholder(slot));
    m.name = `fruit_${slot}`;
    fruit.add(m);
    ftris += triCount(geo);
  }
  const fb = new THREE.Box3().setFromObject(fruit);
  fruit.userData = { h: +(fb.max.y - fb.min.y).toFixed(4) };
  root.add(fruit);
  anchors.forEach((a, i) => {
    const o = new THREE.Object3D();
    o.name = `s4_fruit_${i}`;
    o.position.copy(a.pos);
    o.userData = { hang: a.hang };
    root.add(o);
  });
  return { root, stats: { ...stats, fruit: Math.round(ftris), anchors: anchors.length } };
}

// ---- review rendering ------------------------------------------------------------

let renderer, mats, env;
function setupRenderer(w, h) {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);
    const pm = new THREE.PMREMGenerator(renderer);
    env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    mats = liveMaterials();
  }
  renderer.setSize(w, h, false);
  return renderer;
}

function lightScene(scene) {
  scene.environment = env;
  scene.environmentIntensity = 0.55;
  scene.add(new THREE.HemisphereLight('#fff8e8', '#6a7a4a', 1.1));
  const sun = new THREE.DirectionalLight('#fff1d6', 2.6);
  sun.position.set(-3, 6, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 6, bottom: -2, near: 0.1, far: 30 });
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: '#a9c98a', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
}

function withMaterials(obj) {
  obj.traverse((o) => {
    if (o.isMesh && !o.material.name.startsWith('tex_')) {
      const n = o.material.name.replace('mg_', ''); o.material = mats[n] ?? mats.plain; o.castShadow = true; o.receiveShadow = true;
      // recolourable parts (white in the file) show their default colour
      if (o.userData.defColor) { o.material = o.material.clone(); o.material.color.set(o.userData.defColor); }
    }
  });
  return obj;
}

function shoot(scene, camera, w, h) {
  setupRenderer(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  return renderer.domElement.toDataURL('image/png');
}

/** Contact sheet: stages 0-4 + fruit for one crop. */
function reviewCrop(id, root) {
  setupRenderer(1800, 520);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#dfeacf');
  lightScene(scene);
  const h = Math.max(0.6, (SPECIES[id].h ?? 1) * 1.15);
  const spacing = Math.max(1.0, h * 0.75);
  for (let s = 0; s <= 4; s++) {
    const g = root.getObjectByName(`stage${s}`).clone();
    withMaterials(g);
    g.position.x = (s - 2.5) * spacing;
    scene.add(g);
    if (s === 4) root.children.filter((c) => c.name.startsWith('s4_fruit_')).forEach((a) => {
      const f = root.getObjectByName('fruit').clone();
      withMaterials(f);
      f.position.copy(a.position).add(g.position);
      if (!a.userData.hang) f.position.y += root.getObjectByName('fruit').userData.h;
      scene.add(f);
    });
  }
  const fruit = withMaterials(root.getObjectByName('fruit').clone());
  const fb = new THREE.Box3().setFromObject(fruit);
  const fs = 0.45 / Math.max(0.05, fb.getSize(new THREE.Vector3()).length());
  fruit.scale.setScalar(fs * 2);
  fruit.position.set(3.2 * spacing, 0.55 * h, 0);
  scene.add(fruit);
  const cam = new THREE.PerspectiveCamera(30, 1800 / 520, 0.05, 100);
  const dist = spacing * 4.4;
  cam.position.set(0.25 * spacing, h * 0.75, dist);
  cam.lookAt(0.25 * spacing, h * 0.42, 0);
  return shoot(scene, cam, 1800, 520);
}

/** Close-up of the fully grown plant with its fruit. */
function reviewHero(id, root) {
  setupRenderer(900, 900);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#dfeacf');
  lightScene(scene);
  const g = withMaterials(root.getObjectByName('stage4').clone());
  scene.add(g);
  root.children.filter((c) => c.name.startsWith('s4_fruit_')).forEach((a) => {
    const f = withMaterials(root.getObjectByName('fruit').clone());
    f.position.copy(a.position);
    if (!a.userData.hang) f.position.y += root.getObjectByName('fruit').userData.h;
    scene.add(f);
  });
  const box = new THREE.Box3().setFromObject(g);
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3());
  const d = Math.max(s.x, s.y, s.z) * 2.1;
  const cam = new THREE.PerspectiveCamera(32, 1, 0.02, 100);
  cam.position.set(c.x + d * 0.5, c.y + d * 0.28, c.z + d * 0.85);
  cam.lookAt(c);
  return shoot(scene, cam, 900, 900);
}

function reviewObject(obj, { w = 1200, h = 800, dist = null, target = null } = {}) {
  setupRenderer(w, h);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#dfeacf');
  lightScene(scene);
  const o = withMaterials(obj);
  scene.add(o);
  const box = new THREE.Box3().setFromObject(o);
  const c = target ?? box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  const cam = new THREE.PerspectiveCamera(32, w / h, 0.05, 200);
  const d = dist ?? size * 1.75;
  cam.position.set(c.x + d * 0.45, c.y + d * 0.22, c.z + d * 0.85);
  cam.lookAt(c);
  return shoot(scene, cam, w, h);
}

// ---- entry ---------------------------------------------------------------------------

window.mgBuild = async ({ only = null, review = true, textures: doTex = true, skip = [], portrait: doPortrait = false } = {}) => {
  const manifest = { crops: {}, characters: {}, props: {}, textures: [] };
  if (doTex) {
    for (const [name, t] of Object.entries(textures())) {
      await save(`client/public/textures/${name}.webp`, t.color.toDataURL('image/webp', 0.9));
      await save(`client/public/textures/${name}_n.webp`, t.normal.toDataURL('image/webp', 0.92));
      manifest.textures.push(name);
    }
  }
  const want = (kind, id) => (!only || only.includes(id) || only.includes(kind)) && !skip.includes(kind);
  for (const crop of CROPS) {
    if (!want('crops', crop.id)) continue;
    const { root, stats } = cropGroup(crop.id);
    const buf = await exportGLB(root);
    await save(`client/public/models/crops/${crop.id}.glb`, ab64(buf));
    manifest.crops[crop.id] = { file: `models/crops/${crop.id}.glb`, bytes: buf.byteLength, ...stats };
    if (review) {
      await save(`tools/review/out/crop_${crop.id}.png`, reviewCrop(crop.id, root));
      await save(`tools/review/out/hero_${crop.id}.png`, reviewHero(crop.id, root));
    }
  }
  if (want('characters', 'farmer')) {
    const ch = buildFarmer(await headImage());
    const buf = await exportGLB(ch.root, ch.animations);
    await save('client/public/models/characters/farmer.glb', ab64(buf));
    manifest.characters.farmer = { file: 'models/characters/farmer.glb', bytes: buf.byteLength, tris: ch.tris, animations: ch.animations.map((a) => a.name) };
    await wearPictures(ch);
    if (review) {
      const boy = farmerLook(SkeletonUtils.clone(ch.root), { hat: 'none' });
      const sunHat = farmerLook(SkeletonUtils.clone(ch.root), { hat: 'sunflower' });
      sunHat.position.x = 1.2;
      const bare = farmerLook(SkeletonUtils.clone(ch.root), { hat: 'straw' });
      bare.position.x = -1.2;
      const g = new THREE.Group(); g.add(bare, boy, sunHat);
      await save('tools/review/out/char_farmer.png', reviewObject(g, { w: 1200, h: 900 }));
      // transparent portrait for the loading screen (only with --portrait: the file may hold hand-made art)
      if (doPortrait) await save('client/public/icons/mihao.png', mihaoPortrait(farmerLook(SkeletonUtils.clone(ch.root), { hat: 'none' })));
      const face = farmerLook(SkeletonUtils.clone(ch.root), { hat: 'none' });
      await save('tools/review/out/char_farmer_face.png', reviewObject(face, { w: 900, h: 900, dist: 3.1, target: new THREE.Vector3(0, 1.5, 0) }));
    }
  }
  if (want('characters', 'characters')) {
    for (const ch of buildCharacters()) {
      const buf = await exportGLB(ch.root, ch.animations);
      await save(`client/public/models/characters/${ch.id}.glb`, ab64(buf));
      manifest.characters[ch.id] = { file: `models/characters/${ch.id}.glb`, bytes: buf.byteLength, tris: ch.tris, animations: ch.animations.map((a) => a.name) };
      if (review) {
        const c = SkeletonUtils.clone(ch.root);
        await save(`tools/review/out/char_${ch.id}.png`, reviewObject(c, { w: 900, h: 900 }));
      }
    }
  }
  if (want('props', 'props')) {
    for (const p of buildProps(await headImage())) {
      const buf = await exportGLB(p.root);
      await save(`client/public/models/props/${p.id}.glb`, ab64(buf));
      manifest.props[p.id] = { file: `models/props/${p.id}.glb`, bytes: buf.byteLength, tris: p.tris };
      if (review) await save(`tools/review/out/prop_${p.id}.png`, reviewObject(p.root.clone(), { w: 900, h: 700 }));
    }
  }
  return manifest;
};
/** Crop icons rendered from the fruit models, with a Bark outline, packed into one atlas. */
window.mgIcons = async () => {
  const S = 128, cols = 8;
  const rows = Math.ceil(CROPS.length / cols);
  const atlas = document.createElement('canvas');
  atlas.width = S * cols; atlas.height = S * rows;
  const actx = atlas.getContext('2d');
  const map = {};
  setupRenderer(S * 2, S * 2);
  for (const [i, crop] of CROPS.entries()) {
    const scene = new THREE.Scene();
    scene.environment = env;
    scene.environmentIntensity = 0.7;
    scene.add(new THREE.HemisphereLight('#fff8e8', '#8a9a6a', 1.4));
    const sun = new THREE.DirectionalLight('#fff1d6', 2.4);
    sun.position.set(-2, 4, 3);
    scene.add(sun);
    const { root } = cropGroup(crop.id);
    const fruit = withMaterials(root.getObjectByName('fruit'));
    scene.add(fruit);
    const box = new THREE.Box3().setFromObject(fruit);
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.y, size.z);
    const cam = new THREE.OrthographicCamera(-r * 0.62, r * 0.62, r * 0.62, -r * 0.62, 0.01, 50);
    cam.position.set(c.x + r * 1.2, c.y + r * 0.9, c.z + r * 2.2);
    cam.lookAt(c);
    renderer.setClearColor(0x000000, 0);
    renderer.setSize(S * 2, S * 2, false);
    renderer.render(scene, cam);
    // outline: stamp the silhouette in Bark colour around the render, then the render on top
    const tile = document.createElement('canvas');
    tile.width = tile.height = S;
    const tctx = tile.getContext('2d');
    const sil = document.createElement('canvas');
    sil.width = sil.height = S;
    const sctx = sil.getContext('2d');
    sctx.drawImage(renderer.domElement, 6, 6, S - 12, S - 12);
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = '#4A2E1A';
    sctx.fillRect(0, 0, S, S);
    for (let a = 0; a < 16; a++) tctx.drawImage(sil, Math.cos((a / 16) * Math.PI * 2) * 3, Math.sin((a / 16) * Math.PI * 2) * 3);
    tctx.drawImage(renderer.domElement, 6, 6, S - 12, S - 12);
    const x = (i % cols) * S, y = Math.floor(i / cols) * S;
    actx.drawImage(tile, x, y);
    map[crop.id] = { x, y, s: S };
  }
  renderer.setClearColor(0xdfeacf, 1);
  await save('client/public/icons/crops.webp', atlas.toDataURL('image/webp', 0.92));
  await save('client/public/icons/crops.json', btoa(JSON.stringify({ w: atlas.width, h: atlas.height, icons: map })));
  await save('tools/review/out/crop_icons.png', atlas.toDataURL('image/png'));
  return Object.keys(map).length;
};
/** Filmstrip of an animation clip (for checking walk/run cycles). */
/** Show one look of the farmer (wardrobe ids, as the game stores them). */
function farmerLook(root, look = {}) {
  const a = { ...DEFAULT_AVATAR, ...look, hat: look.hat === 'none' ? 'bare' : look.hat ?? DEFAULT_AVATAR.hat };
  root.traverse((o) => {
    if (!o.isMesh) return;
    const show = outfitVisible(o.name, a, WEAR);
    if (show !== null) o.visible = show;
    if (o.userData.defColor) { o.material = o.material.clone(); o.material.color.set(o.userData.defColor); }
  });
  return root;
}

/** One picture for every wardrobe item, fur colour and beard style, packed into an atlas for the wardrobe screen. */
async function wearPictures(ch) {
  const S = 160, cols = 10; setupRenderer(S * 2, S * 2); // creates the shared materials
  const jobs = [
    ...Object.entries(WEAR).map(([id, w]) => ({ key: id, look: { [w.slot]: id }, slot: w.slot, item: w })),
    ...AVATAR.beards.map((b) => ({ key: `beard:${b.id}`, look: { beard: b.id }, slot: 'beard' })),
    ...AVATAR.fur.map((c) => ({ key: `fur:${c ?? 'original'}`, look: {}, slot: 'fur', fur: c })),
  ];
  // [height looked at, distance]
  const FRAME = { hat: [1.88, 2.35], fur: [1.8, 2.1], beard: [1.42, 2.7], shirt: [1.16, 3.1], pants: [0.57, 2.35], shoes: [0.17, 1.65] };
  const atlas = document.createElement('canvas');
  atlas.width = S * cols; atlas.height = S * Math.ceil(jobs.length / cols);
  const actx = atlas.getContext('2d');
  const map = {};
  for (const [i, job] of jobs.entries()) {
    const obj = farmerLook(SkeletonUtils.clone(ch.root), job.look);
    withMaterials(obj);
    obj.traverse((o) => {
      if (!o.isMesh) return;
      const w = job.item;
      // colour-only items tint the base shape, as the game does
      const tinted = w?.color && !w.model ? { shirt: ['farmer_shirt'], pants: ['farmer_pants'], shoes: ['farmer_boots'] }[w.slot] : w?.color && w.slot === 'hat' ? [`hat_${w.model}`] : null;
      if (tinted?.includes(o.name)) {
        o.material = o.material.clone(); o.material.color.set(w.color);
        if (w.finish === 'gold') { o.material.metalness = 0.85; o.material.roughness = 0.28; }
        if (w.finish === 'glow') { o.material.emissive = new THREE.Color(w.color); o.material.emissiveIntensity = 0.5; }
        if (w.finish === 'galaxy') { o.material.emissive = new THREE.Color('#7a5aff'); o.material.emissiveIntensity = 0.35; }
      }
      if (job.fur && o.userData.fur) { o.material = o.material.clone(); o.material.map = furTexture(o.material.map, job.fur); o.material.emissiveMap = o.material.map; }
    });
    setupRenderer(S * 2, S * 2);
    const scene = new THREE.Scene();
    lightScene(scene);
    scene.remove(scene.children[scene.children.length - 1]); // no ground
    scene.add(obj);
    const [y, base] = FRAME[job.slot];
    const dist = job.key === 'top_phoenix' ? 4.4 : job.key === 'beard:long' ? 3.2 : base;
    const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
    const turn = job.slot === 'shoes' ? 0.6 : 0.34;
    cam.position.set(Math.sin(turn) * dist, y + dist * (job.slot === 'shoes' ? 0.34 : 0.1), Math.cos(turn) * dist);
    cam.lookAt(0, job.key === 'beard:long' ? 1.25 : y, 0);
    renderer.setClearColor(0x000000, 0);
    renderer.setSize(S * 2, S * 2, false);
    renderer.render(scene, cam);
    const x = (i % cols) * S, py = Math.floor(i / cols) * S;
    actx.drawImage(renderer.domElement, x, py, S, S);
    map[job.key] = [i % cols, Math.floor(i / cols)];
  }
  renderer.setClearColor(0xdfeacf, 1);
  await save('client/public/icons/wear.webp', atlas.toDataURL('image/webp', 0.9));
  await save('client/public/icons/wear.json', btoa(JSON.stringify({ cols, rows: Math.ceil(jobs.length / cols), at: map })));
  await save('tools/review/out/wardrobe.png', atlas.toDataURL('image/png'));
}
window.mgFilmstrip = async (charId, clipName, frames = 8) => {
  const isFarmer = charId.startsWith('farmer');
  const ch = isFarmer ? buildFarmer(await headImage()) : buildCharacters().find((c) => c.id === charId);
  if (isFarmer) farmerLook(ch.root, { hat: 'none' });
  const clip = ch.animations.find((a) => a.name === clipName);
  const W = 260, H = 380;
  const sheet = document.createElement('canvas');
  sheet.width = W * frames; sheet.height = H * 2;
  const sctx = sheet.getContext('2d');
  setupRenderer(W, H);
  for (const [row, view] of [[0, 'side'], [1, 'front']].entries ? [[0, 'side'], [1, 'front']] : []) {
    for (let f = 0; f < frames; f++) {
      const scene = new THREE.Scene();
      scene.background = new THREE.Color('#dfeacf');
      lightScene(scene);
      const obj = SkeletonUtils.clone(ch.root);
      withMaterials(obj);
      scene.add(obj);
      const mixer = new THREE.AnimationMixer(obj);
      const action = mixer.clipAction(clip);
      action.play();
      mixer.setTime((f / frames) * clip.duration);
      const cam = new THREE.PerspectiveCamera(30, W / H, 0.05, 50);
      if (window.mgCloseHand) { cam.position.set(view === 'side' ? 1.6 : 0.9, 0.95, view === 'side' ? 0.25 : 1.4); cam.lookAt(0.3, 0.8, 0); }
      else { if (view === 'side') cam.position.set(4.2, 1.0, 0); else cam.position.set(1.2, 1.1, 4); cam.lookAt(0, 0.85, 0); }
      setupRenderer(W, H);
      renderer.render(scene, cam);
      sctx.drawImage(renderer.domElement, f * W, row * H, W, H);
    }
  }
  await save(`tools/review/out/film_${charId}_${clipName}.png`, sheet.toDataURL('image/png'));
  return true;
};
window.mgReady = true;

/** Mihao on a transparent background (the loading screen picture). */
function mihaoPortrait(obj) {
  const w = 700, h = 900;
  setupRenderer(w, h);
  const scene = new THREE.Scene();
  lightScene(scene);
  scene.remove(scene.children[scene.children.length - 1]); // the review ground
  scene.add(withMaterials(obj));
  const cam = new THREE.PerspectiveCamera(24, w / h, 0.05, 50);
  cam.position.set(1.9, 1.35, 7.0);
  cam.lookAt(0, 1.08, 0);
  renderer.setClearColor(0x000000, 0);
  renderer.setSize(w, h, false);
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/png');
  renderer.setClearColor(0xdfeacf, 1);
  return url;
}
