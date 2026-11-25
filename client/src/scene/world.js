// Renderer, lights, sky, ground, village props and the 12 garden plots.
import * as THREE from 'three';
import { WorldFx } from '../fx/world-fx.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Lamps } from './lamps.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PLOT_SLOTS, PLOT, STALLS, FOUNTAIN, PLAZA_RADIUS, WORLD_RADIUS, SIGNS, PLOT_RING_RADIUS, FOREST, PATH_HALF, PATHS } from '@mg/shared/world/village-layout';
import { SOIL_LEVELS } from '@mg/shared/data/tables';

const SKY = {
  sunny: { top: '#2E8CF0', bottom: '#BFE6FF', fog: '#C4E4F8', sun: 3.5, hemi: 0.9, night: 0 },
  rain: { top: '#546E8E', bottom: '#AFC2D2', fog: '#97ACC0', sun: 1.35, hemi: 0.8, night: 0.25 },
  night: { top: '#070B26', bottom: '#2C2F7A', fog: '#1A2050', sun: 0.36, hemi: 0.32, night: 1 },
  frosty: { top: '#6FA8E6', bottom: '#EAF5FF', fog: '#D6E9F8', sun: 2.1, hemi: 0.98, night: 0 },
  heatwave: { top: '#FF7A2E', bottom: '#FFE08A', fog: '#F8C478', sun: 3.8, hemi: 0.95, night: 0 },
  storm: { top: '#1D2336', bottom: '#5A6480', fog: '#454E66', sun: 0.7, hemi: 0.55, night: 0.62 },
  stars: { top: '#0A0724', bottom: '#43266E', fog: '#221A4A', sun: 0.4, hemi: 0.34, night: 1 },
};

/** Fence sides closer than this use the detailed model. */
const FENCE_DETAIL = 42;

export function createRenderer(container) {
  // Full quality by default; add ?lofi to the address for the chunky low-resolution meme look
  const lofi = /[?&]lofi\b/.test(location.search);
  const renderer = new THREE.WebGLRenderer({ antialias: !lofi, powerPreference: 'high-performance' });
  renderer.setPixelRatio(lofi ? 0.6 : Math.min(devicePixelRatio, 1.5));
  if (lofi) renderer.domElement.style.imageRendering = 'pixelated';
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping; // keeps colours saturated (ACES washes greens out)
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = lofi ? THREE.BasicShadowMap : THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  return renderer;
}

export class World {
  constructor(renderer, assets) {
    this.renderer = renderer;
    this.assets = assets;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 700);
    this.fx = new WorldFx(this.scene, this.camera); // particles, rings and flying things
    this.fences = [];
    this.plots = []; // per slot: {group, soil, locked, signs}
    this.skyKind = 'sunny';
    this.skyMix = { ...SKY.sunny };
    this.lamps = new Lamps(this.scene);
    const pm = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.32;
    this.hemi = new THREE.HemisphereLight('#fff3d8', '#4f7a2a', 0.85);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#ffefcf', 3.3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 120 });
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
    this.scene.fog = new THREE.Fog('#BFE0F4', 115, 340);
    this.skyTex = this.makeSky();
    this.scene.background = this.skyTex.texture;
    addEventListener('resize', () => this.resize());
  }

  makeSky() {
    const c = document.createElement('canvas');
    c.width = 4; c.height = 256;
    const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
    return { canvas: c, texture };
  }
  paintSky(top, bottom) {
    const ctx = this.skyTex.canvas.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, top); g.addColorStop(1, bottom);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 256);
    this.skyTex.texture.needsUpdate = true;
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }

  async build(onProgress = () => {}) {
    const { mats } = this.assets;
    // ---- ground: grass disc, plaza paving, paths to every plot ----
    const tile = (m, rep) => { const c = m.clone(); for (const k of ['map', 'normalMap']) if (c[k]) { c[k] = c[k].clone(); c[k].repeat.set(rep, rep); c[k].needsUpdate = true; } return c; };
    const grassMat = tile(mats.grass, 34);
    grassMat.color = new THREE.Color('#62C64A'); // Roblox baseplate green (the texture adds the studs)
    grassMat.vertexColors = false;
    const ground = new THREE.Mesh(new THREE.CircleGeometry(WORLD_RADIUS + 60, 96), grassMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.name = 'ground';
    this.scene.add(ground);
    this.ground = ground;
    const paveMat = tile(mats.paving, 5);
    paveMat.vertexColors = false;
    paveMat.color = new THREE.Color('#EBCB98');
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(PLAZA_RADIUS, 72), paveMat);
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.y = 0.012;
    plaza.receiveShadow = true;
    this.scene.add(plaza);
    const pathMat = paveMat.clone();
    pathMat.color = new THREE.Color('#C99A62'); // paths a touch darker than the plaza so they read clearly
    for (const { a, b } of PATHS) {
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz) + 1.5;
      const p = new THREE.Mesh(new THREE.PlaneGeometry(PATH_HALF * 1.4, len), pathMat);
      p.rotation.x = -Math.PI / 2;
      p.rotation.z = Math.atan2(dx, dz) + Math.PI; // long axis runs from the plaza edge to this garden's gate
      p.position.set((a.x + b.x) / 2, 0.01, (a.z + b.z) / 2);
      p.receiveShadow = true;
      this.scene.add(p);
    }
    onProgress(0.2);
    // ---- props ----
    const put = async (id, x, z, ry = 0, s = 1) => {
      const g = await this.assets.prop(id);
      const o = g.scene.clone();
      o.position.set(x, 0, z);
      o.rotation.y = ry;
      o.scale.setScalar(s);
      this.scene.add(o);
      return o;
    };
    await put('fountain', FOUNTAIN.x, FOUNTAIN.z);
    // stalls with their names painted on the hanging board
    const SHOP = { seeds: ['Seed Shop', "Mo the Mihao", '#FFD84A'], market: ['Market', 'Sell your crops', '#FFD84A'], gadgets: ['Gadgets', 'Tinker Tess', '#9FE6FF'], pets: ['Pet Shop', 'Penny Paws', '#FFC2DD'] };
    for (const st of STALLS) {
      const o = await put(`stall_${st.id}`, st.x, st.z, Math.atan2(-st.x, -st.z));
      const board = makeBoard(1.1, 0.42);
      board.draw(SHOP[st.id][0], SHOP[st.id][1], SHOP[st.id][2]);
      board.mesh.position.set(0, 2.05, 0.86);
      board.mesh.rotation.x = -0.25;
      o.add(board.mesh);
    }
    onProgress(0.45);
    // lamps and benches around the plaza
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + Math.PI / 12;
      this.lamps.add(await put('lamp', Math.sin(a) * (PLAZA_RADIUS - 0.8), Math.cos(a) * (PLAZA_RADIUS - 0.8)));
      if (i % 2) await put('bench', Math.sin(a) * (PLAZA_RADIUS - 2.2), Math.cos(a) * (PLAZA_RADIUS - 2.2), a + Math.PI);
    }
    // flower beds around the plaza edge
    const rnd = mulberry(7);
    for (let i = 0; i < 12; i++) {
      const a = ((i + 0.5) / 12) * Math.PI * 2;
      await put('flowers', Math.sin(a) * (PLAZA_RADIUS + 3), Math.cos(a) * (PLAZA_RADIUS + 3), rnd() * 6, 1.4);
    }
    onProgress(0.55);
    // the woods: hundreds of trees, bushes and rocks, drawn with instancing in 16 wedge-shaped
    // sectors so parts of the forest outside the view are skipped
    await this.plantForest();
    onProgress(0.75);
    // ---- plots ----
    const fence = (await this.assets.prop('fence')).scene;
    this.gateProto = (await this.assets.prop('gate')).scene;
    const sign = (await this.assets.prop('sign')).scene;
    for (const s of PLOT_SLOTS) this.plots.push(this.buildPlot(s, fence, sign));
    this.buildClouds();
    onProgress(1);
  }

  /** Roblox-style clouds: lumps of white blocks drifting across the sky. */
  buildClouds() {
    const rnd = mulberry(21);
    this.cloudMat = new THREE.MeshBasicMaterial({ color: '#ffffff', fog: false });
    this.clouds = new THREE.Group();
    for (let i = 0; i < 22; i++) {
      const c = new THREE.Group();
      const n = 3 + Math.floor(rnd() * 4);
      for (let k = 0; k < n; k++) {
        const w = 14 + rnd() * 16, h = 4 + rnd() * 3, d = 9 + rnd() * 8;
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.cloudMat);
        b.position.set((k - n / 2) * 11 + rnd() * 4, (rnd() - 0.4) * 2.5, (rnd() - 0.5) * 8);
        c.add(b);
      }
      const a = rnd() * Math.PI * 2, r = 130 + rnd() * 190;
      c.position.set(Math.cos(a) * r, 62 + rnd() * 30, Math.sin(a) * r);
      c.userData.speed = 1.2 + rnd() * 1.6;
      this.clouds.add(c);
    }
    this.scene.add(this.clouds);
  }

  /** Instanced woods, split into wedge sectors (inner woods and outer forest) for frustum culling. */
  async plantForest() {
    const SECTORS = 16;
    const sectorOf = (x, z) => Math.floor((((Math.atan2(x, z) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)) * SECTORS) + (Math.hypot(x, z) > PLOT_RING_RADIUS ? SECTORS : 0);
    const groups = [
      ...['tree_oak', 'tree_round', 'tree_birch', 'tree_pine'].map((id, i) => ({ id, list: FOREST.trees.filter((t) => t.type === i), shadow: true })),
      { id: 'bush', list: FOREST.bushes, shadow: false },
      ...[0, 1, 2].map((i) => ({ id: `rock${i}`, list: FOREST.rocks.filter((r) => r.type === i), shadow: false })),
    ];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    for (const g of groups) {
      if (!g.list.length) continue;
      const proto = (await this.assets.prop(g.id)).scene;
      proto.updateMatrixWorld(true);
      const meshes = [];
      proto.traverse((o) => { if (o.isMesh) meshes.push(o); });
      const bySector = new Map();
      for (const t of g.list) { const s = sectorOf(t.x, t.z); if (!bySector.has(s)) bySector.set(s, []); bySector.get(s).push(t); }
      for (const items of bySector.values()) {
        for (const mesh of meshes) {
          const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, items.length);
          items.forEach((t, i) => {
            m4.compose(new THREE.Vector3(t.x, 0, t.z), q.setFromAxisAngle(up, t.ry), new THREE.Vector3(t.s, t.s, t.s));
            m4.multiply(mesh.matrixWorld);
            inst.setMatrixAt(i, m4);
          });
          inst.castShadow = g.shadow;
          inst.receiveShadow = true;
          inst.computeBoundingSphere();
          this.scene.add(inst);
        }
      }
    }
  }

  /**
   * One garden's fence, drawn side by side (so a side out of view is skipped), in two versions:
   * the detailed model up close and a few plain boxes from far away.
   */
  fenceRuns(group, slot, fence, panels) {
    fence.updateMatrixWorld(true);
    const parts = [];
    fence.traverse((o) => { if (o.isMesh) parts.push(o); });
    this.farFence ??= (() => {
      const box = new THREE.Box3().setFromObject(fence), w = box.max.x - box.min.x, h = box.max.y;
      const pieces = [[w, h * 0.12, 0.08, 0, h * 0.72], [w, h * 0.12, 0.08, 0, h * 0.34], [0.2, h * 0.95, 0.12, -w * 0.46, h * 0.475], [0.1, h * 0.85, 0.07, 0, h * 0.425], [0.1, h * 0.85, 0.07, w * 0.25, h * 0.425]];
      const geo = mergeGeometries(pieces.map(([pw, ph, pd, x, y]) => new THREE.BoxGeometry(pw, ph, pd).translate(x, y, 0)));
      return { geo, mat: new THREE.MeshLambertMaterial({ color: '#9E1D1D' }) };
    })();
    const sides = new Map();
    const at = new THREE.Vector3();
    for (const panel of panels) {
      at.setFromMatrixPosition(panel);
      const key = Math.abs(at.x) > PLOT.w / 2 - 0.5 ? `x${Math.sign(at.x)}` : `z${Math.sign(at.z)}`;
      if (!sides.has(key)) sides.set(key, []);
      sides.get(key).push(panel);
    }
    group.updateMatrixWorld(true);
    const m = new THREE.Matrix4();
    for (const list of sides.values()) {
      const run = (geometry, material, local) => {
        const mesh = new THREE.InstancedMesh(geometry, material, list.length);
        list.forEach((panel, i) => mesh.setMatrixAt(i, local ? m.multiplyMatrices(panel, local) : panel));
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        group.add(mesh);
        return mesh;
      };
      const near = parts.map((part) => { const mesh = run(part.geometry, part.material, part.matrixWorld); mesh.castShadow = true; return mesh; });
      const far = run(this.farFence.geo, this.farFence.mat, null);
      const centre = near[0].boundingSphere.center.clone().applyMatrix4(group.matrixWorld);
      this.fences.push({ near, far, centre, isNear: null });
    }
  }

  /** Swap each fence side between its two versions by distance from the camera. */
  updateFences() {
    for (const f of this.fences) {
      const near = f.centre.distanceToSquared(this.camera.position) < FENCE_DETAIL * FENCE_DETAIL;
      if (near === f.isNear) continue;
      f.isNear = near;
      for (const mesh of f.near) mesh.visible = near;
      f.far.visible = !near;
    }
  }

  buildPlot(slot, fence, sign) {
    const g = new THREE.Group();
    g.position.set(slot.x, 0, slot.z);
    g.rotation.y = slot.rotY;
    this.scene.add(g);
    // picket fence around the plot with a gate gap at +z
    const hw = PLOT.w / 2, hd = PLOT.d / 2;
    const panels = []; // where each fence panel goes: they are all drawn together below
    const seg = (x, z, ry, sx = 1) => panels.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(sx, 1, 1)));
    for (let x = -hw + 1; x < hw; x += 2) { seg(x, -hd, 0); if (Math.abs(x) > 3.5) seg(x, hd, 0); }
    // the gate fills the opening between the last fence panels (x -2.73..2.73)
    { const gt = this.gateProto.clone(); gt.position.set(0, 0, hd); g.add(gt); }
    for (const s of [1, -1]) seg(s * 2.87, hd, 0, 0.15); // fill to the gate posts
    for (let z = -hd + 1; z < hd; z += 2) { seg(-hw, z, Math.PI / 2); seg(hw, z, Math.PI / 2); }
    this.fenceRuns(g, slot, fence, panels);
    // soil: current level (textured) + full-size outline showing land you can still unlock
    const soilMat = this.assets.mats.soil.clone();
    soilMat.vertexColors = false;
    soilMat.color = new THREE.Color('#7a4a26');
    const soil = new THREE.Mesh(new THREE.BoxGeometry(1, 0.12, 1), soilMat);
    soil.receiveShadow = true;
    soil.position.y = 0.0;
    soil.name = `soil_${slot.index}`;
    soil.userData = { kind: 'soil', slot: slot.index };
    g.add(soil);
    const max = SOIL_LEVELS[SOIL_LEVELS.length - 1];
    const locked = new THREE.Mesh(new THREE.PlaneGeometry(max.w, max.d), new THREE.MeshStandardMaterial({ color: '#8ED66A', roughness: 1, transparent: true, opacity: 0.55 }));
    locked.rotation.x = -Math.PI / 2;
    locked.position.y = 0.02;
    locked.receiveShadow = true;
    locked.userData = { kind: 'soil', slot: slot.index };
    g.add(locked);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(max.w, max.d)), new THREE.LineDashedMaterial({ color: '#6b4a2b', dashSize: 0.3, gapSize: 0.2 }));
    edge.rotation.x = -Math.PI / 2;
    edge.position.y = 0.03;
    edge.computeLineDistances();
    g.add(edge);
    // signs: expand, grow all, owner (canvas text boards)
    const signs = {};
    for (const [key, p] of Object.entries(SIGNS)) {
      const sg = sign.clone();
      sg.position.set(p.x, 0, p.z);
      sg.rotation.y = 0;
      sg.scale.setScalar(key === 'owner' ? 1.7 : 1.45); // big enough to read from the camera
      g.add(sg);
      const board = makeBoard();
      board.mesh.position.set(p.x, 1.35 * sg.scale.x, p.z + 0.11 * sg.scale.x);
      board.mesh.scale.setScalar(sg.scale.x);
      g.add(board.mesh);
      signs[key] = board;
    }
    const plot = { group: g, soil, locked, signs, level: -1 };
    this.setSoil(plot, 0);
    return plot;
  }

  setSoil(plot, level) {
    if (plot.level === level) return;
    plot.level = level;
    const l = SOIL_LEVELS[level];
    plot.soil.scale.set(l.w, 1, l.d);
    plot.soil.position.y = 0.0;
    const m = plot.soil.material;
    for (const k of ['map', 'normalMap']) if (m[k]) { m[k] = m[k].clone(); m[k].repeat.set(l.w / 1.6, l.d / 1.6); m[k].needsUpdate = true; }
  }

  /** Sky and light follow the weather (smoothly). */
  setWeather(kind) { this.skyKind = SKY[kind] ? kind : 'sunny'; }
  update(dt, focus) {
    this.updateFences();
    const target = SKY[this.skyKind];
    const k = Math.min(1, dt * 0.6);
    const mixC = (a, b) => `#${new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString()}`;
    this.skyMix.top = mixC(this.skyMix.top, target.top);
    this.skyMix.bottom = mixC(this.skyMix.bottom, target.bottom);
    this.skyMix.fog = mixC(this.skyMix.fog, target.fog);
    this.skyMix.sun += (target.sun - this.skyMix.sun) * k;
    this.skyMix.hemi += (target.hemi - this.skyMix.hemi) * k;
    this.skyMix.night += (target.night - this.skyMix.night) * k;
    const night = this.skyMix.night;
    // moonlight is cool and the sky reflection fades, so night really looks like night
    this.sun.color.set('#ffefcf').lerp(this.moonColor ??= new THREE.Color('#9fb4ff'), night);
    this.scene.environmentIntensity = 0.32 * (1 - 0.7 * night);
    this.renderer.toneMappingExposure = 1 - 0.12 * night;
    this.lamps.update(dt, night, this.camera.position);
    this.paintSky(this.skyMix.top, this.skyMix.bottom);
    this.scene.fog.color.set(this.skyMix.fog);
    this.sun.intensity = this.skyMix.sun;
    this.hemi.intensity = this.skyMix.hemi;
    // shadow camera follows the player
    if (this.clouds) {
      for (const c of this.clouds.children) { c.position.x += c.userData.speed * dt; if (c.position.x > focus.x + 330) c.position.x -= 660; if (c.position.x < focus.x - 330) c.position.x += 660; }
      this.cloudMat.color.set('#ffffff').lerp(this.cloudDark ??= new THREE.Color('#5a6480'), Math.min(1, night * 0.85 + (this.skyKind === 'storm' || this.skyKind === 'rain' ? 0.45 : 0)));
    }
    this.sun.position.set(focus.x - 22, 40, focus.z + 16);
    this.sun.target.position.set(focus.x, 0, focus.z);
  }
}

/** A sign board with canvas text. */
export function makeBoard(w = 1.22, h = 0.56) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, emissive: new THREE.Color('#ffffff'), emissiveMap: tex, emissiveIntensity: 0.25 }));
  let last = '';
  const draw = (title, sub, color = '#FFD84A') => {
    const key = `${title}|${sub}|${color}`;
    if (key === last) return;
    last = key;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#7a5434'; ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = '#8a6440'; for (let y = 0; y < 256; y += 64) ctx.fillRect(0, y, 512, 3);
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    const txt = (s, y, size, fill) => { ctx.font = `800 ${size}px "Baloo 2", sans-serif`; ctx.lineWidth = size / 6; ctx.strokeStyle = '#2B1A0E'; ctx.strokeText(s, 256, y); ctx.fillStyle = fill; ctx.fillText(s, 256, y); };
    txt(title, 108, 66, '#FFF4DC');
    if (sub) txt(sub, 196, 60, color);
    tex.needsUpdate = true;
  };
  return { mesh, draw };
}

function mulberry(seed) {
  let a = seed;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
