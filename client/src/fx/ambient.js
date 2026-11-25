// Background life so the village never stands still: butterflies around you, petals on the breeze
// and birds circling overhead. All cosmetic, and none of it can be clicked.
import * as THREE from 'three';
import { reducedMotion, PALETTE } from './world-fx.js';

const noPick = (o) => { o.traverse((x) => { x.raycast = () => {}; x.frustumCulled = false; }); return o; };
const flat = (color) => new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, toneMapped: false });

/** Two block wings on hinges: used for butterflies and birds. */
function flyer(color, w, h, body) {
  const g = new THREE.Group();
  const wings = [1, -1].map((s) => {
    const hinge = new THREE.Group();
    const wing = new THREE.Mesh(new THREE.PlaneGeometry(w, h), flat(color));
    wing.rotation.x = -Math.PI / 2;
    wing.position.x = (w / 2) * s;
    hinge.add(wing);
    g.add(hinge);
    return hinge;
  });
  g.add(new THREE.Mesh(new THREE.BoxGeometry(body, body, h * 1.15), flat('#2B1A0E')));
  return { g: noPick(g), flap: (a) => { wings[0].rotation.z = a; wings[1].rotation.z = -a; } };
}

export function createAmbient({ world, player }) {
  if (reducedMotion()) return { update() {} };
  const rnd = (a, b) => a + Math.random() * (b - a);

  const butterflies = Array.from({ length: 8 }, (_, i) => {
    const f = flyer(PALETTE.party[i % PALETTE.party.length], 0.17, 0.2, 0.035);
    world.scene.add(f.g);
    return { ...f, at: null, to: new THREE.Vector3(), until: 0, phase: rnd(0, 6) };
  });

  const birds = Array.from({ length: 3 }, (_, i) => {
    const f = flyer(i % 2 ? '#FFFFFF' : '#FFD84A', 0.75, 0.28, 0.14);
    world.scene.add(f.g);
    return { ...f, r: 16 + i * 5, y: 11 + (i % 3) * 2.2, speed: (0.16 + i * 0.025) * (i % 2 ? 1 : -1), a: i * 1.3 };
  });

  const N = 110;
  const petals = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.11, 0.08), flat('#ffffff'), N);
  noPick(petals);
  const colors = ['#FF9CC2', '#FFC4DA', '#FFD84A', '#FFFFFF'];
  const drift = Array.from({ length: N }, (_, i) => { petals.setColorAt(i, new THREE.Color(colors[i % colors.length])); return { x: rnd(-18, 18), y: rnd(0, 7), z: rnd(-18, 18), s: rnd(0.25, 0.65), p: rnd(0, 6) }; });
  world.scene.add(petals);

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
  let t = 0, shown = true;
  const show = (on) => { shown = on; petals.visible = on; for (const f of [...butterflies, ...birds]) f.g.visible = on; };
  return {
    update(dt, on = true) {
      if (on !== shown) show(on);
      if (!on) return;
      t += dt;
      const here = player.pos;
      for (const b of butterflies) {
        if (!b.at || b.at.distanceTo(v.set(here.x, 1, here.z)) > 22) b.at = new THREE.Vector3(here.x + rnd(-12, 12), rnd(0.5, 2.2), here.z + rnd(-12, 12));
        if (t > b.until || b.at.distanceTo(b.to) < 0.3) { b.until = t + rnd(1.5, 4); b.to.set(b.at.x + rnd(-4, 4), rnd(0.4, 2.4), b.at.z + rnd(-4, 4)); }
        v.copy(b.to).sub(b.at);
        const d = v.length() || 1;
        b.at.addScaledVector(v, Math.min(1, (dt * 1.5) / d));
        b.g.position.copy(b.at);
        b.g.position.y += Math.sin(t * 7 + b.phase) * 0.1;
        b.g.rotation.y = Math.atan2(v.x, v.z);
        b.flap(Math.sin(t * 22 + b.phase) * 0.95);
      }
      for (const b of birds) {
        b.a += dt * b.speed;
        b.g.position.set(Math.cos(b.a) * b.r, b.y + Math.sin(t * 1.3 + b.r) * 0.6, Math.sin(b.a) * b.r);
        b.g.rotation.y = -b.a + (b.speed > 0 ? 0 : Math.PI);
        b.flap(Math.sin(t * 8 + b.r) * 0.55);
      }
      drift.forEach((p, i) => {
        p.y -= p.s * dt;
        p.x += (0.55 + Math.sin(t + p.p) * 0.4) * dt;
        if (p.y < 0.05) { p.y = rnd(4, 7); p.x = rnd(-18, 18); p.z = rnd(-18, 18); }
        if (p.x > 18) p.x -= 36;
        q.setFromEuler(e.set(t * 2 + p.p, t * 1.4 + p.p, p.p));
        m.compose(v.set(here.x + p.x, p.y, here.z + p.z), q, one);
        petals.setMatrixAt(i, m);
      });
      petals.instanceMatrix.needsUpdate = true;
    },
  };
}
