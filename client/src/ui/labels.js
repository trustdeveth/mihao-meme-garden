// Floating labels in the world: plant names with growth timers, and big shop names over the stalls.
import * as THREE from 'three';
import { CROP } from '@mg/shared/data/crops';
import { STALLS, BALLOON, BOARD } from '@mg/shared/world/village-layout';
import { ripenessAt } from '@mg/shared/rules/ripening';
import { icon } from './hud.js';

const MAX_PLANT_LABELS = 7; // a few clear labels instead of a pile
const NEAR = 5.5; // metres from the player
const SHOPS = {
  seeds: { title: 'Seed Shop', who: 'Mo the Mihao', icon: 'seeds', cls: 'seeds' },
  market: { title: 'Market', who: 'Gus the Mihao buys crops', icon: 'sell', cls: 'market' },
  gadgets: { title: 'Gadget Shop', who: 'Tinker Tess', icon: 'shop', cls: 'gadgets' },
  pets: { title: 'Pet Shop', who: 'Penny Paws sells eggs', icon: 'paw', cls: 'pets' },
  balloon: { title: 'Sky Balloon', who: 'Captain Puff flies to Sky Island', icon: 'balloon', cls: 'balloon' },
  board: { title: 'Village Board', who: 'Orders and the weekly contract', icon: 'board', cls: 'board' },
};

const fmt = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
};

export class WorldLabels {
  constructor(world, assets) {
    this.world = world;
    this.assets = assets;
    this.layer = document.getElementById('labels');
    this.pool = [];
    this.v = new THREE.Vector3();
    this.w = new THREE.Vector3();
    const spots = [...STALLS.map((s) => ({ ...s, y: 3.6 })), { id: 'balloon', x: BALLOON.x, z: BALLOON.z, y: 9.1 }, { id: 'board', x: BOARD.x, z: BOARD.z, y: 3.4 }];
    this.stalls = spots.map((s) => {
      const el = document.createElement('div');
      const d = SHOPS[s.id];
      el.className = `stalltag ${d.cls}`;
      el.innerHTML = `${icon(d.icon)}<div><b>${d.title}</b><span>${d.who}</span></div>`;
      this.layer.appendChild(el);
      return { el, pos: new THREE.Vector3(s.x, s.y, s.z) };
    });
  }

  /**
   * Put a DOM label on a 3D point. With depth, the label behaves like a sign in the world: it shrinks with
   * distance (perspective), nearer labels draw on top of farther ones, and far ones fade out.
   */
  place(el, pos, depth = false) {
    this.v.copy(pos).project(this.world.camera);
    let vis = this.v.z < 1 && Math.abs(this.v.x) < 1.05 && Math.abs(this.v.y) < 1.05;
    const x = (this.v.x * 0.5 + 0.5) * innerWidth, y = (-this.v.y * 0.5 + 0.5) * innerHeight;
    if (vis && depth) {
      const d = this.world.camera.position.distanceTo(pos);
      const s = Math.min(1.1, Math.max(0.3, 16 / d));
      const fade = d < 55 ? 1 : Math.max(0, 1 - (d - 55) / 35);
      vis = fade > 0.02;
      el.style.opacity = fade.toFixed(2);
      el.style.zIndex = String(100 + Math.max(0, 900 - Math.round(d * 8)));
      if (vis) el.style.transform = `translate(${x}px, ${y}px) scale(${s.toFixed(3)}) translate(-50%, -100%)`;
    } else if (vis) el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    el.style.display = vis ? '' : 'none';
    return vis;
  }

  update(store, plants, playerPos) {
    for (const s of this.stalls) this.place(s.el, s.pos, true);
    // nearest plants (yours first) get a label
    const now = store.now();
    const mine = store.you?.slot;
    const list = [];
    for (const [slot, views] of plants.slots) {
      for (const v of views.values()) {
        if (!v.mesh || !v.plant) continue;
        v.group.getWorldPosition(this.w);
        const d = Math.hypot(this.w.x - playerPos.x, this.w.z - playerPos.z);
        if (d > NEAR) continue;
        list.push({ v, d: d - (slot === mine ? 3 : 0), slot, pos: this.w.clone() });
      }
    }
    // the plant under the mouse first, then ripe ones, then the nearest; skip any label that would overlap
    for (const it of list) {
      if (it.v.id === this.hover) it.d -= 100;
      const pl = it.v.plant;
      if (it.slot === mine && (pl.fruit || now >= pl.readyAt)) it.d -= 1.5;
    }
    list.sort((a, b) => a.d - b.d);
    const shown = [], boxes = [];
    for (const it of list) {
      if (shown.length >= MAX_PLANT_LABELS) break;
      const top = it.pos.clone(); top.y += (it.v.height ?? 0.5) + 0.15;
      this.v.copy(top).project(this.world.camera);
      if (this.v.z > 1) continue;
      const sx = (this.v.x * 0.5 + 0.5) * innerWidth, sy = (-this.v.y * 0.5 + 0.5) * innerHeight;
      const w = 34 + CROP[it.v.plant.crop].name.length * 7.5 + 46, h = 22;
      const box = { l: sx - w / 2, r: sx + w / 2, t: sy - h, b: sy };
      if (it.v.id !== this.hover && boxes.some((o) => box.l < o.r + 4 && box.r > o.l - 4 && box.t < o.b + 3 && box.b > o.t - 3)) continue;
      boxes.push(box);
      shown.push(it);
    }
    while (this.pool.length < shown.length) {
      const el = document.createElement('div');
      el.className = 'plabel';
      this.layer.appendChild(el);
      this.pool.push({ el, key: '' });
    }
    this.pool.forEach((p, i) => {
      const item = shown[i];
      if (!item) { p.el.style.display = 'none'; return; }
      const { v, slot } = item;
      const plant = v.plant, crop = CROP[plant.crop];
      const ready = !!plant.fruit || now >= plant.readyAt;
      let status = '', cls = '';
      if (slot === mine) {
        if (ready) { const r = Math.max(0, ripenessAt(plant, now)); status = ['Ready!', 'Juicy!', 'Peak!'][r]; cls = 'ready'; }
        else status = fmt(plant.readyAt - now);
      } else if (ready) { status = 'Ripe'; cls = 'ready'; }
      // the Magnifier shows what a ripe crop is worth; buddies get a little heart
      let val = '';
      if (slot === mine && ready && store.me?.tools?.magnifier) {
        const r = Math.max(0, ripenessAt(plant, now));
        val = `~${Math.round(crop.value * (plant.fruit?.length ?? crop.fruits) * [1, 1.15, 1.3][r]).toLocaleString('en-US')}`;
      }
      const heart = plant.buddy ? icon('like', 'i heart') : '';
      const key = `${plant.crop}|${status}|${cls}|${val}|${!!plant.buddy}`;
      if (key !== p.key) {
        p.key = key;
        p.el.className = `plabel ${cls}`;
        p.el.innerHTML = `<i class="crop" style="${this.assets.cropIconStyle(plant.crop, 16)}"></i><b>${crop.name}</b>${heart}${status ? `<span>${status}</span>` : ''}${val ? `<span class="val">${val}</span>` : ''}`;
      }
      item.pos.y += (v.height ?? 0.5) + 0.15;
      this.place(p.el, item.pos);
    });
  }
}
