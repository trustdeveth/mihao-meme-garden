// In-world effects: blocky particles, picture sprites, shock rings, flying objects and small tweens.
// Purely visual. Everything here is pooled or removed when it finishes, so effects never pile up.
import * as THREE from 'three';

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export const ease = {
  out: (t) => 1 - (1 - t) ** 3,
  in: (t) => t * t,
  /** overshoots past 1 and settles: the bouncy Roblox pop */
  back: (t) => 1 + 2.9 * (t - 1) ** 3 + 1.9 * (t - 1) ** 2,
  /** a wobble that dies away, from 0 to 0 */
  wobble: (t, n = 3) => Math.sin(t * Math.PI * 2 * n) * (1 - t) ** 2,
};

export const PALETTE = {
  dirt: ['#8A5A32', '#A9744A', '#6E4526'],
  leaf: ['#5DBB46', '#8BD65A', '#3C9438'],
  water: ['#5FB8FF', '#9BD8FF', '#2E8BE0'],
  gold: ['#FFD84A', '#FFC233', '#FFF1A8'],
  party: ['#E4333B', '#FFD84A', '#5DBB46', '#2F80ED', '#FF7AB6', '#FFFFFF'],
  white: ['#FFFFFF', '#F1ECE0'],
  shell: ['#FFF4DC', '#FFE3A8'],
};

const MAX_BITS = 700; // blocky particles alive at once
const MAX_SPRITES = 90;
const FAR = 55; // effects further than this from the camera are skipped

/** Pictures drawn once on a canvas and reused by every sprite. */
const pictures = new Map();
function picture(kind) {
  if (pictures.has(kind)) return pictures.get(kind);
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.lineJoin = 'round';
  g.lineWidth = 10;
  g.strokeStyle = '#2B1A0E';
  const fill = (color) => { g.fillStyle = color; g.stroke(); g.fill(); };
  g.beginPath();
  if (kind === 'heart') {
    g.moveTo(64, 108); g.bezierCurveTo(10, 72, 12, 24, 42, 24); g.bezierCurveTo(56, 24, 64, 36, 64, 44);
    g.bezierCurveTo(64, 36, 72, 24, 86, 24); g.bezierCurveTo(116, 24, 118, 72, 64, 108);
    fill('#FF5C7A');
  } else if (kind === 'star') {
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 - Math.PI / 2, r = i % 2 ? 18 : 56; g[i ? 'lineTo' : 'moveTo'](64 + Math.cos(a) * r, 64 + Math.sin(a) * r); }
    g.closePath(); fill('#FFF1A8');
  } else if (kind === 'coin') {
    g.arc(64, 64, 48, 0, Math.PI * 2); fill('#FFC233');
    g.beginPath(); g.rect(50, 50, 28, 28); fill('#B9852A');
  } else if (kind === 'drop') {
    g.moveTo(64, 14); g.bezierCurveTo(92, 56, 104, 74, 104, 86); g.arc(64, 86, 40, 0, Math.PI); g.bezierCurveTo(24, 74, 36, 56, 64, 14);
    fill('#5FB8FF');
  } else {
    // short words such as "mihao" or "z"
    g.font = `900 ${kind.length > 3 ? 40 : 92}px Impact, "Arial Black", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 12; g.strokeText(kind, 64, 68);
    g.fillStyle = '#FFFFFF'; g.fillText(kind, 64, 68);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  pictures.set(kind, t);
  return t;
}

export class WorldFx {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.bits = [];
    this.sprites = [];
    this.tweens = new Set();
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ toneMapped: false }), MAX_BITS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.raycast = () => {}; // never gets in the way of clicking
    scene.add(this.mesh);
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.s = new THREE.Vector3(); this.c = new THREE.Color();
  }

  visible(pos) { return !reducedMotion() && pos.distanceTo(this.camera.position) < FAR; }

  /** A spray of little blocks. */
  burst(pos, { n = 14, colors = PALETTE.party, speed = 1.6, up = 2.4, gravity = 7, size = 0.075, life = 0.8, spread = 0.15 } = {}) {
    if (!this.visible(pos)) return;
    for (let i = 0; i < n && this.bits.length < MAX_BITS; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.35 + Math.random() * 0.65);
      this.bits.push({
        x: pos.x + (Math.random() - 0.5) * spread, y: pos.y + Math.random() * spread, z: pos.z + (Math.random() - 0.5) * spread,
        vx: Math.cos(a) * v, vy: up * (0.4 + Math.random() * 0.8), vz: Math.sin(a) * v,
        r: Math.random() * 6, vr: (Math.random() - 0.5) * 14, g: gravity, size: size * (0.6 + Math.random() * 0.8), t: 0, life: life * (0.7 + Math.random() * 0.6),
        color: colors[(Math.random() * colors.length) | 0],
      });
    }
  }

  /** Falling water from above onto a spot. */
  rain(pos, { n = 26, height = 1.5, radius = 0.4 } = {}) {
    if (!this.visible(pos)) return;
    for (let i = 0; i < n && this.bits.length < MAX_BITS; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * radius;
      this.bits.push({ x: pos.x + Math.cos(a) * r, y: pos.y + height + Math.random() * 0.6, z: pos.z + Math.sin(a) * r, vx: 0, vy: -1.2 - Math.random(), vz: 0, r: 0, vr: 0, g: 6, size: 0.05, tall: 2.6, t: -Math.random() * 0.35, life: 0.55, color: PALETTE.water[i % 3] });
    }
  }

  /** Floating pictures: hearts, stars, coins, words. */
  float(kind, pos, { n = 1, rise = 1, life = 1.1, size = 0.34, spread = 0.35, delay = 0.08 } = {}) {
    if (!this.visible(pos)) return;
    for (let i = 0; i < n && this.sprites.length < MAX_SPRITES; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: picture(kind), transparent: true, depthWrite: false, toneMapped: false }));
      s.position.set(pos.x + (Math.random() - 0.5) * spread, pos.y + Math.random() * spread * 0.5, pos.z + (Math.random() - 0.5) * spread);
      s.scale.setScalar(0.001);
      s.raycast = () => {};
      this.scene.add(s);
      this.sprites.push({ s, t: -i * delay, life, rise, size, sway: Math.random() * 6 });
    }
  }

  /** A flat ring spreading over the ground. */
  ring(pos, { color = '#FFF1A8', radius = 1.2, life = 0.55, y = 0.1 } = {}) {
    if (!this.visible(pos)) return;
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
    const m = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 32), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(pos.x, y, pos.z);
    m.raycast = () => {};
    this.scene.add(m);
    this.tween(life, (k) => { const s = 0.15 + ease.out(k) * radius; m.scale.set(s, s, s); mat.opacity = 1 - k; }, () => { this.scene.remove(m); m.geometry.dispose(); mat.dispose(); });
  }

  /** A column of light for big moments. */
  beam(pos, { color = '#FFE27A', life = 1.4, height = 5, radius = 0.7 } = {}) {
    if (!this.visible(pos)) return;
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const m = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.7, radius, height, 20, 1, true), mat);
    m.position.set(pos.x, height / 2, pos.z);
    m.raycast = () => {};
    this.scene.add(m);
    this.tween(life, (k) => { mat.opacity = Math.sin(k * Math.PI) * 0.45; m.rotation.y = k * 3; m.scale.set(1 - k * 0.4, 1, 1 - k * 0.4); }, () => { this.scene.remove(m); m.geometry.dispose(); mat.dispose(); });
  }

  /** Move a copy of an object along an arc to a moving target, shrinking at the end. */
  fly(obj, from, target, { life = 0.65, arc = 1.4, delay = 0, onDone } = {}) {
    if (!this.visible(from)) return;
    const start = from.clone();
    const base = obj.scale.clone();
    obj.position.copy(start);
    obj.traverse((o) => { o.raycast = () => {}; });
    this.scene.add(obj);
    const end = new THREE.Vector3();
    this.tween(life, (k) => {
      end.copy(target());
      obj.position.lerpVectors(start, end, ease.in(k));
      obj.position.y += Math.sin(k * Math.PI) * arc;
      obj.rotation.y += 0.25; obj.rotation.x += 0.12;
      obj.scale.copy(base).multiplyScalar(k < 0.75 ? 1 + Math.sin((k / 0.75) * Math.PI) * 0.25 : 1 - (k - 0.75) * 3.2);
    }, () => { this.scene.remove(obj); onDone?.(end); }, delay);
  }

  /** Call fn(0..1) every frame for `life` seconds. Returns the tween so it can be cancelled. */
  tween(life, fn, done, delay = 0) {
    const tw = { t: -delay, life, fn, done };
    this.tweens.add(tw);
    return tw;
  }

  update(dt) {
    for (const tw of this.tweens) {
      tw.t += dt;
      if (tw.t < 0) continue;
      const k = Math.min(1, tw.t / tw.life);
      tw.fn(k);
      if (k >= 1) { this.tweens.delete(tw); tw.done?.(); }
    }
    let n = 0;
    this.bits = this.bits.filter((b) => {
      b.t += dt;
      if (b.t < 0) return true;
      if (b.t >= b.life) return false;
      b.vy -= b.g * dt;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; b.r += b.vr * dt;
      if (b.y < 0.03) { b.y = 0.03; b.vy *= -0.3; b.vx *= 0.7; b.vz *= 0.7; }
      const size = b.size * (b.t > b.life * 0.7 ? 1 - (b.t - b.life * 0.7) / (b.life * 0.3) : 1);
      this.q.setFromEuler(this.e.set(b.r, b.r * 0.7, 0));
      this.m.compose(this.s.set(b.x, b.y, b.z), this.q, new THREE.Vector3(size, size * (b.tall ?? 1), size));
      this.mesh.setMatrixAt(n, this.m);
      this.mesh.setColorAt(n, this.c.set(b.color));
      n++;
      return true;
    });
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.sprites = this.sprites.filter((p) => {
      p.t += dt;
      if (p.t < 0) return true;
      const k = p.t / p.life;
      if (k >= 1) { this.scene.remove(p.s); p.s.material.dispose(); return false; }
      p.s.position.y += p.rise * dt;
      p.s.position.x += Math.sin(p.sway + p.t * 5) * dt * 0.18;
      p.s.scale.setScalar(p.size * (k < 0.25 ? ease.back(k / 0.25) : 1));
      p.s.material.opacity = k > 0.65 ? 1 - (k - 0.65) / 0.35 : 1;
      return true;
    });
  }
}
