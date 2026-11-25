// Loads compressed models and textures, builds the shared materials, and caches crop models.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createMaterials, applyMaterials, TEXTURES } from './materials.js';

export class Assets {
  constructor(renderer) {
    this.renderer = renderer;
    this.loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    this.manifest = null;
    this.mats = null;
    this.crops = new Map(); // id -> Promise<{stages, l1, fruit, anchors, fruitH}>
    this.models = new Map(); // file -> Promise<gltf>
    this.cropIcons = null;
  }

  async init(onProgress = () => {}) {
    this.manifest = await (await fetch('/models/manifest.json')).json();
    this.cropIcons = await (await fetch('/icons/crops.json')).json().catch(() => null);
    const tl = new THREE.TextureLoader();
    const tex = {};
    let done = 0;
    const total = TEXTURES.length * 2;
    await Promise.all(TEXTURES.map(async (name) => {
      const load = (f) => tl.loadAsync(`/textures/${f}.webp`).then((t) => { onProgress(++done / total); return t; }, () => null);
      const [map, normal] = await Promise.all([load(name), load(`${name}_n`)]);
      tex[name] = { map, normal };
    }));
    this.mats = createMaterials(tex);
    return this;
  }

  gltf(file) {
    if (!this.models.has(file)) this.models.set(file, this.loader.loadAsync(`/${file}`).then((g) => { applyMaterials(g.scene, this.mats); return g; }));
    return this.models.get(file);
  }
  character(id) { return this.gltf(this.manifest.characters[id].file); }
  prop(id) { return this.gltf(this.manifest.props[id].file); }

  /** Crop model split into stage nodes, LOD1 nodes, fruit and fruit anchors. */
  crop(id) {
    if (!this.crops.has(id)) {
      this.crops.set(id, this.gltf(this.manifest.crops[id].file).then((g) => {
        const root = g.scene.getObjectByName(`crop_${id}`) ?? g.scene;
        const get = (n) => root.getObjectByName(n);
        const stages = [0, 1, 2, 3, 4].map((s) => get(`stage${s}`));
        const l1 = [0, 1, 2, 3, 4].map((s) => get(`stage${s}_l1`));
        const fruit = get('fruit');
        const anchors = root.children.filter((c) => c.name.startsWith('s4_fruit_')).map((a) => ({ pos: a.position.clone(), hang: a.userData?.hang !== false }));
        const fb = new THREE.Box3().setFromObject(fruit);
        return { stages, l1, fruit, anchors, fruitH: fb.max.y - fb.min.y };
      }));
    }
    return this.crops.get(id);
  }

  /** CSS for a crop icon from the atlas. */
  cropIconStyle(id, size = 48) {
    const ic = this.cropIcons?.icons?.[id];
    if (!ic) return '';
    const k = size / ic.s;
    return `background-image:url(/icons/crops.webp);background-size:${this.cropIcons.w * k}px ${this.cropIcons.h * k}px;background-position:-${ic.x * k}px -${ic.y * k}px`;
  }
}

// ---- Fruit looks: variants, weather marks and ripeness change the material -----------------

const fruitMatCache = new Map();
/**
 * Material for a fruit with a given variant / environment / ripeness.
 * @param {THREE.Material} base
 */
export function fruitMaterial(base, { v = 'normal', e = [], ripe = 0, unripe = 0 }) {
  const key = `${base.name}|${v}|${[...e].sort().join(',')}|${ripe}|${unripe}`;
  if (fruitMatCache.has(key)) return fruitMatCache.get(key);
  const m = base.clone();
  if (v === 'golden') { m.color = new THREE.Color('#ffcc40'); m.metalness = 0.85; m.roughness = 0.25; m.emissive = new THREE.Color('#5a3a00'); m.emissiveIntensity = 0.25; }
  else if (v === 'silver') { m.color = new THREE.Color('#e8eef5'); m.metalness = 0.9; m.roughness = 0.18; }
  else if (v === 'rainbow' && m.isMeshPhysicalMaterial) { m.iridescence = 1; m.iridescenceIOR = 1.6; m.iridescenceThicknessRange = [200, 900]; m.emissive = new THREE.Color('#ff7ad9'); m.emissiveIntensity = 0.25; }
  if (e.includes('wet') && m.isMeshPhysicalMaterial) { m.clearcoat = 1; m.clearcoatRoughness = 0.05; m.roughness = Math.min(m.roughness, 0.2); }
  if (e.includes('chilled') || e.includes('slushy')) { m.color = (m.color ?? new THREE.Color(1, 1, 1)).clone().lerp(new THREE.Color('#cfefff'), 0.45); if (m.isMeshPhysicalMaterial) { m.sheen = 1; m.sheenColor = new THREE.Color('#ffffff'); } }
  if (e.includes('moonlit')) { m.emissive = new THREE.Color('#8f7aff'); m.emissiveIntensity = 0.35; }
  if (e.includes('sunbaked')) m.color = (m.color ?? new THREE.Color(1, 1, 1)).clone().multiply(new THREE.Color('#ffd7a8'));
  if (e.includes('zapped')) { m.emissive = new THREE.Color('#ffe14a'); m.emissiveIntensity = 0.55; }
  if (e.includes('starstruck')) { m.emissive = new THREE.Color('#ffffff'); m.emissiveIntensity = 0.7; }
  // ripeness: deeper colour and more gloss as the fruit goes Juicy and Peak
  if (ripe > 0) { m.color = (m.color ?? new THREE.Color(1, 1, 1)).clone().multiplyScalar(1 - ripe * 0.06); if (m.isMeshPhysicalMaterial) m.clearcoat = Math.max(m.clearcoat ?? 0, 0.4 + ripe * 0.3); }
  // unripe fruit (still growing on a regrowing plant): green, matte, less glossy
  if (unripe > 0) {
    m.color = (m.color ?? new THREE.Color(1, 1, 1)).clone().lerp(new THREE.Color('#8fc25a'), unripe * 0.85);
    m.roughness = Math.min(1, (m.roughness ?? 0.5) + unripe * 0.25);
    if (m.isMeshPhysicalMaterial) m.clearcoat = (m.clearcoat ?? 0) * (1 - unripe);
    if (m.emissiveIntensity) m.emissiveIntensity *= 1 - unripe;
  }
  m.name = base.name;
  fruitMatCache.set(key, m);
  return m;
}
