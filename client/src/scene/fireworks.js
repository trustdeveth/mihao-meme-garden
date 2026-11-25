// Community touches on the plaza: the fountain's name plaque (bought with $MGRD) and fireworks while the
// village's weekly Fireworks Pot is full.
import * as THREE from 'three';
import { makeBoard } from './world.js';

const COLORS = ['#ff5a5a', '#ffd84a', '#5fe0ff', '#7ddc5a', '#ff8fc8', '#b07aff', '#ffffff'];

export class PlazaExtras {
  constructor(world) {
    this.world = world;
    this.on = false;
    this.bursts = [];
    this.next = 0;
    // name plaque on a post in front of the fountain
    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.9, 8), new THREE.MeshStandardMaterial({ color: '#7a5434', roughness: 0.9 }));
    post.position.y = 0.95;
    post.castShadow = true;
    this.board = makeBoard(1.9, 0.8);
    this.board.mesh.position.set(0, 1.95, 0.1);
    g.add(post, this.board.mesh);
    g.position.set(0, 0, 4.4);
    world.scene.add(g);
    this.setPlaque(null);
  }

  setPlaque(p) {
    if (p) this.board.draw(p.text, `named by ${p.by}`, '#FFD84A');
    else this.board.draw('Village Fountain', 'Name it with $MGRD!', '#9DD3FF');
  }

  burst() {
    const n = 70;
    const pos = new Float32Array(n * 3), vel = [];
    const c = new THREE.Color(COLORS[Math.floor(Math.random() * COLORS.length)]);
    const o = new THREE.Vector3((Math.random() - 0.5) * 24, 20 + Math.random() * 8, (Math.random() - 0.5) * 24);
    for (let i = 0; i < n; i++) {
      pos.set([o.x, o.y, o.z], i * 3);
      const v = new THREE.Vector3().randomDirection().multiplyScalar(7 + Math.random() * 3);
      vel.push(v);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: c, size: 0.55, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const pts = new THREE.Points(geo, mat);
    this.world.scene.add(pts);
    this.bursts.push({ pts, vel, life: 1.8 });
  }

  update(dt) {
    if (this.on) {
      this.next -= dt;
      if (this.next <= 0) { this.burst(); if (Math.random() < 0.4) this.burst(); this.next = 0.7 + Math.random() * 1.1; }
    }
    this.bursts = this.bursts.filter((b) => {
      b.life -= dt;
      const p = b.pts.geometry.attributes.position;
      for (let i = 0; i < b.vel.length; i++) {
        const v = b.vel[i];
        v.y -= 6 * dt; v.multiplyScalar(1 - dt * 1.2);
        p.setXYZ(i, p.getX(i) + v.x * dt, p.getY(i) + v.y * dt, p.getZ(i) + v.z * dt);
      }
      p.needsUpdate = true;
      b.pts.material.opacity = Math.max(0, b.life / 1.8);
      if (b.life > 0) return true;
      this.world.scene.remove(b.pts); b.pts.geometry.dispose(); b.pts.material.dispose();
      return false;
    });
  }
}
