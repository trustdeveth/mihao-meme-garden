// Weather visuals: everyone computes the same weather from the shared world seed.
// Only the look lives here. When weather happens and what it does stays in the shared rules.
import * as THREE from 'three';
import { weatherAt, windowIndex, windowStart, strikeTimes } from '@mg/shared/rules/weather';
import { reducedMotion } from '../fx/world-fx.js';
import { banner } from '../fx/ui-fx.js';

const RAIN = 3200, SNOW = 2200, SPLASH = 150, MOTES = 260;
const NAMES = {
  sunny: ['Sunny', 'A very mihao day.'], rain: ['Rain', 'Plants drink up. mihao.'], night: ['Starry Night', 'Quiet. Too quiet. mihao.'],
  frosty: ['Frosty', 'Chilly whiskers.'], heatwave: ['Heatwave', 'Even the beard is sweating.'], storm: ['Beard Storm', 'Hold on to your moustache!'], stars: ['Shooting Stars', 'Make a mihao wish.'],
};
/** How the ground is tinted in each weather. */
const GROUND = { sunny: '#62C64A', rain: '#4AA544', night: '#4DAE4E', frosty: '#D3EAF0', heatwave: '#A9C23E', storm: '#3B8A44', stars: '#4DA85E' };

const texture = (size, draw) => {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};
const glow = (inner, outer) => texture(128, (g) => {
  const r = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  r.addColorStop(0, inner); r.addColorStop(0.35, outer); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
});
const sprite = (map, size, additive = false) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
  s.scale.setScalar(size);
  s.raycast = () => {};
  return s;
};
const points = (n, material) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const p = new THREE.Points(g, material);
  p.frustumCulled = false;
  p.raycast = () => {};
  return p;
};
const approach = (v, to, k) => v + (to - v) * Math.min(1, k);

export class Sky {
  constructor(world) {
    this.world = world;
    this.kind = '';
    this.mix = {}; // eased strength of every effect, 0..1
    this.onThunder = () => {};
    const scene = world.scene;
    this.group = new THREE.Group(); // things that stay around the player like a far sky
    scene.add(this.group);

    // ---- sun with turning rays, moon with a halo ----
    const rays = texture(256, (g) => {
      g.translate(128, 128);
      for (let i = 0; i < 14; i++) { g.rotate((Math.PI * 2) / 14); const r = g.createLinearGradient(0, 0, 128, 0); r.addColorStop(0, 'rgba(255,240,170,.85)'); r.addColorStop(1, 'rgba(255,240,170,0)'); g.fillStyle = r; g.beginPath(); g.moveTo(20, -4); g.lineTo(128, -13); g.lineTo(128, 13); g.lineTo(20, 4); g.fill(); }
    });
    this.sunRays = sprite(rays, 74, true);
    this.sunDisc = sprite(glow('rgba(255,255,235,1)', 'rgba(255,214,74,.95)'), 30);
    const moon = texture(128, (g) => {
      g.fillStyle = '#FFF6D0'; g.beginPath(); g.arc(64, 64, 44, 0, 7); g.fill();
      g.fillStyle = '#E6D9A8'; for (const [x, y, r] of [[48, 46, 9], [80, 70, 13], [56, 84, 6], [78, 38, 5]]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
    });
    this.moonHalo = sprite(glow('rgba(210,225,255,.9)', 'rgba(120,150,255,.28)'), 52, true);
    this.moon = sprite(moon, 15);
    this.sunDisc.position.set(-70, 52, -120); this.sunRays.position.copy(this.sunDisc.position);
    this.moon.position.set(60, 58, -118); this.moonHalo.position.copy(this.moon.position);
    this.group.add(this.sunRays, this.sunDisc, this.moonHalo, this.moon);

    // ---- stars: two layers that twinkle out of step ----
    this.stars = [0, 1].map((layer) => {
      const s = points(800, new THREE.PointsMaterial({ color: layer ? '#bfd4ff' : '#fff3c0', size: layer ? 1.5 : 2.4, sizeAttenuation: false, fog: false, transparent: true, opacity: 0 }));
      const p = s.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) { const u = Math.random() * Math.PI * 2, v = Math.random() * 0.7 + 0.05; p.setXYZ(i, Math.cos(u) * Math.cos(v) * 180, Math.sin(v) * 180, Math.sin(u) * Math.cos(v) * 180); }
      this.group.add(s);
      return s;
    });

    // ---- aurora curtains for shooting-star nights ----
    this.aurora = [['#4DFFC0', 0, 46], ['#7C8CFF', 2.1, 60], ['#FF7AD9', 4.2, 72]].map(([color, phase, y]) => {
      const g = new THREE.PlaneGeometry(240, 26, 64, 1);
      const colors = new Float32Array(g.attributes.position.count * 3), c = new THREE.Color(color);
      for (let i = 0; i < g.attributes.position.count; i++) { const fade = g.attributes.position.getY(i) > 0 ? 0 : 1; colors.set([c.r * fade, c.g * fade, c.b * fade], i * 3); }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false }));
      m.position.set(0, y, -135);
      m.userData = { phase, base: Float32Array.from(g.attributes.position.array) };
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    });

    // ---- rainbow ----
    this.rainbow = new THREE.Group();
    ['#FF4D4D', '#FF9A2E', '#FFE14A', '#56D364', '#3FA9F5', '#6A6AF0', '#B266F0'].forEach((color, i) => {
      const band = new THREE.Mesh(new THREE.RingGeometry(92 - i * 3.1 - 3.1, 92 - i * 3.1, 72, 1, 0, Math.PI), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, fog: false, toneMapped: false }));
      this.rainbow.add(band);
    });
    this.rainbow.position.set(20, -8, -150);
    this.group.add(this.rainbow);
    this.rainbowLeft = 0;

    // ---- rain: streaks, splashes and puddles ----
    this.seeds = Array.from({ length: Math.max(RAIN, SNOW) }, () => [Math.random(), Math.random(), Math.random()]);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RAIN * 6), 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: '#d9ecff', transparent: true, opacity: 0 }));
    this.rain.frustumCulled = false;
    const ring = new THREE.RingGeometry(0.7, 1, 14);
    ring.rotateX(-Math.PI / 2);
    this.splashes = new THREE.InstancedMesh(ring, new THREE.MeshBasicMaterial({ color: '#e8f6ff', transparent: true, opacity: 0.55, depthWrite: false }), SPLASH);
    this.splashes.frustumCulled = false;
    this.splashes.raycast = () => {};
    this.splashAt = Array.from({ length: SPLASH }, () => ({ x: 0, z: 0, t: Math.random() }));
    const puddle = new THREE.CircleGeometry(1, 22);
    puddle.rotateX(-Math.PI / 2);
    this.puddleMat = new THREE.MeshStandardMaterial({ color: '#7FB6D9', roughness: 0.08, metalness: 0.35, transparent: true, opacity: 0, depthWrite: false });
    this.puddles = new THREE.InstancedMesh(puddle, this.puddleMat, 26); // one draw for all of them
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, r = 3.6 + Math.random() * 13;
      this.puddles.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * r, 0.025 + Math.random() * 0.004, Math.sin(a) * r), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 3), new THREE.Vector3(0.4 + Math.random() * 1.1, 1, 0.3 + Math.random() * 0.8)));
    }
    this.puddles.raycast = () => {};
    scene.add(this.puddles);
    scene.add(this.rain, this.splashes);

    // ---- snow, and snow lying on the ground ----
    const flake = texture(64, (g) => {
      g.strokeStyle = '#ffffff'; g.lineWidth = 6; g.lineCap = 'round'; g.translate(32, 32);
      for (let i = 0; i < 3; i++) { g.rotate(Math.PI / 3); g.beginPath(); g.moveTo(-26, 0); g.lineTo(26, 0); g.stroke(); }
    });
    this.snow = points(SNOW, new THREE.PointsMaterial({ map: flake, color: '#ffffff', size: 0.3, transparent: true, opacity: 0, depthWrite: false }));
    scene.add(this.snow);

    // ---- drifting motes: dandelion fluff by day, embers of heat, fireflies at night ----
    this.motes = points(MOTES, new THREE.PointsMaterial({ map: glow('rgba(255,255,255,1)', 'rgba(255,255,255,.55)'), color: '#fff6c0', size: 0.28, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    scene.add(this.motes);

    this.flash = new THREE.PointLight('#e8f0ff', 0, 220);
    scene.add(this.flash);
    this.shooting = [];
    this.bolts = [];
    this.lastStrike = -1;
    this.nextFarBolt = 0;

    // ---- a soft colour wash at the edges of the screen ----
    this.veil = document.createElement('div');
    this.veil.id = 'weatherveil';
    this.veil.setAttribute('aria-hidden', 'true');
    document.getElementById('world')?.after(this.veil);
  }

  /** How many raindrops, flakes and motes to draw (1 = all of them). */
  setDetail(k) {
    this.rain.geometry.setDrawRange(0, Math.floor(RAIN * k) * 2);
    this.snow.geometry.setDrawRange(0, Math.floor(SNOW * k));
    this.motes.geometry.setDrawRange(0, Math.floor(MOTES * k));
    this.splashes.count = Math.floor(SPLASH * k);
  }

  update(dt, seed, now, focus) {
    const w = windowIndex(now);
    const kind = weatherAt(seed, w);
    if (kind !== this.kind) {
      const before = this.kind;
      this.kind = kind;
      this.world.setWeather(kind);
      this.veil.className = `w-${kind}`;
      if ((before === 'rain' || before === 'storm') && kind !== 'rain' && kind !== 'storm') this.rainbowLeft = 70; // the sun comes out
      if (before) banner(...(NAMES[kind] ?? [kind, '']));
    }
    const calm = reducedMotion();
    const raining = kind === 'rain' || kind === 'storm';
    const night = kind === 'night' || kind === 'stars';
    const want = {
      sun: kind === 'sunny' ? 1 : kind === 'heatwave' ? 1 : kind === 'frosty' ? 0.45 : 0,
      moon: night ? 1 : 0, stars: night ? 1 : 0, aurora: kind === 'stars' ? 1 : 0,
      rain: raining ? 1 : 0, snow: kind === 'frosty' ? 1 : 0, puddle: raining ? 1 : 0,
      motes: night ? 1 : kind === 'sunny' ? 0.55 : kind === 'heatwave' ? 0.9 : 0,
    };
    for (const [k, v] of Object.entries(want)) this.mix[k] = approach(this.mix[k] ?? 0, v, dt * (k === 'puddle' && !v ? 0.12 : 0.9));
    const M = this.mix, t = now / 1000;
    this.group.position.set(focus.x, 0, focus.z);
    this.world.ground?.material.color.lerp((this.groundColor ??= new THREE.Color()).set(GROUND[kind] ?? GROUND.sunny), Math.min(1, dt * 0.7));

    // sun, moon, stars, aurora, rainbow
    const hot = kind === 'heatwave';
    this.sunDisc.material.opacity = M.sun;
    this.sunDisc.scale.setScalar((hot ? 46 : 30) * (1 + Math.sin(t * 2) * 0.03));
    this.sunDisc.material.color.set(hot ? '#ffb05a' : '#ffffff');
    this.sunRays.material.opacity = M.sun * (hot ? 0.95 : 0.7);
    this.sunRays.material.rotation = calm ? 0 : t * 0.09;
    this.sunRays.scale.setScalar((hot ? 128 : 78) * (1 + Math.sin(t * 1.3) * 0.07));
    this.moon.material.opacity = M.moon;
    this.moonHalo.material.opacity = M.moon * (0.75 + Math.sin(t * 0.9) * 0.15);
    this.stars.forEach((s, i) => { s.material.opacity = M.stars * (calm ? 1 : 0.65 + 0.35 * Math.sin(t * (2.1 + i) + i * 2)); });
    for (const a of this.aurora) {
      a.visible = M.aurora > 0.01;
      a.material.opacity = M.aurora * 0.5;
      if (!a.visible || calm) continue;
      const p = a.geometry.attributes.position, base = a.userData.base;
      for (let i = 0; i < p.count; i++) { const x = base[i * 3]; p.setXYZ(i, x, base[i * 3 + 1] + Math.sin(x * 0.045 + t * 0.6 + a.userData.phase) * 9 + Math.sin(x * 0.11 - t * 0.9) * 3, base[i * 3 + 2] + Math.cos(x * 0.05 + t * 0.4) * 10); }
      p.needsUpdate = true;
    }
    this.rainbowLeft = Math.max(0, this.rainbowLeft - dt);
    const bow = raining || night ? 0 : Math.min(1, this.rainbowLeft / 12, (70 - this.rainbowLeft) / 6);
    this.rainbow.visible = bow > 0.01;
    this.rainbow.children.forEach((b) => { b.material.opacity = bow * 0.42; });

    // rain: slanted in a storm, splashing on the ground
    this.rain.visible = M.rain > 0.01;
    this.splashes.visible = this.rain.visible;
    if (this.rain.visible) {
      const storm = kind === 'storm';
      this.rain.material.opacity = M.rain * (storm ? 0.75 : 0.6);
      const p = this.rain.geometry.attributes.position;
      const speed = storm ? 30 : 21, lean = storm ? 0.42 : 0.08, len = storm ? 1 : 0.65;
      for (let i = 0; i < RAIN; i++) {
        const [a, b, c] = this.seeds[i];
        const y = 22 - ((t * speed + c * 22) % 22);
        const x = focus.x + (a - 0.5) * 52 + y * lean, z = focus.z + (b - 0.5) * 52;
        p.setXYZ(i * 2, x, y, z);
        p.setXYZ(i * 2 + 1, x - len * lean, y - len, z);
      }
      p.needsUpdate = true;
      const m4 = this.m4 ??= new THREE.Matrix4();
      this.splashAt.forEach((s, i) => {
        s.t += dt * 3.2;
        if (s.t >= 1) { s.t -= 1; s.x = focus.x + (Math.random() - 0.5) * 34; s.z = focus.z + (Math.random() - 0.5) * 34; }
        const r = (0.05 + s.t * 0.26) * (1 - s.t * s.t) * M.rain + 0.001;
        m4.makeScale(r * 1.4, 1, r * 1.4).setPosition(s.x, 0.06, s.z);
        this.splashes.setMatrixAt(i, m4);
      });
      this.splashes.instanceMatrix.needsUpdate = true;
    }
    this.puddleMat.opacity = M.puddle * 0.7;
    this.puddles.visible = M.puddle > 0.02;

    this.snow.visible = M.snow > 0.01;
    if (this.snow.visible) {
      this.snow.material.opacity = M.snow;
      const p = this.snow.geometry.attributes.position;
      for (let i = 0; i < SNOW; i++) {
        const [a, b, c] = this.seeds[i];
        const y = 18 - ((t * (1.2 + b) + c * 18) % 18);
        p.setXYZ(i, focus.x + (a - 0.5) * 46 + Math.sin(t * 0.9 + i) * 0.6, y, focus.z + (b - 0.5) * 46 + Math.cos(t * 0.7 + i) * 0.6);
      }
      p.needsUpdate = true;
    }

    this.motes.visible = M.motes > 0.01;
    if (this.motes.visible) {
      this.motes.material.color.set(night ? '#d8ff6a' : hot ? '#ffa43a' : '#fff6c8');
      this.motes.material.size = night ? 0.34 : hot ? 0.22 : 0.2;
      this.motes.material.opacity = M.motes * (night ? 0.95 : 0.75);
      const p = this.motes.geometry.attributes.position;
      for (let i = 0; i < MOTES; i++) {
        const [a, b, c] = this.seeds[i];
        const rise = hot ? ((t * (0.6 + c) + c * 5) % 5) : 0.35 + c * (night ? 2.4 : 4.5) + Math.sin(t * 0.8 + i) * 0.35;
        p.setXYZ(i, focus.x + (a - 0.5) * 38 + Math.sin(t * 0.55 + i * 1.7) * 1.1, rise, focus.z + (b - 0.5) * 38 + Math.cos(t * 0.45 + i) * 1.1);
      }
      p.needsUpdate = true;
    }

    // lightning and shooting stars at the shared strike times
    const strikes = strikeTimes(seed, w).map((o) => windowStart(w) + o);
    for (const s of strikes) {
      if (now >= s && now - s < 600 && this.lastStrike !== s) {
        this.lastStrike = s;
        if (kind === 'storm') this.strike(focus, true);
        else this.spawnShootingStar(focus);
      }
    }
    // extra distant lightning, for show only
    if (kind === 'storm' && !calm && t > this.nextFarBolt) { if (this.nextFarBolt) this.strike(focus, false); this.nextFarBolt = t + 4 + Math.random() * 6; }
    if (kind === 'stars' && !calm && Math.random() < dt * 1.6) this.spawnShootingStar(focus, true);
    this.flash.position.set(focus.x, 30, focus.z);
    this.flash.intensity *= Math.pow(0.02, dt);
    this.bolts = this.bolts.filter((b) => {
      b.life -= dt;
      b.material.opacity = Math.max(0, Math.min(1, b.life * 4)) * (0.6 + Math.random() * 0.4);
      if (b.life > 0) return true;
      this.world.scene.remove(b.mesh);
      b.mesh.children.forEach((c) => c.geometry.dispose());
      b.material.dispose();
      return false;
    });
    for (const s of this.shooting) {
      s.life -= dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.material.opacity = Math.max(0, Math.min(1, s.life));
    }
    this.shooting = this.shooting.filter((s) => { if (s.life <= 0) { this.world.scene.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh.material.dispose(); return false; } return true; });
  }

  /** A jagged bolt from the clouds. Far ones are dimmer and only for show. */
  strike(focus, close) {
    if (reducedMotion()) return; // no flashing for people who ask for less motion
    const a = Math.random() * Math.PI * 2, r = close ? 14 + Math.random() * 14 : 40 + Math.random() * 40;
    const mesh = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({ color: '#f4f6ff', transparent: true, fog: false, toneMapped: false });
    const segment = (from, to, width) => {
      const dir = to.clone().sub(from);
      const seg = new THREE.Mesh(new THREE.BoxGeometry(width, dir.length(), width), material);
      seg.position.copy(from).addScaledVector(dir, 0.5);
      seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      seg.raycast = () => {};
      mesh.add(seg);
    };
    let p = new THREE.Vector3(focus.x + Math.cos(a) * r, 46, focus.z + Math.sin(a) * r);
    for (let i = 0; i < 9; i++) {
      const next = p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 7, -46 / 9, (Math.random() - 0.5) * 7));
      segment(p, next, 0.42 - i * 0.025);
      if (i === 3 || i === 6) segment(next, next.clone().add(new THREE.Vector3((Math.random() - 0.5) * 13, -5, (Math.random() - 0.5) * 13)), 0.16);
      p = next;
    }
    this.world.scene.add(mesh);
    this.bolts.push({ mesh, material, life: 0.32 });
    this.flash.intensity = close ? 70 : 28;
    this.onThunder(close);
  }

  spawnShootingStar(focus, small = false) {
    const pts = Array.from({ length: 12 }, (_, i) => new THREE.Vector3(-i * 0.5, i * 0.19, 0));
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const colors = pts.flatMap((_, i) => { const k = 1 - i / pts.length; return [k, k * 0.95, k * 0.65]; });
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const m = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, fog: false, blending: THREE.AdditiveBlending }));
    m.position.set(focus.x + (Math.random() - 0.5) * 90, 38 + Math.random() * 28, focus.z - 40 - Math.random() * 40);
    m.scale.setScalar(small ? 1.6 : 3.4);
    m.raycast = () => {};
    this.world.scene.add(m);
    this.shooting.push({ mesh: m, vel: new THREE.Vector3(26, -10, 0), life: small ? 0.9 : 1.6 });
  }
}
