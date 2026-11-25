// Lamp posts switch on at night: a glowing bulb and halo on every lamp, plus a small pool of real point
// lights that follow the lamps nearest to the camera (so dozens of lamps cost the same as a few).
import * as THREE from 'three';

const BULB_Y = 2.6;
const POOL = 8;

function haloTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,236,170,1)');
  grad.addColorStop(0.35, 'rgba(255,210,120,0.45)');
  grad.addColorStop(1, 'rgba(255,190,90,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Lamps {
  constructor(scene) {
    this.scene = scene;
    this.lamps = []; // {obj, bulb, halo}
    this.bulbMat = new THREE.MeshBasicMaterial({ color: '#fff3c4' });
    this.bulbGeo = new THREE.SphereGeometry(0.11, 12, 8);
    this.haloMat = new THREE.SpriteMaterial({ map: haloTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    this.lights = Array.from({ length: POOL }, () => {
      const l = new THREE.PointLight('#ffcf80', 0, 11, 1.6);
      l.castShadow = false;
      scene.add(l);
      return l;
    });
    this.on = 0;
    this.v = new THREE.Vector3();
  }

  /** Register a lamp post (its origin at the foot of the post). Works for plaza lamps and garden decor. */
  add(obj) {
    if (this.lamps.some((l) => l.obj === obj)) return;
    const bulb = new THREE.Mesh(this.bulbGeo, this.bulbMat);
    bulb.position.y = BULB_Y;
    const halo = new THREE.Sprite(this.haloMat);
    halo.position.y = BULB_Y;
    halo.scale.setScalar(1.6);
    obj.add(bulb, halo);
    this.lamps.push({ obj, bulb, halo });
  }
  remove(obj) { this.lamps = this.lamps.filter((l) => l.obj !== obj); }

  /** night: 0 (day) .. 1 (full night). */
  update(dt, night, camPos) {
    this.on += (night - this.on) * Math.min(1, dt * 1.5);
    const on = this.on;
    this.haloMat.opacity = on * 0.9;
    this.bulbMat.color.setRGB(1, 0.95, 0.77).multiplyScalar(0.55 + on * 0.6);
    for (const l of this.lamps) { l.bulb.visible = true; l.halo.visible = on > 0.03; }
    // the nearest lamps get real light
    if (on < 0.03) { for (const l of this.lights) l.intensity = 0; return; }
    const near = this.lamps
      .filter((l) => l.obj.parent)
      .map((l) => { l.obj.getWorldPosition(this.v); return { l, x: this.v.x, z: this.v.z, d: (this.v.x - camPos.x) ** 2 + (this.v.z - camPos.z) ** 2 }; })
      .sort((a, b) => a.d - b.d)
      .slice(0, POOL);
    this.lights.forEach((light, i) => {
      const n = near[i];
      if (!n) { light.intensity = 0; return; }
      light.position.set(n.x, BULB_Y - 0.2, n.z);
      light.intensity = on * 14;
    });
  }
}
