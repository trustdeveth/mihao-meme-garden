// What the player's avatar shows: shared by the game and by the tool that renders the wardrobe pictures.
import * as THREE from 'three';

const BASE_PARTS = { farmer_shirt: 'shirt', farmer_shirtdeco: 'shirt', farmer_trim_shirt: 'shirt', farmer_pants: 'pants', farmer_pantsdeco: 'pants', farmer_trim_pants: 'pants', farmer_boots: 'shoes', farmer_bootsdeco: 'shoes' };

/** Should this mesh show for this avatar? null = the mesh is not switched by the wardrobe. */
export function outfitVisible(name, avatar, WEAR) {
  const model = (slot) => WEAR[avatar[slot]]?.model ?? 'base';
  const hat = WEAR[avatar.hat]?.model ?? 'straw';
  if (name === 'farmer_hat') return hat === 'straw';
  if (name.startsWith('hat_')) return name === `hat_${hat}` || name.startsWith(`hat_${hat}__`);
  if (name.startsWith('beard_')) return name === `beard_${avatar.beard ?? 'classic'}`;
  if (name === 'farmer_ears' || name === 'farmer_earsin') return !WEAR[avatar.hat]?.coversEars;
  if (name in BASE_PARTS) return model(BASE_PARTS[name]) === 'base';
  const fit = /^fit_(shirt|pants|shoes)_([a-z]+)__/.exec(name);
  return fit ? model(fit[1]) === fit[2] : null;
}

const cache = new WeakMap(); // source texture -> Map(colour -> recoloured texture)

/**
 * A copy of the head texture in another fur colour. Only the coloured (ginger) fur changes, keeping its light
 * and shade; pale fur stays pale, so black fur gives a white-muzzled tuxedo cat.
 */
export function furTexture(map, color) {
  if (!map?.image) return null;
  let byColor = cache.get(map);
  if (!byColor) cache.set(map, (byColor = new Map()));
  if (byColor.has(color)) return byColor.get(color);
  const img = map.image;
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  const target = [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)];
  const FUR_LIGHT = 160; // typical brightness of the ginger fur
  for (let i = 0; i < d.data.length; i += 4) {
    const r = d.data[i], gr = d.data[i + 1], b = d.data[i + 2];
    const max = Math.max(r, gr, b), min = Math.min(r, gr, b);
    const sat = max ? (max - min) / max : 0;
    const w = Math.min(1, Math.max(0, (sat - 0.13) / 0.24));
    if (!w) continue;
    const shade = (0.299 * r + 0.587 * gr + 0.114 * b) / FUR_LIGHT;
    for (let k = 0; k < 3; k++) d.data[i + k] = d.data[i + k] * (1 - w) + Math.min(255, target[k] * shade) * w;
  }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.flipY = map.flipY; t.colorSpace = THREE.SRGBColorSpace; t.wrapS = map.wrapS; t.wrapT = map.wrapT; t.anisotropy = map.anisotropy;
  byColor.set(color, t);
  return t;
}
