// Rooms of up to 12 players. Each player owns one plot slot in the village.
// All game state is held and changed here; clients only send intents.
import { keyed } from '@mg/shared/util/rng';
import { freshState, migrateState, dayKey } from '@mg/shared/rules/state';
import { applyAction, ACTION_PLACE } from '@mg/shared/rules/actions';
import { catchUp, upkeep } from '@mg/shared/rules/catchup';
import { publicGarden, publicPlant, publicEffect, privateState, publicProfile } from '@mg/shared/rules/public';
import { maybeSurprise } from '@mg/shared/rules/progress';
import { stat } from '@mg/shared/rules/quests';
import { CROP } from '@mg/shared/data/crops';
import { BALLOON, BOARD, ISLAND, onIsland } from '@mg/shared/world/village-layout';
import {
  ROOM_SIZE, PLOT_SLOTS, STALLS, SIGNS, PLOT, REACH, toWorld, toLocal, walkable, plotAt, dist,
} from '@mg/shared/world/village-layout';
import { Bucket, cleanChat } from './security.js';
import { MemeRoom, giveMeme } from './memes.js';
import { maybeInspection, hasPose } from '@mg/shared/rules/memes';
import { poseByAn } from '@mg/shared/data/memes';

export const PROTO = 1;
const GHOST_MS = 120_000;
const AFK_MS = 10 * 60_000;
const KICK_MS = 30 * 60_000;
const EMPTY_ROOM_MS = 5 * 60_000;
const RUN_SPEED = 8.2;
const CHAT_KEEP = 30;
const RESULT_CACHE = 64;

const send = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };

const gatePos = (slot) => toWorld(slot, 0, PLOT.gateZ + 1.6);
const stallFront = (id) => { const s = STALLS.find((x) => x.id === id); return { x: s.x * 0.62, z: s.z * 0.62 + (id === 'seeds' ? 0 : 0) }; };

class Member {
  constructor(pid, name, state, slot, now) {
    this.pid = pid;
    this.name = name;
    this.state = state;
    this.slot = slot;
    this.ws = null;
    const g = gatePos(slot);
    this.pos = { x: g.x, z: g.z, ry: PLOT_SLOTS[slot].rotY + Math.PI, an: 0 };
    this.moved = true;
    this.lastMoveAt = now;
    this.lastInput = now;
    this.lastUpkeep = now;
    this.ghostUntil = 0;
    this.afk = false;
    this.dirty = true;
    this.fixes = [];
    this.results = new Map();
    this.pub = new Map(); // plant id -> json of last broadcast public plant
    this.pubEffects = '';
    this.pubSoil = state.soil;
    this.buckets = { act: new Bucket(15, 30), mv: new Bucket(14, 24), chat: new Bucket(1 / 1.5, 3), like: new Bucket(20 / 60, 6) };
    for (const p of state.plants) this.pub.set(p.id, JSON.stringify(publicPlant(p)));
    this.pubEffects = JSON.stringify(state.effects.map(publicEffect));
  }
  publicInfo(likes) {
    return { slot: this.slot, name: this.name, x: this.pos.x, z: this.pos.z, ry: this.pos.ry, an: this.pos.an, afk: this.afk, ghost: !this.ws, likes, ...publicProfile(this.state) };
  }
}

/** JSON of every top-level field, to find what an action or tick changed. */
function snapshot(state) {
  const s = {};
  for (const [k, v] of Object.entries(state)) s[k] = JSON.stringify(v);
  return s;
}
/** Changed top-level fields (deep copies). */
function delta(before, state, ignore = []) {
  const d = {};
  for (const [k, v] of Object.entries(state)) {
    if (ignore.includes(k) || k === 'lastSeq') continue;
    const j = JSON.stringify(v);
    if (j !== before[k]) d[k] = JSON.parse(j);
  }
  return d;
}

export class Room {
  constructor(id, mgr) {
    this.id = id;
    this.mgr = mgr;
    this.slots = Array(ROOM_SIZE).fill(null);
    this.members = new Map(); // pid -> Member
    this.chat = [];
    this.emptySince = 0;
    this.memes = new MemeRoom(this, mgr.memeTiming);
  }
  get size() { return this.members.size; }
  freeSlot() { return this.slots.indexOf(null); }
  broadcast(msg, except = null) {
    const s = JSON.stringify(msg);
    for (const m of this.members.values()) if (m !== except && m.ws && m.ws.readyState === 1) m.ws.send(s);
  }

  /** Public garden changes since the last broadcast. */
  gardenDiff(m) {
    const up = [], rm = [];
    const seen = new Set();
    for (const p of m.state.plants) {
      seen.add(p.id);
      const pub = publicPlant(p), json = JSON.stringify(pub);
      if (m.pub.get(p.id) !== json) { up.push(pub); m.pub.set(p.id, json); }
    }
    for (const id of [...m.pub.keys()]) if (!seen.has(id)) { rm.push(id); m.pub.delete(id); }
    const eff = m.state.effects.map(publicEffect), effJson = JSON.stringify(eff);
    const out = { t: 'g', slot: m.slot };
    let changed = false;
    if (up.length) { out.up = up; changed = true; }
    if (rm.length) { out.rm = rm; changed = true; }
    if (effJson !== m.pubEffects) { out.effects = eff; m.pubEffects = effJson; changed = true; }
    if (m.state.soil !== m.pubSoil) { out.soil = m.state.soil; m.pubSoil = m.state.soil; changed = true; }
    const pg = publicGarden(m.state);
    const extra = JSON.stringify([pg.home, pg.decor, pg.pets, pg.eggs]);
    if (extra !== m.pubExtra) { Object.assign(out, { home: pg.home, decor: pg.decor, pets: pg.pets, eggs: pg.eggs }); m.pubExtra = extra; changed = true; }
    return changed ? out : null;
  }
  pushGarden(m) { const d = this.gardenDiff(m); if (d) this.broadcast(d); }

  welcome(m, away) {
    const now = this.mgr.now();
    const gardens = {};
    const members = [];
    for (const o of this.members.values()) {
      gardens[o.slot] = publicGarden(o.state);
      members.push(o.publicInfo(this.mgr.db.likes(o.pid)));
    }
    const liked = new Set(this.mgr.db.likedToday(m.pid, dayKey(now)));
    send(m.ws, {
      t: 'welcome', proto: PROTO,
      you: { slot: m.slot, name: m.name },
      room: { id: this.id, members },
      gardens,
      me: privateState(m.state),
      lastSeq: m.state.lastSeq ?? 0,
      clock: { now, seed: this.mgr.seed },
      liked: [...this.members.values()].filter((o) => liked.has(o.pid)).map((o) => o.slot),
      chat: this.chat,
      away,
    });
  }

  // ---- messages ----------------------------------------------------------

  onMessage(m, msg) {
    const now = this.mgr.now();
    m.lastInput = now;
    if (m.afk) { m.afk = false; this.broadcast({ t: 'afk', slot: m.slot, afk: false }); }
    switch (msg.t) {
      case 'mv': return this.onMove(m, msg, now);
      case 'act': return this.onAct(m, msg, now);
      case 'chat': return this.onChat(m, msg, now);
      case 'meme': return this.memes.onMessage(m, msg);
      case 'ping': return send(m.ws, { t: 'pong', c: msg.c, s: now });
      default: return undefined;
    }
  }

  onMove(m, msg, now) {
    if (!m.buckets.mv.take(now)) return;
    const x = Number(msg.x), z = Number(msg.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const dt = Math.min(1, Math.max(0.05, (now - m.lastMoveAt) / 1000));
    const d = Math.hypot(x - m.pos.x, z - m.pos.z);
    const fences = Number(msg.an) !== 3 && m.pos.an !== 3; // jumping clears fences
    if (d > RUN_SPEED * 1.3 * dt + 0.35 || (!walkable(x, z, 0.35, false, fences) && walkable(m.pos.x, m.pos.z))) { // someone already stuck may walk out
      m.fixes = m.fixes.filter((t) => now - t < 10_000);
      m.fixes.push(now);
      if (m.fixes.length === 3) this.mgr.db.audit(m.pid, now, 'move_fix', { x, z, from: m.pos });
      send(m.ws, { t: 'fix', x: m.pos.x, z: m.pos.z });
      m.lastMoveAt = now;
      return;
    }
    m.pos.x = x; m.pos.z = z;
    m.pos.ry = Number.isFinite(Number(msg.ry)) ? Number(msg.ry) : m.pos.ry;
    const an = Math.max(0, Math.min(15, Math.floor(Number(msg.an) || 0)));
    const pose = poseByAn(an);
    m.pos.an = pose && !hasPose(m.state, pose.id) ? 0 : an; // locked poses are not shown to others
    m.lastMoveAt = now;
    m.moved = true;
  }

  /** Is the actor close enough to do this action? */
  inReach(m, a, p) {
    const place = ACTION_PLACE[a];
    if (place === 'any') return true;
    if (place === 'board') return dist(m.pos, BOARD) <= BOARD.reach + 1;
    if (place === 'balloon') return dist(m.pos, BALLOON) <= BALLOON.reach + 1;
    if (place === 'island') return onIsland(m.pos.x, m.pos.z);
    if (STALLS.some((s) => s.id === place)) {
      const s = STALLS.find((x) => x.id === place);
      return dist(m.pos, s) <= s.reach + 1.2;
    }
    // garden actions: own plot only
    const local = toLocal(m.slot, m.pos.x, m.pos.z);
    const onPlot = Math.abs(local.x) <= PLOT.w / 2 + 1 && Math.abs(local.z) <= PLOT.d / 2 + 2.5;
    if (place === 'plot') return onPlot;
    if (a === 'expandSoil' || a === 'growAll') {
      const sign = a === 'expandSoil' ? SIGNS.expand : SIGNS.growAll;
      return onPlot || Math.hypot(local.x - sign.x, local.z - sign.z) <= 4;
    }
    let target = null;
    if (p && typeof p.id === 'string') {
      const plant = m.state.plants.find((x) => x.id === p.id);
      if (plant) target = plant;
    }
    if (!target && p && Number.isFinite(p.x) && Number.isFinite(p.z)) target = { x: p.x, z: p.z, crop: p.crop };
    if (!target) return onPlot;
    const r = CROP[target.crop]?.radius ?? 0.8;
    return Math.hypot(local.x - target.x, local.z - target.z) <= REACH + r;
  }

  onAct(m, msg, now) {
    const id = Number(msg.id);
    if (!Number.isInteger(id) || id < 1) return;
    const last = m.state.lastSeq ?? 0;
    if (id <= last) {
      const cached = m.results.get(id);
      return send(m.ws, cached ?? { t: 'res', id, ok: false, code: 'stale', msg: 'Already handled.' });
    }
    if (id > last + 1000) return send(m.ws, { t: 'res', id, ok: false, code: 'bad_seq', msg: 'Please reconnect.' });
    if (!m.buckets.act.take(now)) return send(m.ws, { t: 'res', id, ok: false, code: 'slow', msg: 'Slow down a little!' });
    const a = String(msg.a ?? ''), p = msg.p && typeof msg.p === 'object' ? msg.p : {};
    const res = this.perform(m, a, p, now);
    const out = { t: 'res', id, ...res };
    m.state.lastSeq = id;
    m.results.set(id, out);
    if (m.results.size > RESULT_CACHE) m.results.delete(m.results.keys().next().value);
    m.dirty = true;
    send(m.ws, out);
  }

  perform(m, a, p, now) {
    if (a === 'like') return this.like(m, p, now);
    if (a === 'report') return this.report(m, p, now);
    if (a === 'travel') return this.travel(m, p);
    if (!(a in ACTION_PLACE)) return { ok: false, code: 'unknown', msg: 'Unknown action.' };
    if (!this.inReach(m, a, p)) return { ok: false, code: 'far', msg: 'Walk a little closer first.' };
    const ctx = { ...this.mgr.ctx(m.pid, now), pos: { x: m.pos.x, z: m.pos.z }, slot: m.slot };
    const before = snapshot(m.state);
    const r = applyAction(m.state, a, p, ctx);
    // a rare fruit (special variant or BIG) is worth a few Meme Points
    if (r.ok && a === 'harvest' && r.items?.some((i) => i.big || i.variant !== 'normal')) giveMeme(m, 'rare', now);
    const { ok, code, msg, ...extra } = r;
    const out = { ok, code, msg };
    if (ok) {
      out.d = delta(before, m.state);
      if (a === 'setAvatar' || a === 'buyWear' || a === 'setTitle' || a === 'rebirth') this.broadcast({ t: 'profile', slot: m.slot, ...publicProfile(m.state) });
      if (extra.items) out.x = { items: extra.items.map((i) => i.id) };
      else if (extra.value !== undefined) out.x = { value: extra.value, count: extra.count };
      else if (extra.total !== undefined) out.x = { total: extra.total, count: extra.count };
      else if (extra.reward) out.x = { reward: extra.reward };
      else if (extra.crop) out.x = { crop: extra.crop };
      else if (extra.pass !== undefined) out.x = { pass: extra.pass };
      this.pushGarden(m);
      if (a === 'expandSoil' || (a === 'buySeed' && CROP[p.id]?.tier === 'prismatic')) this.mgr.flushOne(m);
    }
    return out;
  }

  travel(m, p) {
    const to = String(p.to ?? '');
    if (to === 'island' && !m.state.island?.unlocked) return { ok: false, code: 'locked', msg: 'Captain Puff needs to fix the balloon first.' };
    const spot = {
      garden: () => gatePos(m.slot),
      island: () => ({ x: ISLAND.center.x, z: ISLAND.center.z + ISLAND.radius - 5 }),
      balloon: () => ({ x: BALLOON.x * 0.58, z: BALLOON.z * 0.58 }),
      board: () => ({ x: BOARD.x * 0.75, z: BOARD.z * 0.75 }),
    }[to];
    const pos = spot ? spot() : STALLS.some((s) => s.id === to) ? stallFront(to) : null;
    if (!pos) return { ok: false, code: 'bad_spot', msg: 'Unknown place.' };
    m.pos.x = pos.x; m.pos.z = pos.z; m.moved = true; m.lastMoveAt = this.mgr.now();
    send(m.ws, { t: 'fix', x: pos.x, z: pos.z, travel: true });
    return { ok: true, code: 'ok', msg: '' };
  }

  like(m, p, now) {
    const slot = Number(p.slot);
    const owner = this.slots[slot];
    if (!owner || slot === m.slot) return { ok: false, code: 'bad_target', msg: 'You cannot like that garden.' };
    if (!m.buckets.like.take(now)) return { ok: false, code: 'slow', msg: 'Slow down a little!' };
    const sign = toWorld(slot, SIGNS.owner.x, SIGNS.owner.z);
    if (dist(m.pos, sign) > 7) return { ok: false, code: 'far', msg: 'Walk up to their garden sign first.' };
    if (!this.mgr.db.like(owner, m.pid, dayKey(now))) return { ok: false, code: 'liked', msg: 'You already stamped this garden today!' };
    stat(m.state, 'liked');
    giveMeme(m, 'stamp', now);
    const likes = this.mgr.db.likes(owner);
    this.broadcast({ t: 'like', slot, likes, from: m.slot });
    return { ok: true, code: 'ok', msg: 'mihao stamp left!', d: { daily: m.state.daily, weekly: m.state.weekly, meme: m.state.meme } };
  }

  report(m, p, now) {
    const target = this.slots[Number(p.slot)];
    if (!target || target === m.pid) return { ok: false, code: 'bad_target', msg: 'Pick another player.' };
    if (!m.buckets.like.take(now)) return { ok: false, code: 'slow', msg: 'Slow down a little!' };
    const reason = String(p.reason ?? 'other').slice(0, 40);
    const recent = this.chat.filter((c) => c.slot === Number(p.slot)).slice(-5).map((c) => c.text);
    this.mgr.db.report(m.pid, target, now, reason, recent);
    return { ok: true, code: 'ok', msg: 'Thanks. A moderator will take a look.' };
  }

  onChat(m, msg, now) {
    if (!m.buckets.chat.take(now)) return send(m.ws, { t: 'toast', key: 'chat_slow', msg: 'You are chatting too fast.' });
    const text = cleanChat(msg.text);
    if (!text) return undefined;
    const line = { slot: m.slot, name: m.name, text, at: now };
    this.chat.push(line);
    if (this.chat.length > CHAT_KEEP) this.chat.shift();
    this.mgr.db.logChat(this.id, m.pid, now, text);
    this.broadcast({ t: 'chat', ...line });
    return undefined;
  }

  // ---- ticks -------------------------------------------------------------

  tick(now) {
    for (const m of [...this.members.values()]) {
      if (!m.ws && m.ghostUntil && now > m.ghostUntil) { this.mgr.removeMember(this, m); continue; }
      if (m.ws && !m.afk && now - m.lastInput > AFK_MS) { m.afk = true; this.broadcast({ t: 'afk', slot: m.slot, afk: true }); }
      if (m.ws && now - m.lastInput > KICK_MS) { m.ws.close(4001, 'idle'); }
      const before = snapshot(m.state);
      const ctx = this.mgr.ctx(m.pid, now);
      const r = upkeep(m.state, m.lastUpkeep, ctx);
      if (m.ws) { maybeSurprise(m.state, m.slot, ctx); maybeInspection(m.state, ctx); }
      m.lastUpkeep = now;
      const d = delta(before, m.state, ['lastSeen']);
      if (Object.keys(d).length) {
        m.dirty = true;
        this.pushGarden(m);
        send(m.ws, { t: 'sync', d, helped: r.helped.length ? r.helped : undefined });
        // everyone else in the village sees the pets at work too
        if (r.helped.length) this.broadcast({ t: 'pethelp', slot: m.slot, helped: r.helped.map(({ pet, did, x, z }) => ({ pet, did, x, z })) }, m);
      }
    }
  }

  broadcastPositions() {
    const n = [];
    for (const m of this.members.values()) {
      if (!m.moved) continue;
      m.moved = false;
      n.push([m.slot, Math.round(m.pos.x * 100), Math.round(m.pos.z * 100), Math.round(m.pos.ry * 100), m.pos.an]);
    }
    if (n.length) this.broadcast({ t: 'pos', n });
  }
}

export class RoomManager {
  constructor({ db, seed, secret, now = () => Date.now(), memeTiming = {} }) {
    this.memeTiming = memeTiming;
    this.db = db;
    this.seed = seed;
    this.secret = secret;
    this.now = now;
    this.rooms = new Map();
    this.byPlayer = new Map(); // pid -> {room, member}
    this.nextRoom = 1;
  }

  ctx(pid, now) { return { now, seed: this.seed, rng: (...parts) => keyed(this.secret, pid, ...parts) }; }

  pickRoom() {
    let best = null;
    for (const r of this.rooms.values()) if (r.size < ROOM_SIZE && r.freeSlot() >= 0 && (!best || r.size > best.size)) best = r;
    if (best) return best;
    const r = new Room(`r${this.nextRoom++}`, this);
    this.rooms.set(r.id, r);
    return r;
  }

  /** A player's socket connected (or reconnected). */
  connect(pid, name, ws, join = null) {
    const now = this.now();
    let existing = this.byPlayer.get(pid);
    // joining a friend: leave the current room if the friend's room has space
    const friendRoom = join && this.db.areFriends(pid, join) ? this.byPlayer.get(join)?.room : null;
    if (existing && friendRoom && friendRoom !== existing.room && friendRoom.freeSlot() >= 0) {
      const { room, member } = existing;
      if (member.ws && member.ws !== ws) { const old = member.ws; member.ws = null; old.close(4000, 'replaced'); }
      this.removeMember(room, member);
      existing = null;
    }
    if (existing) {
      const { room, member } = existing;
      if (member.ws && member.ws !== ws) { const old = member.ws; member.ws = null; old.close(4000, 'replaced'); }
      member.ws = ws;
      member.ghostUntil = 0;
      member.lastInput = now;
      room.welcome(member, null);
      room.broadcast({ t: 'join', member: member.publicInfo(this.db.likes(pid)), garden: publicGarden(member.state) }, member);
      return { room, member };
    }
    const raw = this.db.loadState(pid);
    const state = raw ? migrateState(raw, now) : freshState(now);
    const away = catchUp(state, state.lastSeen ?? now, this.ctx(pid, now));
    const room = friendRoom && friendRoom.freeSlot() >= 0 ? friendRoom : this.pickRoom();
    const slot = room.freeSlot();
    const member = new Member(pid, name, state, slot, now);
    member.ws = ws;
    room.slots[slot] = pid;
    room.members.set(pid, member);
    room.emptySince = 0;
    this.byPlayer.set(pid, { room, member });
    this.db.touch(pid, now);
    room.welcome(member, raw && away.away > 60_000 ? away : null);
    room.broadcast({ t: 'join', member: member.publicInfo(this.db.likes(pid)), garden: publicGarden(state) }, member);
    return { room, member };
  }

  /** Socket closed: keep the avatar and slot for a while so a quick reconnect resumes. */
  disconnect(pid, ws) {
    if (this.closed) return;
    const e = this.byPlayer.get(pid);
    if (!e || e.member.ws !== ws) return;
    e.member.ws = null;
    e.room.memes.leave(e.member);
    e.member.ghostUntil = this.now() + GHOST_MS;
    this.flushOne(e.member);
    e.room.broadcast({ t: 'ghost', slot: e.member.slot });
  }

  removeMember(room, m) {
    room.memes.leave(m);
    this.flushOne(m);
    room.members.delete(m.pid);
    room.slots[m.slot] = null;
    this.byPlayer.delete(m.pid);
    room.broadcast({ t: 'leave', slot: m.slot });
    if (!room.size) room.emptySince = this.now();
  }

  flushOne(m) {
    if (this.closed) return;
    this.db.saveStates([{ pid: m.pid, state: m.state }], this.now());
    this.db.touch(m.pid, this.now());
    m.dirty = false;
  }

  flush() {
    if (this.closed) return 0;
    const list = [];
    for (const r of this.rooms.values()) for (const m of r.members.values()) if (m.dirty) { list.push({ pid: m.pid, state: m.state }); m.dirty = false; }
    this.db.saveStates(list, this.now());
    return list.length;
  }

  tick() {
    const now = this.now();
    for (const r of [...this.rooms.values()]) {
      r.tick(now);
      if (!r.size && r.emptySince && now - r.emptySince > EMPTY_ROOM_MS) this.rooms.delete(r.id);
    }
  }

  broadcastPositions() { for (const r of this.rooms.values()) r.broadcastPositions(); }

  stats() {
    let players = 0;
    for (const r of this.rooms.values()) players += r.size;
    return { rooms: this.rooms.size, players };
  }
}
