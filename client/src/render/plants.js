// Draws every garden's plants: growth stage from the shared growth math, LOD by distance,
// fruit at the model's anchor points with variant / weather / ripeness looks.
import * as THREE from 'three';
import { progressAt, stageOf } from '@mg/shared/rules/growth';
import { ripenessAt } from '@mg/shared/rules/ripening';
import { CROP } from '@mg/shared/data/crops';
import { GADGETS } from '@mg/shared/data/tables';
import { fruitMaterial } from '../assets/assets.js';
import { PALETTE, ease } from '../fx/world-fx.js';

const LOD_FAR = 22;
const SOIL_Y = 0.05;
/**
 * Display size of each crop next to the 2 m farmer (the models were made for a shorter gardener).
 * Trees tower over the farmer, bushes reach the chest, low crops grow a little. Only the look changes:
 * how much room a crop needs on the soil stays the same.
 */
const DISPLAY_SCALE = {
  banana: 1.75, coconut: 1.75, mango: 1.8, avocado: 1.75, pear: 1.75, nectarine: 1.75, cacao: 1.65, sugarapple: 1.7,
  cherryblossom: 1.75, candyblossom: 1.7, moonblossom: 1.7,
  bamboo: 1.6, beanstalk: 1.6, kiwi: 1.45, dragonfruit: 1.45, cactus: 1.45,
  tomato: 1.35, blueberry: 1.35, eggplant: 1.35, pepper: 1.35,
  pinklily: 1.3, pineapple: 1.3, orchid: 1.25, starflower: 1.25, pumpkin: 1.3, watermelon: 1.3, cauliflower: 1.25,
  carrot: 1.2, strawberry: 1.25,
};

export class PlantRenderer {
  constructor(world, assets, store) {
    this.world = world;
    this.assets = assets;
    this.store = store;
    this.slots = new Map(); // slot -> Map(plantId -> view)
    this.effects = new Map(); // slot -> Group of sprinkler visuals
    this.tmp = new THREE.Vector3();
    this.seen = new Map(); // slot -> soil level once the garden has been drawn: only later changes are animated
    this.owner = () => null; // slot -> where that garden's owner is (harvested fruit flies there)
    store.on('reset', () => this.resetAll());
    store.on('garden', (slot) => this.syncSlot(slot));
  }

  resetAll() {
    this.seen.clear();
    for (const [slot] of this.slots) this.clearSlot(slot);
    for (const slot of this.store.gardens.keys()) this.syncSlot(slot);
  }

  clearSlot(slot) {
    const views = this.slots.get(slot);
    if (views) for (const v of views.values()) v.group.parent?.remove(v.group);
    this.slots.delete(slot);
    this.seen.delete(slot);
  }

  spot(v, up = 0.15) { return v.group.getWorldPosition(new THREE.Vector3()).setY(up); }

  /** The fruit on a plant leaps off in arcs to whoever picked it. */
  pluck(slot, v) {
    const fx = this.world.fx;
    const home = this.spot(v, 1);
    fx.burst(this.spot(v, v.height * 0.6 || 0.6), { n: 22, colors: [...PALETTE.leaf, ...PALETTE.gold], up: 2.8 });
    fx.float('star', this.spot(v, v.height || 1), { n: 3, spread: 0.7 });
    const send = (copy, from, i) => fx.fly(copy, from, () => this.owner(slot) ?? home, { delay: i * 0.07, onDone: (end) => fx.burst(end, { n: 5, colors: PALETTE.gold, up: 1.4, speed: 0.9, life: 0.4 }) });
    const hanging = (v.fruitGroup?.children ?? []).slice(0, 7);
    hanging.forEach((f, i) => { const copy = f.clone(); f.getWorldScale(copy.scale); send(copy, f.getWorldPosition(new THREE.Vector3()), i); });
    // root crops show no hanging fruit: the crop itself jumps out of the soil
    if (!hanging.length && v.model?.fruit) for (let i = 0; i < Math.min(3, CROP[v.crop].fruits || 1); i++) {
      const copy = v.model.fruit.clone();
      copy.scale.setScalar(v.group.scale.x * 1.2);
      send(copy, this.spot(v, 0.45 + i * 0.12), i);
    }
  }

  /** A plant that is taken out shrinks away in a puff. */
  vanish(slot, v) {
    const fx = this.world.fx;
    if (v.hadFruit) this.pluck(slot, v);
    else fx.burst(this.spot(v, 0.3), { n: 20, colors: [...PALETTE.dirt, ...PALETTE.leaf] });
    const parent = v.group.parent;
    if (!parent || !fx.visible(this.spot(v))) { parent?.remove(v.group); return; }
    v.group.traverse((o) => { o.raycast = () => {}; });
    const s = v.group.scale.x;
    fx.tween(0.42, (k) => { const wide = Math.max(0.001, s * (1 + k * 0.35) * (1 - k * k)); v.group.scale.set(wide, Math.max(0.001, s * (1 - ease.in(k))), wide); v.group.rotation.y += 0.28; }, () => parent.remove(v.group));
  }

  /** What changed on a plant since it was last drawn. */
  react(slot, v, p) {
    const fx = this.world.fx;
    if (p.watered && !v.watered) {
      fx.rain(this.spot(v, 0.1), { n: 34, height: Math.max(1.3, v.height + 0.4), radius: 0.5 });
      fx.ring(this.spot(v), { radius: 1, color: '#9BD8FF' });
      v.anim = { t: -0.35, dur: 0.7, amp: 0.2 };
      fx.float('drop', this.spot(v, (v.height || 0.8) + 0.2), { n: 3, delay: 0.14 });
    }
    if (v.hadFruit && !p.fruit) { this.pluck(slot, v); v.anim = { t: 0, dur: 0.6, amp: 0.22 }; }
    if (!v.hadFruit && p.fruit) { // it has ripened (or was grown with a gadget): the fruit pops out
      v.fruitPop = 0;
      v.anim = { t: 0, dur: 0.65, amp: 0.2 };
      fx.ring(this.spot(v), { radius: 1.1 });
      fx.float('star', this.spot(v, (v.height || 0.9) * 0.8), { n: 5, spread: 0.9 });
    }
    if (v.at && Math.hypot(v.at.x - p.x, v.at.z - p.z) > 0.05) { // replanted with the trowel
      v.hop = 0;
      fx.burst(this.spot(v, 0.15), { n: 14, colors: PALETTE.dirt });
    }
  }

  /** Just planted: a seed drops in, the soil jumps and the sprout springs up. */
  sprout(v) {
    const fx = this.world.fx;
    v.birth = -0.28;
    const to = this.spot(v, 0.08);
    const seed = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.14), new THREE.MeshBasicMaterial({ color: '#E8B53A', toneMapped: false }));
    fx.fly(seed, to.clone().setY(1.9), () => to, { life: 0.28, arc: 0, onDone: () => { seed.geometry.dispose(); seed.material.dispose(); } });
    fx.tween(0.01, () => {}, () => { fx.burst(to, { n: 22, colors: PALETTE.dirt, up: 2.6 }); fx.ring(to, { radius: 0.9, color: '#C9955E' }); fx.float('star', to.clone().setY(0.7), { n: 3 }); }, 0.28);
  }

  syncSlot(slot) {
    const garden = this.store.gardens.get(slot);
    const plot = this.world.plots[slot];
    if (!plot) return;
    if (!garden) { this.clearSlot(slot); return; }
    const live = this.seen.has(slot);
    const grewSoil = live && garden.soil > this.seen.get(slot);
    this.seen.set(slot, garden.soil);
    this.world.setSoil(plot, garden.soil);
    if (grewSoil) {
      const mid = plot.group.getWorldPosition(new THREE.Vector3());
      for (let i = 0; i < 3; i++) this.world.fx.tween(0.01, () => {}, () => this.world.fx.ring(mid, { radius: 5 + i * 1.5, life: 0.9 }), i * 0.22);
      this.world.fx.burst(mid.clone().setY(0.3), { n: 60, colors: PALETTE.dirt, spread: 4, up: 4, speed: 3 });
    }
    const views = this.slots.get(slot) ?? new Map();
    this.slots.set(slot, views);
    for (const [id, v] of views) if (!garden.plants.has(id)) { views.delete(id); this.vanish(slot, v); }
    for (const p of garden.plants.values()) {
      let v = views.get(p.id);
      if (!v) {
        v = { id: p.id, crop: p.crop, group: new THREE.Group(), stage: -1, lod: -1, fruitKey: '', model: null };
        v.group.userData = { kind: 'plant', slot, id: p.id };
        v.group.rotation.y = (hashId(p.id) % 628) / 100;
        v.group.scale.setScalar(DISPLAY_SCALE[p.crop] ?? 1.2);
        plot.group.add(v.group);
        views.set(p.id, v);
        v.newborn = live;
        v.watered = !!p.watered; v.hadFruit = !!p.fruit; v.height = 0.5;
        this.assets.crop(p.crop).then((m) => { v.model = m; v.stage = -1; });
        v.group.position.set(p.x, SOIL_Y, p.z);
      } else this.react(slot, v, p);
      v.watered = !!p.watered; v.hadFruit = !!p.fruit; v.at = { x: p.x, z: p.z };
      v.plant = p;
      v.group.position.set(p.x, SOIL_Y, p.z);
      v.fruitKey = ''; // re-evaluate fruit
    }
    this.syncEffects(slot, garden);
  }

  syncEffects(slot, garden) {
    const plot = this.world.plots[slot];
    let g = this.effects.get(slot);
    if (!g) { g = new THREE.Group(); plot.group.add(g); this.effects.set(slot, g); }
    g.clear();
    const now = this.store.now();
    for (const e of garden.effects) {
      if (!GADGETS[e.kind]?.place || e.to < now) continue;
      const def = GADGETS[e.kind];
      const ring = new THREE.Mesh(new THREE.RingGeometry(def.radius - 0.06, def.radius, 48), new THREE.MeshBasicMaterial({ color: e.kind === 'rocketSprinkler' ? '#D93A3A' : '#3FA9E0', transparent: true, opacity: 0.55 }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(e.x, 0.08, e.z);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.5, 10), this.assets.mats.metal);
      body.position.set(e.x, 0.3, e.z);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshStandardMaterial({ color: e.kind === 'rocketSprinkler' ? '#D93A3A' : '#3FA9E0', roughness: 0.4 }));
      head.position.set(e.x, 0.6, e.z);
      head.userData.spin = true;
      g.add(ring, body, head);
    }
  }

  /** Per frame: stage, LOD and fruit for every plant. */
  update(dt, cameraPos) {
    const now = this.store.now();
    const seed = this.store.seed;
    for (const [slot, views] of this.slots) {
      const gs = this.store.gardenState(slot);
      if (!gs) continue;
      for (const v of views.values()) {
        if (!v.model) continue;
        const p = v.plant;
        const prog = p.fruit ? 1 : progressAt(gs, p, now, seed);
        // a regrowing crop keeps its full-grown plant after harvest: only new fruit grows on it
        const regrowing = p.cycle > 0 && !!CROP[p.crop].regrow;
        const stage = regrowing ? 4 : Math.min(4, Math.max(0, stageOf(prog) || 0)); // never crash on odd data
        v.group.getWorldPosition(this.tmp);
        const lod = this.tmp.distanceTo(cameraPos) > LOD_FAR ? 1 : 0;
        if (stage !== v.stage || lod !== v.lod) {
          if (v.mesh) v.group.remove(v.mesh);
          v.mesh = (lod ? v.model.l1 : v.model.stages)[stage].clone();
          v.group.add(v.mesh);
          v.group.updateWorldMatrix(true, true); // so the measured height includes the display size
          v.height = new THREE.Box3().setFromObject(v.mesh).getSize(this.tmp).y + SOIL_Y; // for the name label
          v.stage = stage;
          v.lod = lod;
          v.fruitKey = '';
          if (v.newborn) { v.newborn = false; this.sprout(v); }
          else if (v.shown != null && stage > v.shown) { // it grew a stage
            v.anim = { t: 0, dur: 0.75, amp: 0.3 };
            this.world.fx.burst(this.spot(v, v.height * 0.5), { n: 16, colors: PALETTE.leaf, up: 2.2 });
            this.world.fx.ring(this.spot(v), { radius: 0.9, color: '#8BD65A' });
          }
          v.shown = stage;
        }
        // grow smoothly inside a stage and pop a little when a stage changes
        const inStage = stage >= 4 || regrowing ? 1 : (prog * 4) % 1;
        const base = stage <= 1 ? 1 : 0.86 + inStage * 0.14;
        // squash and stretch, springing up after planting, hopping when moved, and a breeze all the time
        let grow = 1, squash = 0, lift = 0;
        if (v.birth != null) {
          v.birth += dt;
          grow = v.birth < 0 ? 0.001 : Math.max(0.001, ease.back(Math.min(1, v.birth / 0.65)));
          if (v.birth >= 0.65) v.birth = null;
        }
        if (v.anim) {
          v.anim.t += dt;
          if (v.anim.t >= v.anim.dur) v.anim = null; else if (v.anim.t > 0) squash = ease.wobble(v.anim.t / v.anim.dur, 2.5) * v.anim.amp;
        }
        if (v.hop != null) {
          v.hop += dt;
          lift = Math.sin(Math.min(1, v.hop / 0.5) * Math.PI) * 0.7;
          if (v.hop >= 0.5) { v.hop = null; v.anim = { t: 0, dur: 0.5, amp: 0.22 }; }
        }
        const wide = base * grow * (1 - squash * 0.65), tall = base * grow * (1 + squash);
        v.mesh.scale.set(wide, tall, wide);
        v.group.position.y = SOIL_Y + lift;
        const sway = now / 620 + (hashId(v.id) % 97);
        v.group.rotation.z = Math.sin(sway) * 0.028;
        v.group.rotation.x = Math.cos(sway * 0.8) * 0.018;
        // fruit
        const ripe = p.fruit ? Math.max(0, ripenessAt(p, now)) : -1;
        // developing fruit on a regrowing plant: small and green, swelling and colouring as it grows
        const dev = !p.fruit && regrowing && now < p.readyAt ? Math.round(prog * 12) / 12 : null;
        const key = p.fruit ? `${ripe}|${JSON.stringify(p.fruit)}|${lod}` : dev != null ? `dev|${dev}|${lod}` : '';
        if (key !== v.fruitKey) { this.placeFruit(v, ripe, dev); v.fruitKey = key; }
        if (v.fruitGroup) {
          if (v.fruitPop != null) { v.fruitPop += dt; if (v.fruitPop >= 0.7) v.fruitPop = null; }
          const popped = v.fruitPop != null ? Math.max(0.001, ease.back(Math.min(1, v.fruitPop / 0.7))) : 1;
          v.fruitGroup.scale.set((1 - squash * 0.65) * grow, (1 + squash) * grow, (1 - squash * 0.65) * grow);
          v.fruitGroup.children.forEach((f, i) => {
            f.userData.size ??= f.scale.x;
            // ripe fruit bobs and pulses, asking to be picked
            f.scale.setScalar(f.userData.size * popped * (p.fruit ? 1 + Math.max(0, Math.sin(now / 260 + i * 1.7)) * 0.07 : 1));
            f.rotation.z = Math.sin(now / 420 + i) * (p.fruit ? 0.14 : 0.06);
          });
          if (p.fruit && !lod && Math.random() < dt * 0.35) this.world.fx.float('star', this.spot(v, v.height * (0.4 + Math.random() * 0.6)), { size: 0.2, rise: 0.35, life: 0.9, spread: 0.7 });
        }
      }
    }
    for (const g of this.effects.values()) g.children.forEach((o) => {
      if (!o.userData.spin) return;
      o.rotation.y += dt * 6;
      if (Math.random() < dt * 5) this.world.fx.burst(o.getWorldPosition(this.tmp), { n: 3, colors: PALETTE.water, up: 1.6, speed: 2.2, size: 0.06, life: 0.7 });
    });
  }

  placeFruit(v, ripe, dev = null) {
    if (v.fruitGroup) { v.group.remove(v.fruitGroup); v.fruitGroup = null; }
    const p = v.plant;
    if (!v.model.anchors.length) return;
    if (!p.fruit && dev != null) {
      const fg = new THREE.Group();
      const unripe = Math.round((1 - dev) * 4) / 4;
      const grow = 0.22 + 0.78 * Math.pow(dev, 0.8);
      for (let i = 0; i < CROP[p.crop].fruits; i++) {
        const a = v.model.anchors[i % v.model.anchors.length];
        const fr = v.model.fruit.clone();
        fr.traverse((o) => { if (o.isMesh && /fruit|petal|glow/.test(o.material.name)) o.material = fruitMaterial(o.material, { unripe }); });
        fr.position.copy(a.pos);
        if (!a.hang) fr.position.y += v.model.fruitH * grow;
        fr.scale.setScalar(grow);
        fg.add(fr);
      }
      v.fruitGroup = fg;
      v.group.add(fg);
      return;
    }
    if (!p.fruit) return;
    const fg = new THREE.Group();
    const scale = 1 + ripe * 0.05;
    p.fruit.forEach((f, i) => {
      const a = v.model.anchors[i % v.model.anchors.length];
      const fr = v.model.fruit.clone();
      fr.traverse((o) => { if (o.isMesh && /fruit/.test(o.material.name)) o.material = fruitMaterial(o.material, { v: f.v, e: f.e ?? [], ripe }); });
      fr.position.copy(a.pos);
      if (!a.hang) fr.position.y += v.model.fruitH;
      fr.scale.setScalar(scale * (f.b ? 1.6 : 1));
      fg.add(fr);
    });
    v.fruitGroup = fg;
    v.group.add(fg);
  }

  /** Plant views for picking. */
  pickables() {
    const out = [];
    for (const views of this.slots.values()) for (const v of views.values()) if (v.mesh) out.push(v.group);
    return out;
  }
  view(slot, id) { return this.slots.get(slot)?.get(id) ?? null; }
}

function hashId(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }
export { CROP };
