// Local player: camera-relative movement with client prediction, click-to-walk, jump, server corrections.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { walkable } from '@mg/shared/world/village-layout';
import { findPath } from './path.js';

const canStand = (x, z, air = false) => walkable(x, z, 0.35, true, !air); // trees are solid; fences only on the ground

const WALK = 4.4, RUN = 7.8, GRAVITY = 22, JUMP_V = 7.5;

export class PlayerController {
  constructor(world, dom) {
    this.world = world;
    this.pos = new THREE.Vector3();
    this.ry = 0;
    this.vy = 0;
    this.an = 0;
    this.keys = new Set();
    this.target = null; // click-to-walk destination {x,z, then}
    this.pose = 0; // meme pose being held (animation code, 0 = none)
    this.poseUntil = 0;
    this.joy = { x: 0, z: 0 };
    this.enabled = true;
    this.lastSend = 0;
    this.lastSent = '';
    this.controls = new OrbitControls(world.camera, dom);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.12, enablePan: false, minDistance: 5, maxDistance: 34, minPolarAngle: 0.3, maxPolarAngle: 1.36, rotateSpeed: 0.7 });
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    addEventListener('keydown', (e) => { if (e.target.tagName === 'INPUT') return; this.keys.add(e.code); if (e.code === 'Space') { this.jump(); e.preventDefault(); } });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  spawn(x, z, ry) {
    this.pos.set(x, 0, z);
    this.ry = ry;
    const off = new THREE.Vector3(Math.sin(ry) * -11, 9, Math.cos(ry) * -11);
    this.world.camera.position.copy(this.pos).add(off);
    this.controls.target.set(x, 1.2, z);
    this.controls.update();
  }
  jump() { if (this.pos.y <= 0.001) this.vy = JUMP_V; }
  /** Hold a pose (for ms milliseconds, or until the player moves). It never blocks movement. */
  setPose(an, ms = 0) { this.pose = an; this.poseUntil = an && ms ? performance.now() + ms : 0; }
  /** Walk to a point, finding a way around trees if the straight line is blocked. */
  walkTo(x, z, then = null) {
    const route = findPath(this.pos.x, this.pos.z, x, z) ?? [{ x, z }];
    this.route = route;
    const first = route.shift();
    this.target = { x: first.x, z: first.z, then: route.length ? null : then, final: then };
  }
  /** Server corrected our position. */
  fix(x, z, travel = false) {
    const d = Math.hypot(x - this.pos.x, z - this.pos.z);
    if (travel || d > 2) {
      const dx = x - this.pos.x, dz = z - this.pos.z;
      this.pos.x = x; this.pos.z = z;
      this.vel = 0; this.target = null; this.route = null; // arrive standing still (no glide after a teleport)
      this.world.camera.position.x += dx; this.world.camera.position.z += dz;
      this.controls.target.x += dx; this.controls.target.z += dz;
      this.target = null;
    } else { this.pos.x += (x - this.pos.x) * 0.6; this.pos.z += (z - this.pos.z) * 0.6; }
  }

  update(dt, socket) {
    const cam = this.world.camera;
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    let mx = 0, mz = 0;
    if (this.enabled) {
      const k = this.keys;
      if (k.has('KeyW') || k.has('ArrowUp')) { mx += fwd.x; mz += fwd.z; }
      if (k.has('KeyS') || k.has('ArrowDown')) { mx -= fwd.x; mz -= fwd.z; }
      if (k.has('KeyD') || k.has('ArrowRight')) { mx += right.x; mz += right.z; }
      if (k.has('KeyA') || k.has('ArrowLeft')) { mx -= right.x; mz -= right.z; }
      if (this.joy.x || this.joy.z) { mx += fwd.x * -this.joy.z + right.x * this.joy.x; mz += fwd.z * -this.joy.z + right.z * this.joy.x; }
    }
    let speed = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? RUN : WALK;
    if (mx || mz) { this.target = null; this.route = null; }
    else if (this.target) {
      const dx = this.target.x - this.pos.x, dz = this.target.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.25) {
        const done = this.target;
        if (this.route?.length) { const nxt = this.route.shift(); this.target = { x: nxt.x, z: nxt.z, then: this.route.length ? null : done.final, final: done.final }; }
        else { this.target = null; this.vel = 0; done.then?.(); } // arrive exactly, no glide past a click target
      }
      else { mx = dx / d; mz = dz / d; speed = d > 6 ? RUN : WALK; this.remain = d; }
    }
    const len = Math.hypot(mx, mz);
    let moving = false;
    const before = { x: this.pos.x, z: this.pos.z };
    // smooth speed: ease up to the target speed and ease down to a stop instead of jumping
    this.vel ??= 0;
    const wantSpeed = len > 0.01 ? speed : 0;
    this.vel += (wantSpeed - this.vel) * Math.min(1, dt * (wantSpeed > this.vel ? 9 : 14));
    if (this.vel < 0.05) this.vel = 0;
    if (len > 0.01) { mx /= len; mz /= len; this.dir = { x: mx, z: mz }; }
    if (this.vel > 0 && this.dir) {
      mx = this.dir.x; mz = this.dir.z;
      const step = this.target ? Math.min(this.vel * dt, this.remain ?? Infinity) : this.vel * dt; // never overshoot a click target
      const nx = this.pos.x + mx * step, nz = this.pos.z + mz * step;
      const air = this.pos.y > 0.45; // high enough in a jump to clear a fence
      const stuck = !canStand(this.pos.x, this.pos.z, air); // e.g. landed on a fence or loaded inside a new house: let them walk out
      if (stuck || canStand(nx, nz, air)) { this.pos.x = nx; this.pos.z = nz; moving = true; }
      else if (canStand(nx, this.pos.z, air)) { this.pos.x = nx; moving = true; }
      else if (canStand(this.pos.x, nz, air)) { this.pos.z = nz; moving = true; }
      else if (this.target) { const then = this.target.then; this.target = null; then?.(); }
      const want = Math.atan2(mx, mz);
      let d = want - this.ry;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.ry += d * Math.min(1, dt * 10);
    }
    // jump / gravity
    if (this.pos.y > 0 || this.vy > 0) { this.vy -= GRAVITY * dt; this.pos.y = Math.max(0, this.pos.y + this.vy * dt); if (this.pos.y === 0) this.vy = 0; }
    this.speed = dt > 0 ? Math.hypot(this.pos.x - before.x, this.pos.z - before.z) / dt : 0; // drives walk/run playback speed
    if (this.pose && (len > 0.01 || this.pos.y > 0.05 || (this.poseUntil && performance.now() > this.poseUntil))) this.setPose(0); // moving ends a pose
    this.an = this.pos.y > 0.05 ? 3 : moving && this.speed > 0.3 ? (this.speed > (WALK + RUN) / 2 ? 2 : 1) : this.pose;
    // camera follows
    const dxc = this.pos.x - this.controls.target.x, dzc = this.pos.z - this.controls.target.z;
    this.controls.target.x += dxc; this.controls.target.z += dzc;
    cam.position.x += dxc; cam.position.z += dzc;
    this.controls.update();
    // send position at up to 10 Hz when something changed
    const now = performance.now();
    const sig = `${this.pos.x.toFixed(2)},${this.pos.z.toFixed(2)},${this.ry.toFixed(2)},${this.an}`;
    if (now - this.lastSend > 100 && sig !== this.lastSent) {
      socket.raw({ t: 'mv', x: +this.pos.x.toFixed(3), z: +this.pos.z.toFixed(3), ry: +this.ry.toFixed(3), an: this.an });
      this.lastSend = now;
      this.lastSent = sig;
    }
    return moving;
  }

  /** Report an action animation to others (plant / water / harvest / wave). */
  emote(socket, an) {
    socket.raw({ t: 'mv', x: +this.pos.x.toFixed(3), z: +this.pos.z.toFixed(3), ry: +this.ry.toFixed(3), an });
    this.lastSent = '';
  }
}
