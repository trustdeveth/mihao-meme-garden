// Shared material library: exported models only carry material *names* (mg_leaf, mg_bark, ...).
// The client and the review renderer both build the real materials here, so models look identical.
import * as THREE from 'three';

/** Texture names and how they repeat. */
export const TEXTURES = ['soil', 'wood', 'paving', 'grass'];
/** Roblox look: only these surfaces carry a texture (studs, plaza bricks, planks); everything else is flat plastic. */
const TEXTURED = new Set(TEXTURES);

/**
 * @param {Record<string, {map?:THREE.Texture, normal?:THREE.Texture}>} tex
 * @returns {Record<string, THREE.Material>}
 */
export function createMaterials(tex = {}) {
  const t = (name, repeat = 1) => {
    const e = TEXTURED.has(name) ? tex[name] : null;
    if (!e) return {};
    for (const x of [e.map, e.normal]) {
      if (!x) continue;
      x.wrapS = x.wrapT = THREE.RepeatWrapping;
      x.repeat.set(repeat, repeat);
      x.anisotropy = 4;
    }
    if (e.map) e.map.colorSpace = THREE.SRGBColorSpace;
    return { map: e.map ?? null, normalMap: e.normal ?? null };
  };
  const std = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, ...o });
  const phys = (o) => new THREE.MeshPhysicalMaterial({ vertexColors: true, ...o });
  const m = {
    leaf: phys({ ...t('leaf'), roughness: 0.62, side: THREE.DoubleSide }),
    stem: std({ roughness: 0.68 }),
    foliage: std({ ...t('foliage'), roughness: 0.7, alphaTest: 0.45, side: THREE.DoubleSide, normalScale: new THREE.Vector2(0.6, 0.6) }),
    blossom: std({ ...t('blossoms'), roughness: 0.6, alphaTest: 0.45, side: THREE.DoubleSide }),
    blossomGlow: std({ ...t('blossoms'), roughness: 0.5, alphaTest: 0.45, side: THREE.DoubleSide, emissive: new THREE.Color('#9fb8ff'), emissiveIntensity: 0.6 }),
    bark: std({ ...t('bark', 2), roughness: 0.95, normalScale: new THREE.Vector2(1.2, 1.2) }),
    fruit: phys({ ...t('skin'), roughness: 0.32, clearcoat: 0.45, clearcoatRoughness: 0.35, normalScale: new THREE.Vector2(0.25, 0.25) }),
    fruitMatte: std({ ...t('fur'), roughness: 0.86, normalScale: new THREE.Vector2(0.5, 0.5) }),
    petal: phys({ ...t('petal'), roughness: 0.55, side: THREE.DoubleSide, sheen: 0.6, sheenColor: new THREE.Color('#ffffff'), sheenRoughness: 0.5 }),
    glow: std({ ...t('petal'), roughness: 0.4, side: THREE.DoubleSide, emissive: new THREE.Color('#9fb8ff'), emissiveIntensity: 0.55 }),
    soil: std({ ...t('soil', 2), roughness: 0.97, normalScale: new THREE.Vector2(1.4, 1.4) }),
    wood: std({ ...t('wood'), roughness: 0.82, normalScale: new THREE.Vector2(0.8, 0.8) }),
    stone: std({ ...t('stone'), roughness: 0.9, normalScale: new THREE.Vector2(1, 1) }),
    paving: std({ ...t('paving', 1), roughness: 0.88, normalScale: new THREE.Vector2(1.1, 1.1) }),
    fabric: std({ ...t('fabric', 3), roughness: 0.9, side: THREE.DoubleSide }),
    skin: std({ roughness: 0.7 }),
    cloth: std({ ...t('fabric', 4), roughness: 0.92 }),
    outfit: std({ ...t('fabric', 4), roughness: 0.88 }), // tinted per player (material.color)
    hair: std({ ...t('fur', 2), roughness: 0.75 }),
    fur: std({ ...t('fur', 2), roughness: 0.9 }),
    metal: std({ roughness: 0.32, metalness: 0.85 }),
    eye: std({ roughness: 0.35 }),
    water: new THREE.MeshPhysicalMaterial({ color: '#3FA9E0', roughness: 0.06, metalness: 0, transmission: 0, transparent: true, opacity: 0.82, clearcoat: 1 }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#dff3ff', roughness: 0.05, transparent: true, opacity: 0.32, side: THREE.DoubleSide }),
    grass: std({ ...t('grass', 1), roughness: 0.95 }),
    plain: std({ roughness: 0.8 }),
  };
  for (const [k, v] of Object.entries(m)) v.name = `mg_${k}`;
  return m;
}

/** Swap placeholder materials on a loaded model for the shared ones (by name). */
export function applyMaterials(root, mats) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const name = (o.material?.name ?? '').replace(/^mg_/, '');
    if (!name.startsWith('tex_')) o.material = mats[name] ?? mats.plain; // imported models keep their own textures
    o.castShadow = !['glass', 'water'].includes(name);
    o.receiveShadow = true;
  });
  return root;
}
