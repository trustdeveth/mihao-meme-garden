// Homes, decorations, egg nests, surprises, the plaza balloon and notice board, Sky Island and acorns.
import * as THREE from 'three';
import { HOMES, HOME_SPOT, NEST_SPOT, DECOR, EGGS, ISLAND } from '@mg/shared/data/features';
import { makeBoard } from '../scene/world.js';
import { PALETTE, ease } from '../fx/world-fx.js';
import { BALLOON, BOARD, HOMES_AT } from '@mg/shared/world/village-layout';
import { acornSpots } from '@mg/shared/rules/progress';
import { dayKey } from '@mg/shared/rules/state';

export class EstateRenderer {
  constructor(world, assets, store) {
    this.world = world;
    this.assets = assets;
    this.store = store;
    this.slots = new Map(); // slot -> {home, homeTier, decor: Map, eggs: Group}
    this.surprise = null;
    this.live = new Set(); // gardens already drawn once: only later changes are animated
    this.acorns = new THREE.Group();
    this.acornKey = '';
    world.scene.add(this.acorns);
    store.on('reset', () => { this.live.clear(); for (const s of this.store.gardens.keys()) this.sync(s); for (let i = 0; i < 12; i++) if (!this.store.gardens.has(i)) this.sync(i); });
    store.on('garden', (slot) => this.sync(slot));
  }

  async init() {
    const put = async (id, x, z, ry = 0, y = 0) => { const o = (await this.assets.prop(id)).scene.clone(); o.position.set(x, y, z); o.rotation.y = ry; this.world.scene.add(o); return o; };
    this.balloon = await put('balloon', BALLOON.x, BALLOON.z, 0.6);
    await put('board', BOARD.x, BOARD.z, Math.atan2(-BOARD.x, -BOARD.z));
    this.island = await put('island', ISLAND.center.x, ISLAND.center.z);
    this.islandBalloon = await put('balloon', ISLAND.center.x + 4, ISLAND.center.z + ISLAND.radius - 7, 0.6);
    this.islandOwl = await put('ufo', ISLAND.center.x, ISLAND.center.z, 0, 0.0);
    this.islandOwl.visible = false;
    this.acornProto = (await this.assets.prop('acorn')).scene;
    for (const id of ['crow', 'gnome', 'ufo', 'nest']) await this.assets.prop(id);
  }

  /** A thing arrives from above and lands with a bounce and dust. */
  dropIn(obj, plot) {
    const fx = this.world.fx;
    const y = obj.position.y, s = obj.scale.clone();
    const spot = () => plot.group.localToWorld(obj.position.clone().setY(0.15));
    if (!fx.visible(spot())) return;
    fx.tween(0.6, (k) => {
      const fall = k < 0.5 ? ease.in(k / 0.5) : 1;
      const squash = k > 0.5 ? ease.wobble((k - 0.5) / 0.5, 1.5) * -0.28 : 0.12 * fall;
      obj.position.y = y + (1 - fall) * 3;
      obj.scale.set(s.x * (1 - squash * 0.6), s.y * (1 + squash), s.z * (1 - squash * 0.6));
    }, () => { obj.position.y = y; obj.scale.copy(s); });
    fx.tween(0.01, () => {}, () => { fx.burst(spot(), { n: 18, colors: PALETTE.dirt, speed: 1.8 }); fx.ring(spot(), { radius: 1.2, color: '#FFF4DC' }); }, 0.3);
  }

  /** A new home pushes up out of the ground. */
  rise(obj, plot) {
    const fx = this.world.fx;
    const spot = plot.group.localToWorld(obj.position.clone());
    if (!fx.visible(spot)) return;
    const s = obj.scale.clone();
    fx.beam(spot, { height: 10, radius: 4, life: 2 });
    for (let i = 0; i < 4; i++) fx.tween(0.01, () => {}, () => fx.burst(spot.clone().setY(0.3), { n: 45, colors: [...PALETTE.dirt, ...PALETTE.party], spread: 6, speed: 3.5, up: 5 }), i * 0.3);
    fx.tween(1.4, (k) => { const up = Math.max(0.001, ease.back(k)); const wide = 1 + ease.wobble(k, 2) * 0.08; obj.scale.set(s.x * wide, s.y * up, s.z * wide); }, () => { obj.scale.copy(s); fx.float('star', spot.clone().setY(4), { n: 10, spread: 5, size: 0.6 }); fx.float('mihao', spot.clone().setY(5), { size: 1.6 }); });
  }

  /** The Sky Balloon bobs, turns to watch you, swings its moustache and puffs its burner. */
  flyBalloon(b, t, dt) {
    const cam = this.world.camera.position;
    const toYou = Math.atan2(cam.x - b.position.x, cam.z - b.position.z);
    const turn = Math.atan2(Math.sin(toYou - b.rotation.y), Math.cos(toYou - b.rotation.y));
    b.rotation.y += turn * Math.min(1, dt * 0.9);
    b.position.y = 0.22 + Math.sin(t * 0.9) * 0.2;
    b.rotation.z = Math.sin(t * 0.63) * 0.035;
    b.rotation.x = Math.sin(t * 0.47) * 0.018;
    const parts = (b.userData.parts ??= { flame: b.getObjectByName('balloon_flame'), hair: b.getObjectByName('balloon_hair') });
    // the burner roars for a moment every few seconds
    const roar = Math.max(0, Math.sin(t * 1.25)) ** 6;
    if (parts.flame) { const k = 0.75 + roar * 0.85 + Math.sin(t * 23) * 0.09 + Math.sin(t * 37) * 0.05; parts.flame.scale.set(0.85 + roar * 0.3, k, 0.85 + roar * 0.3); }
    if (parts.hair) { parts.hair.userData.rest ??= parts.hair.rotation.clone(); parts.hair.rotation.x = -0.035 - Math.sin(t * 1.7) * 0.035; parts.hair.rotation.z = Math.sin(t * 1.1) * 0.03; }
    const fx = this.world.fx;
    if (roar > 0.6 && Math.random() < dt * 9) fx.burst(b.localToWorld(new THREE.Vector3(0, 2.85, 0)), { n: 3, colors: ['#FFD24A', '#FF8A1E', '#FFF1A8'], up: 1.4, speed: 0.5, size: 0.07, life: 0.55, gravity: 1 });
    if (Math.random() < dt * 0.22) fx.float(Math.random() < 0.6 ? 'mihao' : 'star', b.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, 4 + Math.random() * 3, (Math.random() - 0.5) * 4)), { size: 0.55, rise: 0.5, spread: 0.2, life: 1.6 });
  }

  async sync(slot) {
    const plot = this.world.plots[slot];
    if (!plot) return;
    const g = this.store.gardens.get(slot);
    let e = this.slots.get(slot);
    if (!e) { e = { home: null, homeTier: 0, decor: new Map(), eggs: new THREE.Group(), marker: null }; plot.group.add(e.eggs); this.slots.set(slot, e); }
    // home (also solid for walking)
    const tier = g?.home ?? 0;
    if (tier) HOMES_AT.set(slot, tier); else HOMES_AT.delete(slot);
    const live = this.live.has(slot);
    if (g) this.live.add(slot); else this.live.delete(slot);
    const upgraded = live && tier > e.homeTier;
    if (tier !== e.homeTier) {
      if (e.home) plot.group.remove(e.home);
      e.home = null;
      e.homeTier = tier;
      if (tier) {
        const m = (await this.assets.prop(`home_${HOMES[tier - 1].id}`)).scene.clone();
        m.position.set(HOME_SPOT.x, 0, HOME_SPOT.z);
        plot.group.add(m);
        e.home = m;
        if (upgraded) this.rise(m, plot);
      }
    }
    // before you build, a sign and a dashed outline show where your home will stand
    const showMarker = !tier && slot === this.store.you?.slot;
    if (showMarker && !e.marker) e.marker = this.homeMarker(plot);
    if (e.marker) e.marker.visible = showMarker;
    // decorations
    const want = new Map((g?.decor ?? []).map((d) => [d.id, d]));
    for (const [id, o] of e.decor) if (!want.has(id)) {
      if (live) this.world.fx.burst(plot.group.localToWorld(o.position.clone().setY(0.6)), { n: 22, colors: PALETTE.white, size: 0.1 });
      plot.group.remove(o); e.decor.delete(id); this.world.lamps.remove(o);
    }
    for (const d of want.values()) {
      let o = e.decor.get(d.id);
      if (!o) {
        const def = DECOR[d.kind];
        if (!def) continue;
        o = (await this.assets.prop(def.model)).scene.clone();
        o.scale.setScalar(def.scale ?? 1);
        o.userData = { kind: 'decor', slot, id: d.id };
        plot.group.add(o);
        e.decor.set(d.id, o);
        if (def.model === 'lamp') this.world.lamps.add(o);
        o.userData.fresh = live;
      }
      const moved = o.userData.placed && (Math.hypot(o.position.x - d.x, o.position.z - d.z) > 0.05 || o.userData.rot !== (d.rot ?? 0));
      o.position.set(d.x, 0, d.z);
      o.rotation.y = (d.rot ?? 0) * (Math.PI / 4);
      if (o.userData.fresh || moved) this.dropIn(o, plot);
      o.userData.fresh = false; o.userData.placed = true; o.userData.rot = d.rot ?? 0;
    }
    // eggs in their nests next to the home
    const eggId = (egg, i) => egg.id ?? `${egg.kind}${i}`;
    const ids = new Set((g?.eggs ?? []).map(eggId));
    const had = e.eggIds ?? new Map();
    if (live) for (const [id, pos] of had) if (!ids.has(id)) { // hatched: the shell flies apart
      const spot = plot.group.localToWorld(pos.clone());
      this.world.fx.burst(spot, { n: 40, colors: PALETTE.shell, up: 3.5, speed: 2.6, size: 0.11 });
      this.world.fx.beam(spot, { height: 3.5, radius: 0.6 });
      this.world.fx.float('heart', spot.clone().setY(1.2), { n: 7, spread: 1 });
    }
    e.eggIds = new Map();
    e.eggs.clear();
    (g?.eggs ?? []).forEach((egg, i) => {
      const nest = this.assets.models.get(this.assets.manifest.props.nest.file);
      const x = NEST_SPOT.x + i * NEST_SPOT.step, z = NEST_SPOT.z;
      nest?.then((n) => { const o = n.scene.clone(); o.position.set(x, 0, z); e.eggs.add(o); });
      const eggMesh = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 14), new THREE.MeshPhysicalMaterial({ color: EGGS[egg.kind].color, roughness: 0.35, clearcoat: 0.6 }));
      eggMesh.scale.set(1, 1.3, 1);
      eggMesh.position.set(x, 0.3, z);
      eggMesh.castShadow = true;
      eggMesh.userData.ready = egg.ready;
      e.eggs.add(eggMesh);
      e.eggIds.set(eggId(egg, i), eggMesh.position.clone());
      if (live && !had.has(eggId(egg, i))) this.dropIn(eggMesh, plot);
    });
  }

  homeMarker(plot) {
    const g = new THREE.Group();
    const w = 7.6, d = 6.6;
    const pts = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [-w / 2, -d / 2]].map(([x, z]) => new THREE.Vector3(x, 0.06, z));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: '#FFF4DC', dashSize: 0.5, gapSize: 0.3 }));
    line.computeLineDistances();
    g.add(line);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 1.6, 8), new THREE.MeshStandardMaterial({ color: '#7a5434', roughness: 0.9 }));
    post.position.set(0, 0.8, d / 2 + 0.2);
    post.castShadow = true;
    g.add(post);
    const board = makeBoard(1.5, 0.68);
    board.draw('Home Spot', 'Build here (E)', '#FFD84A');
    board.mesh.position.set(0, 1.75, d / 2 + 0.27);
    g.add(board.mesh);
    g.position.set(HOME_SPOT.x, 0, HOME_SPOT.z);
    plot.group.add(g);
    return g;
  }

  /** Decor meshes for picking. */
  pickables() { const out = []; for (const e of this.slots.values()) for (const o of e.decor.values()) out.push(o); return out; }

  update(dt) {
    const now = this.store.now();
    const t = now / 1000;
    for (const b of [this.balloon, this.islandBalloon]) if (b) this.flyBalloon(b, t, dt);
    for (const e of this.slots.values()) e.eggs.children.forEach((o) => { if (o.userData.ready) { const ready = now >= o.userData.ready; o.rotation.z = Math.sin(t * (ready ? 9 : 2)) * (ready ? 0.25 : 0.05); } });
    // surprise visitor in my garden
    const me = this.store.me, slot = this.store.you?.slot;
    const s = me?.surprise && me.surprise.until > now ? me.surprise : null;
    const key = s ? `${s.kind}|${s.x}|${s.z}` : '';
    if (key !== this.surpriseKey) {
      if (this.surprise) {
        this.world.fx.burst(this.surprise.getWorldPosition(new THREE.Vector3()).setY(0.8), { n: 34, colors: PALETTE.party, up: 3.5 });
        this.surprise.parent?.remove(this.surprise);
      }
      this.surprise = null;
      this.surpriseKey = key;
      if (s) {
        const model = this.assets.models.get(this.assets.manifest.props[s.kind === 'alien' ? 'ufo' : s.kind].file);
        model?.then((m) => {
          if (this.surpriseKey !== key) return;
          this.surprise = m.scene.clone();
          this.surprise.position.set(s.x, s.kind === 'alien' ? 1.4 : 0, s.z);
          this.surprise.scale.setScalar(s.kind === 'crow' ? 1.6 : 1.2);
          this.world.plots[slot].group.add(this.surprise);
        });
      }
    }
    if (this.surprise) { this.surprise.position.y = (s?.kind === 'alien' ? 1.4 : 0.05) + Math.abs(Math.sin(t * 3)) * 0.25; this.surprise.rotation.y += dt * (s?.kind === 'alien' ? 1.5 : 0.6); }
    // today's acorns on Sky Island
    if (me?.island?.unlocked && this.acornProto) {
      const day = dayKey(now);
      const k = `${day}|${(me.island.day === day ? me.island.picked : []).join(',')}`;
      if (k !== this.acornKey) {
        this.acornKey = k;
        this.acorns.clear();
        acornSpots(me, day, this.store.seed).forEach((p, i) => {
          if (me.island.day === day && me.island.picked.includes(i)) return;
          const o = this.acornProto.clone();
          o.position.set(ISLAND.center.x + p.x, 0.1, ISLAND.center.z + p.z);
          o.scale.setScalar(2.2);
          o.userData.i = i;
          this.acorns.add(o);
        });
      }
      this.acorns.children.forEach((o, i) => { o.rotation.y += dt * 1.2; o.position.y = 0.25 + Math.sin(t * 2 + i) * 0.12; });
    }
  }
}
