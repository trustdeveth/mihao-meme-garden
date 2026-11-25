// Guest session, reconnecting WebSocket and the client-side mirror of server state.
import { CROP } from '@mg/shared/data/crops';
import { publicGarden } from '@mg/shared/rules/public';

async function api(path, body) {
  const r = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error ?? `HTTP ${r.status}`), { status: r.status });
  return data;
}

/** Make sure we have a guest session. Returns {playerId, name, recoveryCode?}. */
export async function ensureSession() {
  try { return await api('/api/me'); } catch (e) { if (e.status !== 401) throw e; }
  return api('/api/guest', {});
}
export const recover = (code) => api('/api/session/recover', { recoveryCode: code });

/** Tiny event emitter. */
export class Emitter {
  constructor() { this.h = new Map(); }
  on(ev, fn) { (this.h.get(ev) ?? this.h.set(ev, new Set()).get(ev)).add(fn); return () => this.h.get(ev).delete(fn); }
  emit(ev, ...a) { for (const fn of this.h.get(ev) ?? []) fn(...a); }
}

/**
 * Reconnecting socket. Actions get increasing ids; unanswered ones are re-sent with the same id after a
 * reconnect, and the server answers replays from its cache, so nothing is applied twice.
 */
export class Socket extends Emitter {
  constructor(playerId) {
    super();
    this.key = `mg-seq-${playerId}`;
    this.seq = Number(sessionStorage.getItem(this.key) ?? 0);
    this.pending = new Map(); // id -> {a, p, resolve}
    this.status = 'connecting';
    this.backoff = 500;
    this.ws = null;
  }
  async connect() {
    this.setStatus('connecting');
    let ticket;
    try { ({ ticket } = await api('/api/ws-ticket', {})); } catch { return this.retry(); }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    // VITE_WS_URL (e.g. wss://game-api.example.com/ws) when the client is hosted apart from the game server
    // (Vercel cannot forward WebSockets); otherwise the same host that served the page
    const wsBase = import.meta.env.VITE_WS_URL || `${proto}://${location.host}/ws`;
    const ws = new WebSocket(`${wsBase}?ticket=${encodeURIComponent(ticket)}${this.joinTarget ? `&join=${encodeURIComponent(this.joinTarget)}` : ''}`);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', v: 1 }));
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'welcome') {
        this.backoff = 500;
        this.joinTarget = null;
        this.seq = Math.max(this.seq, m.lastSeq ?? 0);
        this.setStatus('online');
        this.emit('welcome', m);
        for (const [id, p] of this.pending) ws.send(JSON.stringify({ t: 'act', id, a: p.a, p: p.p }));
        return;
      }
      if (m.t === 'res') {
        const p = this.pending.get(m.id);
        if (p) { this.pending.delete(m.id); p.resolve(m); }
        this.emit('res', m);
        return;
      }
      this.emit(m.t, m);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (e.code === 4000) { this.setStatus('replaced'); return; } // opened in another tab
      if (e.code === 4001) { this.setStatus('idle'); return; }
      this.retry();
    };
  }
  retry() {
    this.setStatus('offline');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.connect(), this.backoff);
    this.backoff = Math.min(8000, this.backoff * 2);
  }
  /** Reconnect into a friend's village room. */
  join(friendId) {
    this.joinTarget = friendId;
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000, 'join');
    this.connect();
  }
  setStatus(s) { this.status = s; this.emit('status', s); }
  raw(m) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m)); }
  /** Send an action; resolves with the server's result. */
  act(a, p = {}) {
    const id = ++this.seq;
    sessionStorage.setItem(this.key, String(this.seq));
    return new Promise((resolve) => {
      this.pending.set(id, { a, p, resolve });
      this.raw({ t: 'act', id, a, p });
    });
  }
}

/** Mirror of what the server told us. */
export class Store extends Emitter {
  constructor() {
    super();
    this.me = null; // private state
    this.you = null; // {slot, name}
    this.gardens = new Map(); // slot -> {soil, plants: Map(id->plant), effects}
    this.members = new Map(); // slot -> public member info
    this.seed = 0;
    this.offset = 0; // serverNow - Date.now()
    this.liked = new Set();
    this.roomId = '';
  }
  now() { return Date.now() + this.offset; }
  welcome(m) {
    this.you = m.you;
    this.me = m.me;
    this.seed = m.clock.seed;
    this.offset = m.clock.now - Date.now();
    this.roomId = m.room.id;
    this.members = new Map(m.room.members.map((x) => [x.slot, x]));
    this.gardens = new Map(Object.entries(m.gardens).map(([slot, g]) => [Number(slot), this.toGarden(g)]));
    this.liked = new Set(m.liked ?? []);
    this.emit('reset');
  }
  toGarden(g) { return { soil: g.soil, plants: new Map(g.plants.map((p) => [p.id, p])), effects: g.effects ?? [], home: g.home ?? 0, decor: g.decor ?? [], pets: g.pets ?? [], eggs: g.eggs ?? [] }; }
  /** A garden view usable by the shared growth functions. */
  gardenState(slot) {
    const g = this.gardens.get(slot);
    return g ? { effects: g.effects, plants: [...g.plants.values()], soil: g.soil } : null;
  }
  applyDelta(d) {
    if (!d || !this.me) return;
    for (const [k, v] of Object.entries(d)) this.me[k] = v;
    if (['plants', 'effects', 'soil', 'home', 'decor', 'pets', 'eggs'].some((k) => k in d)) {
      this.gardens.set(this.you.slot, this.toGarden(publicGarden(this.me)));
      this.emit('garden', this.you.slot);
    }
    this.emit('me');
  }
  applyGarden(m) {
    const g = this.gardens.get(m.slot) ?? { soil: 0, plants: new Map(), effects: [] };
    for (const p of m.up ?? []) g.plants.set(p.id, p);
    for (const id of m.rm ?? []) g.plants.delete(id);
    if (m.effects) g.effects = m.effects;
    if (m.soil !== undefined) g.soil = m.soil;
    for (const k of ['home', 'decor', 'pets', 'eggs']) if (m[k] !== undefined) g[k] = m[k];
    this.gardens.set(m.slot, g);
    this.emit('garden', m.slot);
  }
  seedCount(id) { return this.me?.seeds?.[id] ?? 0; }
  cropName(id) { return CROP[id]?.name ?? id; }
}
