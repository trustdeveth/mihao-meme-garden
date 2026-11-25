// Animated characters: the local player, remote players (interpolated) and the three vendors.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { STALLS, PLOT, toWorld, walkable } from '@mg/shared/world/village-layout';
import { CROP } from '@mg/shared/data/crops';
import { DEFAULT_AVATAR, PETS, WEAR } from '@mg/shared/data/features';
import { PALETTE } from '../fx/world-fx.js';
import { outfitVisible, furTexture } from './outfit.js';
import { slideIn } from '../fx/ui-fx.js';

// 0-7 are the game's own actions; 8 and up are the meme poses (shared/src/data/memes.js)
export const ANIM = ['idle', 'walk', 'run', 'jump', 'plant', 'water', 'harvest', 'wave', 'stance', 'point', 'sit', 'shock', 'flex', 'dance'];
const OUTFITS = ['#3d6ea8', '#c0392b', '#2f8a4a', '#7c3aed', '#e0802a', '#1f9aa8', '#b8366a', '#5a5ad0', '#8a6a2a', '#2b6a8a', '#a83a3a', '#3a8a6a'];
const INTERP_MS = 120;
/** Speed (m/s) at which each gait clip's feet stay planted at normal playback speed. */
const NATIVE_SPEED = { walk: 4.4, run: 7.8 };
const FADE = 0.16; // seconds for cross-fades
const FPS = 16; // slightly stepped frames, like a Roblox clip (still smooth enough to read well)
const step = (t) => Math.floor(t * FPS) / FPS;
const LEG_BONES = new Set(['root', 'hips', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR']);
const UPPER_ONLY = new Set(['water', 'wave', 'talk']); // actions that never need the legs

export class Avatar {
  constructor(gltf, mats, { tint = null, scale = 1 } = {}) {
    this.root = SkeletonUtils.clone(gltf.scene);
    this.root.scale.setScalar(scale);
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.frustumCulled = false;
      if (tint && o.material.name === 'mg_outfit') { o.material = o.material.clone(); o.material.color = new THREE.Color(tint); }
    });
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = {};
    this.layered = gltf.animations.some((c) => c.tracks.some((tr) => tr.name.startsWith('thighL.')));
    for (const clip of gltf.animations) {
      this.actions[clip.name] = this.mixer.clipAction(clip);
      if (!this.layered) continue;
      // split copies: legs (hips down) for locomotion, upper body for actions while walking
      const legs = clip.tracks.filter((tr) => LEG_BONES.has(tr.name.split('.')[0]));
      const upper = clip.tracks.filter((tr) => !LEG_BONES.has(tr.name.split('.')[0]));
      this.actions[`${clip.name}@legs`] = this.mixer.clipAction(new THREE.AnimationClip(`${clip.name}@legs`, clip.duration, legs));
      this.actions[`${clip.name}@upper`] = this.mixer.clipAction(new THREE.AnimationClip(`${clip.name}@upper`, clip.duration, upper));
    }
    // the player model carries every hat, outfit and beard: show only the default set until a profile arrives
    if (this.root.getObjectByName('beard_classic')) this.applyProfile(null);
    this.weights = new Map();
    this.phase = 0; this.idleT = Math.random() * 3; this.speed = 0;
    this.base = this.actions.idle ? 'idle' : Object.keys(this.actions)[0];
    this.overlay = null;
    this.tick(1);
  }
  /**
   * Look from a player's avatar profile: skin and hair colour, hat, shirt, overalls and shoes.
   * Textured clothes are recoloured with a greyscale copy of the texture so the plaid and denim detail stays.
   */
  applyProfile(av) {
    const a = { ...DEFAULT_AVATAR, ...(av ?? {}) };
    const key = JSON.stringify(a);
    if (key === this.profileKey) return;
    this.profileKey = key;
    this.fx = [];
    const hatModel = WEAR[a.hat]?.model ?? 'straw';
    const looks = {
      farmer_skin: a.skin ? { color: a.skin } : null,
      farmer_hair: a.hair ? { color: a.hair } : null,
      farmer_brows: { color: a.hair ?? '#5a3420' },
      farmer_shirt: WEAR[a.shirt], farmer_pants: WEAR[a.pants], farmer_boots: WEAR[a.shoes],
      [`hat_${hatModel}`]: WEAR[a.hat],
    };
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      const n = o.name;
      const show = outfitVisible(n, a, WEAR);
      if (show !== null) o.visible = show;
      if (n === 'farmer_ears') looks[n] = looks.farmer_skin;
      if (n.startsWith('beard_')) looks[n] = looks.farmer_hair;
      if (/^farmer_(hand|arm)[LR]$/.test(n)) looks[n] = { color: a.skin ?? o.userData.defColor ?? '#e8b48e' };
      if (!(n in looks)) return;
      const base = o.userData.baseMat ?? o.material;
      o.userData.baseMat = base;
      let look = looks[n];
      // untouched parts show their model's own colour (orange fur, red jacket, ...): the white mesh is tinted to it
      if ((!look || (!look.color && !look.finish)) && o.userData.defColor) look = { ...look, color: o.userData.defColor };
      if (!look || (!look.color && !look.finish)) { o.material = base; return; }
      o.material = o.userData.fur && look.color && !look.finish ? furMaterial(base, look.color) : dress(base, look, o.userData.avgLum, this.fx);
    });
    this.root.scale.setScalar(a.height ?? 1);
  }
  /** A happy hop with squash and stretch (the model inside moves; its place in the world does not). */
  cheer(strength = 1) { this.hop = { t: 0, dur: 0.55, h: 0.42 * strength }; }
  hopTick(dt) {
    const body = this.root.children[0];
    if (!this.hop || !body) return;
    this.base0 ??= { y: body.position.y, s: body.scale.clone() };
    this.hop.t += dt;
    const k = Math.min(1, this.hop.t / this.hop.dur);
    const air = k > 0.18 && k < 0.82 ? Math.sin(((k - 0.18) / 0.64) * Math.PI) : 0;
    // crouch, stretch on the way up, squash on landing
    const squash = k < 0.18 ? -Math.sin((k / 0.18) * Math.PI) * 0.13 : k > 0.82 ? -Math.sin(((k - 0.82) / 0.18) * Math.PI) * 0.11 : air * 0.07;
    const { y, s } = this.base0;
    body.position.y = y + air * this.hop.h;
    body.scale.set(s.x * (1 - squash * 0.6), s.y * (1 + squash), s.z * (1 - squash * 0.6));
    if (k >= 1) { body.position.y = y; body.scale.copy(s); this.hop = null; }
  }
  /** Ground speed (m/s) for walk/run playback, so the planted foot moves exactly with the ground. */
  pace(speed) { this.speed = speed; }
  /** Locomotion / base state: idle, walk, run, jump (vendors: talk; pets: walk, sleep). */
  play(name) {
    if (!this.actions[name]) name = 'idle';
    if (name === this.base) return;
    if (name === 'jump') this.jumpT = 0;
    this.base = name;
  }
  /** Action on top of the base (plant, water, harvest, wave; pets: help). Legs keep walking if moving. */
  oneShot(name) {
    if (!this.actions[name]) return;
    this.overlay = name;
    this.overlayT = 0;
    this.busyUntil = performance.now() + this.actions[name].getClip().duration * 1000;
  }
  /** Advance the animation: pick target weights, fade toward them, set clip times by hand. */
  tick(dt) {
    this.hopTick(dt);
    const A = this.actions;
    const want = new Map();
    const loco = this.base === 'walk' || this.base === 'run';
    if (this.overlay) {
      this.overlayT += dt;
      const dur = A[this.overlay].getClip().duration;
      if (this.overlayT >= dur) this.overlay = null;
    }
    if (this.overlay && this.layered && (loco || this.base === 'jump' || UPPER_ONLY.has(this.overlay))) {
      want.set(`${this.base}@legs`, 1);
      want.set(`${this.overlay}@upper`, 1);
    } else if (this.overlay) want.set(this.overlay, 1);
    else want.set(this.base, 1);
    // gait phase shared by walk and run, scaled by real speed
    if (loco) {
      const clip = A[this.base].getClip();
      const scale = this.speed > 0.2 ? Math.min(2.4, Math.max(0.5, this.speed / NATIVE_SPEED[this.base])) : 1;
      this.phase = (this.phase + (dt * scale) / clip.duration) % 1;
    }
    this.idleT += dt;
    this.jumpT = Math.min((this.jumpT ?? 0) + dt, (A.jump?.getClip().duration ?? 1) - 0.001);
    const k = Math.min(1, dt / FADE);
    for (const [name, a] of Object.entries(A)) {
      const target = want.get(name) ?? 0;
      let w = this.weights.get(name) ?? 0;
      w += Math.sign(target - w) * Math.min(Math.abs(target - w), k);
      this.weights.set(name, w);
      if (w <= 0.0001) { if (a.isRunning()) a.stop(); continue; }
      if (!a.isRunning()) { a.reset(); a.play(); a.timeScale = 0; }
      a.setEffectiveWeight(w);
      const base = name.split('@')[0];
      const d = a.getClip().duration;
      if (base === 'walk' || base === 'run') a.time = Math.min(d - 0.001, step(this.phase * d));
      else if (base === 'jump') a.time = Math.min(d - 0.001, step(this.jumpT));
      else if (base === this.base || base === 'idle') a.time = step(this.idleT % d); // looping bases
      else a.time = Math.min(step(this.overlayT ?? 0), d - 0.001); // the action (also while it fades out)
    }
    this.mixer.update(0);
    if (this.fx?.length) {
      const s = performance.now() / 1000;
      for (const f of this.fx) {
        if (f.kind === 'rainbow') f.mat.color.setHSL((s * 0.12) % 1, 0.75, 0.55).multiplyScalar(f.gain);
        else if (f.kind === 'glow') f.mat.emissiveIntensity = 0.7 + Math.sin(s * 3) * 0.35;
        else if (f.kind === 'galaxy') f.mat.emissiveIntensity = 0.35 + Math.sin(s * 1.7) * 0.2;
      }
    }
  }
}

/** The head in another fur colour: the ginger parts change, the white muzzle and dark eyes stay. */
function furMaterial(base, color) {
  const m = base.clone();
  m.map = furTexture(base.map, color) ?? base.map;
  if (m.emissiveMap) m.emissiveMap = m.map;
  return m;
}

/** Greyscale copies of textures (cached), used to recolour textured clothes. */
const grays = new WeakMap();
function grayTexture(map) {
  if (!map?.image) return null;
  if (grays.has(map)) return grays.get(map);
  const img = map.image;
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const enc = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055) * 255;
  for (let i = 0; i < d.data.length; i += 4) {
    const y = enc(0.2126 * lin(d.data[i]) + 0.7152 * lin(d.data[i + 1]) + 0.0722 * lin(d.data[i + 2]));
    d.data[i] = d.data[i + 1] = d.data[i + 2] = y;
  }
  g.putImageData(d, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.flipY = map.flipY; tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = map.wrapS; tex.wrapT = map.wrapT;
  grays.set(map, tex);
  return tex;
}

/** A material for one clothing part: a colour, and optionally a special finish (gold, rainbow, glow, galaxy). */
function dress(base, look, avgLum, fx) {
  const m = base.clone();
  const textured = !!base.map;
  const gain = textured ? Math.min(4, Math.max(1, 1 / Math.max(0.05, avgLum ?? 0.3))) : 1;
  if (textured) m.map = grayTexture(base.map);
  if (textured && m.emissiveMap) m.emissiveMap = m.map; // the self-light must follow the new colour
  m.color = new THREE.Color(look.color ?? '#ffffff').multiplyScalar(gain);
  // plain parts with a little self-light (the facial hair) must glow in their own colour, or dark colours turn grey
  if (!textured && m.emissive?.getHex()) m.emissive.multiply(m.color);
  if (look.finish === 'gold') { m.metalness = 0.85; m.roughness = 0.28; }
  if (look.finish === 'glow') { m.emissive = new THREE.Color(look.color); m.emissiveMap = m.map ?? null; fx.push({ kind: 'glow', mat: m }); }
  if (look.finish === 'galaxy') { m.emissive = new THREE.Color('#7a5aff'); m.metalness = 0.3; m.roughness = 0.35; fx.push({ kind: 'galaxy', mat: m }); }
  if (look.finish === 'rainbow') fx.push({ kind: 'rainbow', mat: m, gain });
  return m;
}

export class Characters {
  constructor(world, assets, store) {
    this.world = world;
    this.assets = assets;
    this.store = store;
    this.avatars = new Map(); // slot -> {avatar, buf: [{t,x,z,ry,an}], label, bubble}
    this.vendors = {};
    this.labels = document.getElementById('labels');
    this.v = new THREE.Vector3();
    this.w = new THREE.Vector3();
  }

  async init() {
    // the player model
    this.gardener = await this.assets.character('farmer'); // Mihao, the Roblox-style cat in the official's jacket
    const mk = async (id, stall, scale = 1) => {
      const g = await this.assets.character(id);
      const a = new Avatar(g, this.assets.mats, { scale });
      const s = STALLS.find((x) => x.id === stall);
      const back = Math.atan2(-s.x, -s.z);
      a.root.position.set(s.x * 1.07, 0, s.z * 1.07);
      a.root.rotation.y = back;
      this.world.scene.add(a.root);
      this.vendors[stall] = a;
    };
    await mk('mole', 'seeds', 1);
    await mk('goat', 'market', 1);
    await mk('tinkerer', 'gadgets', 1);
    await mk('petkeeper', 'pets', 1);
    this.petModels = {};
    for (const kind of Object.keys(PETS)) this.petModels[kind] = await this.assets.character(`pet_${kind}`);
    this.pets = new Map(); // pet id -> {avatar, slot, kind, pos, vel}
  }

  ensure(slot) {
    let e = this.avatars.get(slot);
    if (e) return e;
    const avatar = new Avatar(this.gardener, this.assets.mats, { tint: OUTFITS[slot % OUTFITS.length] });
    this.world.scene.add(avatar.root);
    const label = document.createElement('div');
    label.className = 'nametag';
    this.labels.appendChild(label);
    e = { avatar, buf: [], label, bubble: null, bubbleUntil: 0, slot };
    this.avatars.set(slot, e);
    return e;
  }
  remove(slot) {
    const e = this.avatars.get(slot);
    if (!e) return;
    e.avatar.root.parent?.remove(e.avatar.root);
    e.label.remove();
    e.bubble?.remove();
    this.avatars.delete(slot);
  }
  /** Make pet avatars match each garden's equipped pets. Pets live and work in their owner's garden. */
  syncPets() {
    const want = new Map();
    for (const [slot, g] of this.store.gardens) for (const p of g.pets ?? []) if (this.store.members.has(slot)) want.set(p.id, { ...p, slot });
    for (const [id, e] of this.pets) if (!want.has(id)) { e.avatar.root.parent?.remove(e.avatar.root); this.pets.delete(id); }
    for (const [id, p] of want) {
      if (this.pets.has(id)) continue;
      const proto = this.petModels[p.kind];
      if (!proto) continue;
      const avatar = new Avatar(proto, this.assets.mats, { scale: 1 + p.level * 0.06 });
      const spot = this.gardenSpot(p.slot);
      avatar.root.position.set(spot.x, 0, spot.z);
      avatar.root.rotation.y = Math.random() * Math.PI * 2;
      this.world.scene.add(avatar.root);
      this.pets.set(id, { avatar, slot: p.slot, kind: p.kind, target: null, task: null, next: 0, idleSince: performance.now() });
      if (this.petsReady) { // a pet that has just arrived (hatched or equipped) makes an entrance
        this.world.fx.beam(avatar.root.position, { life: 1.1, height: 3, radius: 0.5 });
        this.world.fx.burst(avatar.root.position.clone().setY(0.4), { n: 24, colors: PALETTE.party });
        this.petCheer(id);
      }
    }
    this.petsReady = true;
  }
  /** A pet is delighted: it hops and throws hearts (or stars). */
  petCheer(id, kind = 'heart') {
    const e = this.pets?.get(id);
    if (!e) return;
    e.avatar.cheer(0.8);
    const p = e.avatar.root.position;
    this.world.fx.float(kind, p.clone().setY(0.8), { n: 4, spread: 0.6, size: 0.26 });
    this.world.fx.ring(p, { radius: 0.8, color: kind === 'heart' ? '#FF7AB6' : '#FFD84A' });
  }
  /** A shopkeeper thanks you for your custom. */
  vendorCheer(stall) {
    const v = this.vendors[stall];
    if (!v) return;
    v.cheer(0.9);
    v.oneShot('wave');
    this.world.fx.float('mihao', v.root.position.clone().setY(2.7), { size: 0.75, rise: 0.6, spread: 0.1 });
    this.world.fx.float('heart', v.root.position.clone().setY(2.1), { n: 3, spread: 0.8 });
  }
  /** Dust from running feet and a puff on landing. */
  footDust(avatar, dt) {
    const p = avatar.root.position;
    const jumping = avatar.base === 'jump';
    if (avatar.wasJumping && !jumping) { this.world.fx.ring(p, { radius: 0.9, color: '#FFF4DC' }); this.world.fx.burst(p.clone().setY(0.12), { n: 12, colors: PALETTE.white, up: 1, speed: 1.6, size: 0.1, life: 0.45 }); }
    avatar.wasJumping = jumping;
    const gait = avatar.base === 'run' ? 0.17 : avatar.base === 'walk' ? 0.34 : 0;
    avatar.dust = gait ? (avatar.dust ?? 0) + dt : 0;
    if (gait && avatar.dust > gait) { avatar.dust = 0; this.world.fx.burst(p.clone().setY(0.1), { n: avatar.base === 'run' ? 4 : 2, colors: PALETTE.white, up: 0.9, speed: 0.7, size: 0.085, life: 0.4, gravity: 2 }); }
  }
  /** A random walkable point inside a garden (world coordinates). */
  gardenSpot(slot, nearPlant = false) {
    const plants = [...(this.store.gardens.get(slot)?.plants.values() ?? [])];
    if (nearPlant && plants.length) {
      const pl = plants[Math.floor(Math.random() * plants.length)];
      const a = Math.random() * Math.PI * 2, r = (CROP[pl.crop]?.radius ?? 0.6) + 0.35;
      return toWorld(slot, pl.x + Math.sin(a) * r, pl.z + Math.cos(a) * r);
    }
    for (let k = 0; k < 12; k++) { // a free spot (not inside the house)
      const w = toWorld(slot, (Math.random() - 0.5) * (PLOT.w - 5), -PLOT.d / 2 + 2.5 + Math.random() * (PLOT.d - 6));
      if (walkable(w.x, w.z, 0.3)) return w;
    }
    return toWorld(slot, 0, PLOT.d / 2 - 3);
  }
  /** A pet did real work on the server: run to that plant and do it. h = {pet, did, x, z} (plot-local). */
  petWork(slot, h) {
    const e = this.pets?.get(h.pet);
    if (!e || !Number.isFinite(h.x)) return;
    const r = 0.55 + Math.random() * 0.3, a = Math.random() * Math.PI * 2;
    const w = toWorld(slot, h.x + Math.sin(a) * r, h.z + Math.cos(a) * r);
    const p = toWorld(slot, h.x, h.z);
    e.task = { x: w.x, z: w.z, px: p.x, pz: p.z, did: h.did, until: performance.now() + 9000 };
  }
  /** Little particle bursts: water drops or a harvest pop. */
  burst(x, z, kind) {
    const color = kind === 'water' ? '#5fb8ff' : '#ffd84a';
    for (let i = 0; i < (kind === 'water' ? 14 : 10); i++) {
      const m = new THREE.Mesh(this.fxGeo ??= new THREE.SphereGeometry(0.05, 6, 4), new THREE.MeshBasicMaterial({ color, transparent: true }));
      m.position.set(x + (Math.random() - 0.5) * 0.3, kind === 'water' ? 0.9 + Math.random() * 0.3 : 0.4, z + (Math.random() - 0.5) * 0.3);
      m.userData = { vx: (Math.random() - 0.5) * 1.2, vy: kind === 'water' ? -0.5 - Math.random() : 2 + Math.random() * 1.5, vz: (Math.random() - 0.5) * 1.2, life: 0.9 };
      this.world.scene.add(m);
      (this.fx ??= []).push(m);
    }
  }

  sync() {
    for (const slot of [...this.avatars.keys()]) if (!this.store.members.has(slot)) this.remove(slot);
    for (const [slot, m] of this.store.members) {
      const e = this.ensure(slot);
      const text = (m.stars ? `${'*'.repeat(Math.min(5, m.stars))} ` : '') + m.name + (m.title ? ` · ${m.title}` : '') + (m.afk ? ' (away)' : '');
      const tierName = { golden: 'Golden Tree', bloom: 'Bloom', sprout: 'Sprout' }[m.holder];
      e.label.replaceChildren();
      if (tierName) { const b = document.createElement('span'); b.className = `hbadge ${m.holder}`; b.textContent = tierName; e.label.append(b); }
      if (m.club) { const b = document.createElement('span'); b.className = 'hbadge club'; b.textContent = 'Club'; e.label.append(b); }
      e.label.append(document.createTextNode(text));
      e.label.classList.toggle('clubname', !!m.club);
      e.avatar.applyProfile(m.avatar);
      e.label.classList.toggle('afk', !!m.afk || !!m.ghost);
      if (slot !== this.store.you?.slot && !e.buf.length) this.push(slot, m.x, m.z, m.ry, m.an);
    }
  }
  push(slot, x, z, ry, an) {
    const e = this.ensure(slot);
    e.buf.push({ t: performance.now(), x, z, ry, an });
    if (e.buf.length > 20) e.buf.shift();
  }
  say(slot, text) {
    const e = this.avatars.get(slot);
    if (!e) return;
    if (!e.bubble) { e.bubble = document.createElement('div'); e.bubble.className = 'bubble'; this.labels.appendChild(e.bubble); }
    e.bubble.textContent = text;
    e.bubbleUntil = performance.now() + 6000;
    slideIn(e.bubble, '0 18px');
    e.avatar.cheer(0.35);
    // put it over the head right away: a photo taken before the next frame must show it in the right place
    this.place(e.bubble, e.avatar.root.position, 3.02 * e.avatar.root.scale.y);
  }
  floater(pos, text) {
    const d = document.createElement('div');
    d.className = 'floater';
    d.textContent = text;
    this.labels.appendChild(d);
    const p = pos.clone();
    const tick = () => { this.place(d, p, 2.4); };
    tick();
    const id = setInterval(tick, 16);
    setTimeout(() => { clearInterval(id); d.remove(); }, 1400);
  }
  place(el, pos, up) {
    this.v.copy(pos);
    this.v.y += up;
    this.v.project(this.world.camera);
    const vis = this.v.z < 1 && Math.abs(this.v.x) < 1.1 && Math.abs(this.v.y) < 1.1;
    el.style.display = vis ? '' : 'none';
    if (vis) {
      el.style.left = `${(this.v.x * 0.5 + 0.5) * innerWidth}px`; el.style.top = `${(-this.v.y * 0.5 + 0.5) * innerHeight}px`;
      // perspective: farther names are smaller and drawn under nearer ones
      const d = this.world.camera.position.distanceTo(this.w.copy(pos).setY(pos.y + up));
      el.style.transform = `translate(-50%, -100%) scale(${Math.min(1.05, Math.max(0.45, 13 / d)).toFixed(3)})`;
      el.style.zIndex = String(2000 + Math.max(0, 900 - Math.round(d * 8)));
    }
  }

  /** Local player avatar follows the controller directly. */
  setLocal(pos, ry, an, speed = 0) {
    const e = this.ensure(this.store.you.slot);
    e.avatar.root.position.set(pos.x, pos.y ?? 0, pos.z);
    e.avatar.root.rotation.y = ry;
    e.avatar.play(ANIM[an] ?? 'idle');
    e.avatar.pace(speed);
  }
  playOneShot(slot, name) { this.avatars.get(slot)?.avatar.oneShot(name); }
  vendorTalk(stall, on) { const v = this.vendors[stall]; if (v) v.play(on ? 'talk' : 'idle'); }

  update(dt) {
    const now = performance.now();
    const renderT = now - INTERP_MS;
    const camPos = this.world.camera.position;
    for (const [slot, e] of this.avatars) {
      const root = e.avatar.root;
      if (slot !== this.store.you?.slot && e.buf.length) {
        // interpolate between the two buffered samples around renderT
        let a = e.buf[0], b = e.buf[e.buf.length - 1];
        for (let i = 0; i < e.buf.length - 1; i++) if (e.buf[i].t <= renderT && e.buf[i + 1].t >= renderT) { a = e.buf[i]; b = e.buf[i + 1]; break; }
        const k = b.t > a.t ? Math.min(1, Math.max(0, (renderT - a.t) / (b.t - a.t))) : 1;
        root.position.set(a.x + (b.x - a.x) * k, 0, a.z + (b.z - a.z) * k);
        let dr = b.ry - a.ry; while (dr > Math.PI) dr -= Math.PI * 2; while (dr < -Math.PI) dr += Math.PI * 2;
        root.rotation.y = a.ry + dr * k;
        const an = b.an;
        if ([4, 5, 6, 7].includes(an)) { if (e.lastAn !== an) e.avatar.oneShot(ANIM[an]); } else e.avatar.play(ANIM[an] ?? 'idle');
        const prev = e.buf[e.buf.length - 2];
        if (prev) { const last = e.buf[e.buf.length - 1]; e.avatar.pace(Math.hypot(last.x - prev.x, last.z - prev.z) / Math.max(0.05, (last.t - prev.t) / 1000)); }
        e.lastAn = an;
      }
      // far avatars animate less often
      const far = root.position.distanceTo(camPos) > 45;
      e.acc = (e.acc ?? 0) + dt;
      if (!far || e.acc > 0.1) { e.avatar.tick(e.acc); e.acc = 0; }
      this.footDust(e.avatar, dt);
      this.place(e.label, root.position, 2.62 * root.scale.y);
      if (e.bubble) {
        if (now > e.bubbleUntil) { e.bubble.remove(); e.bubble = null; }
        else this.place(e.bubble, root.position, 3.02 * root.scale.y);
      }
    }
    for (const v of Object.values(this.vendors)) {
      // shopkeepers wave and hop now and then, so the plaza never stands still
      v.nextFidget ??= now + 2000 + Math.random() * 8000;
      if (now > v.nextFidget) {
        v.nextFidget = now + 6000 + Math.random() * 9000;
        if (v.base === 'idle') { v.oneShot('wave'); if (Math.random() < 0.5) v.cheer(0.5); this.world.fx.float('mihao', v.root.position.clone().setY(2.7), { size: 0.6, rise: 0.5, spread: 0.1 }); }
      }
      v.tick(dt);
    }
    // pets live in their owner's garden: they wander, sniff the plants, nap, and run to real jobs
    for (const e of this.pets?.values() ?? []) {
      const root = e.avatar.root;
      if (e.task && now > e.task.until) e.task = null;
      if (!e.task && !e.target && now > e.next) {
        e.target = this.gardenSpot(e.slot, Math.random() < 0.6);
        e.sniff = Math.random() < 0.5;
        e.next = now + 3500 + Math.random() * 6000;
      }
      const goal = e.task ?? e.target;
      let moving = false;
      if (goal) {
        const dx = goal.x - root.position.x, dz = goal.z - root.position.z, d = Math.hypot(dx, dz);
        if (d > 25) { root.position.x = goal.x; root.position.z = goal.z; }
        else if (d > 0.12) {
          const speed = e.task ? 3.4 : 1.3;
          const step = Math.min(d, speed * dt);
          const nx = root.position.x + (dx / d) * step, nz = root.position.z + (dz / d) * step;
          if (walkable(nx, nz, 0.25)) { root.position.x = nx; root.position.z = nz; }
          else if (walkable(nx, root.position.z, 0.25)) root.position.x = nx;
          else if (walkable(root.position.x, nz, 0.25)) root.position.z = nz;
          else if (e.task) e.task.until = 0; // cannot reach that plant from here: give up the trip
          else e.target = null; // blocked by the house or a fence: pick another spot
          let dr = Math.atan2(dx, dz) - root.rotation.y;
          while (dr > Math.PI) dr -= Math.PI * 2;
          while (dr < -Math.PI) dr += Math.PI * 2;
          root.rotation.y += dr * Math.min(1, dt * 10);
          moving = true;
          e.avatar.pace(speed);
        } else if (e.task) {
          // arrived at the job: face the plant, work, show the result
          root.rotation.y = Math.atan2(e.task.px - root.position.x, e.task.pz - root.position.z);
          e.avatar.oneShot('help');
          this.burst(e.task.px, e.task.pz, e.task.did);
          const spot = new THREE.Vector3(e.task.px, 0.3, e.task.pz);
          if (e.task.did === 'water') this.world.fx.rain(spot, { n: 22 }); else this.world.fx.float('star', spot.clone().setY(1), { n: 3 });
          this.world.fx.ring(spot, { radius: 0.8, color: e.task.did === 'water' ? '#9BD8FF' : '#FFD84A' });
          e.avatar.cheer(0.7);
          this.world.fx.float('heart', root.position.clone().setY(0.8), { n: 2, size: 0.22 });
          e.task = null;
          e.idleSince = now;
          e.next = now + 1500;
        } else {
          if (e.sniff) e.avatar.oneShot('help');
          e.target = null;
          e.idleSince = now;
        }
      }
      e.avatar.play(moving ? 'walk' : now - e.idleSince > 14000 && !e.task ? 'sleep' : 'idle');
      if (moving) e.idleSince = now;
      // little signs of life: playful hops when resting, "z" when asleep
      e.mood ??= now + 2000 + Math.random() * 5000;
      if (now > e.mood) {
        const asleep = e.avatar.base === 'sleep';
        e.mood = now + (asleep ? 1600 : 4000 + Math.random() * 6000);
        if (asleep) this.world.fx.float('z', root.position.clone().setY(0.7), { size: 0.24, rise: 0.45, spread: 0.1 });
        else if (!moving) { e.avatar.cheer(0.55); if (Math.random() < 0.4) this.world.fx.float('heart', root.position.clone().setY(0.8), { size: 0.22 }); }
      }
      e.avatar.tick(dt);
    }
    // particle bursts
    if (this.fx?.length) {
      this.fx = this.fx.filter((m) => {
        const u = m.userData;
        u.life -= dt; u.vy -= 6 * dt;
        m.position.x += u.vx * dt; m.position.y = Math.max(0.03, m.position.y + u.vy * dt); m.position.z += u.vz * dt;
        m.material.opacity = Math.max(0, u.life / 0.9);
        if (u.life > 0) return true;
        m.parent?.remove(m); m.material.dispose();
        return false;
      });
    }
  }
}
