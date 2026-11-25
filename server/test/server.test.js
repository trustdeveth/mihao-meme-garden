import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import WebSocket from 'ws';
import { createServer, readFeatured, parsePostUrl } from '../src/app.js';
import { toWorld, SIGNS, PLOT } from '@mg/shared/world/village-layout';

const START = Date.UTC(2026, 10, 10, 12);

async function boot(dbPath, clock, extra = {}) {
  const s = await createServer({ dbPath, secret: 'test-secret', now: () => clock.t, allowNoOrigin: true, tickMs: 50, posMs: 30, flushMs: 100000, ...extra });
  await s.app.listen({ port: 0, host: '127.0.0.1' });
  const port = s.app.server.address().port;
  return { ...s, base: `http://127.0.0.1:${port}`, ws: `ws://127.0.0.1:${port}/ws` };
}

async function guest(srv, cookie = null) {
  const r = await fetch(`${srv.base}/api/guest`, { method: 'POST', headers: cookie ? { cookie } : {} });
  const body = await r.json();
  const c = (r.headers.get('set-cookie') ?? '').split(';')[0] || cookie;
  return { ...body, cookie: c };
}

async function ticket(srv, cookie) {
  const r = await fetch(`${srv.base}/api/ws-ticket`, { method: 'POST', headers: { cookie } });
  return (await r.json()).ticket;
}

class Client {
  constructor(url) {
    this.msgs = [];
    this.waiters = [];
    this.seq = 0;
    this.ws = new WebSocket(url);
    this.ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      this.msgs.push(m);
      this.waiters = this.waiters.filter((w) => (w.pred(m) ? (w.resolve(m), false) : true));
    });
    this.open = new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); });
    this.closed = new Promise((res) => this.ws.on('close', (code) => res(code)));
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  waitFor(pred, ms = 3000) {
    const hit = this.msgs.find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const w = { pred, resolve };
      this.waiters.push(w);
      setTimeout(() => reject(new Error('timeout waiting for message')), ms);
    });
  }
  async act(a, p, id = ++this.seq) {
    this.send({ t: 'act', id, a, p });
    return this.waitFor((m) => m.t === 'res' && m.id === id && !m._seen && (m._seen = true));
  }
}

async function join(srv, who) {
  const c = new Client(`${srv.ws}?ticket=${await ticket(srv, who.cookie)}`);
  await c.open;
  c.send({ t: 'hello', v: 1 });
  c.welcome = await c.waitFor((m) => m.t === 'welcome');
  c.seq = c.welcome.lastSeq;
  return c;
}

/** Walk in small legal steps, advancing the fake clock. */
async function walk(c, clock, from, to) {
  const steps = Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 4);
  for (let i = 1; i <= steps; i++) {
    clock.t += 1000;
    c.send({ t: 'mv', x: from.x + ((to.x - from.x) * i) / steps, z: from.z + ((to.z - from.z) * i) / steps, ry: 0, an: 1 });
    await new Promise((r) => setTimeout(r, 15)); // let the server handle the step at this clock time
  }
}

test('multiplayer flow: join, plant, broadcast, idempotency, chat, likes, persistence, offline', async () => {
  const dir = mkdtempSync(pathJoin(tmpdir(), 'mg-'));
  const dbPath = pathJoin(dir, 'test.db');
  const clock = { t: START };
  let srv = await boot(dbPath, clock);
  try {
    const ga = await guest(srv), gb = await guest(srv);
    assert.ok(ga.recoveryCode && ga.name);
    const a = await join(srv, ga), b = await join(srv, gb);
    assert.equal(a.welcome.room.id, b.welcome.room.id, 'same room');
    assert.notEqual(a.welcome.you.slot, b.welcome.you.slot, 'different plots');
    assert.equal(b.welcome.room.members.length, 2);
    await a.waitFor((m) => m.t === 'join' && m.member.slot === b.welcome.you.slot);
    assert.equal(a.welcome.me.coins, 50);
    assert.equal(a.welcome.me.seeds.carrot, 3);

    // Out of reach: player spawns at the gate, soil centre is ~8 m away.
    const slotA = a.welcome.you.slot;
    const far = await a.act('plant', { crop: 'carrot', x: 0, z: 0 });
    assert.equal(far.code, 'far');

    // Walk into the garden and plant; B sees it.
    const gate = toWorld(slotA, 0, PLOT.gateZ + 1.6), inside = toWorld(slotA, 0, 2);
    await walk(a, clock, gate, inside);
    const planted = await a.act('plant', { crop: 'carrot', x: 0, z: 0 });
    assert.equal(planted.ok, true, `${planted.msg}`);
    assert.equal(planted.d.seeds.carrot, 2);
    const g = await b.waitFor((m) => m.t === 'g' && m.slot === slotA && m.up?.length);
    assert.equal(g.up[0].crop, 'carrot');
    assert.equal(g.up[0].fruit, null);

    // Too close to the first plant.
    const close = await a.act('plant', { crop: 'carrot', x: 0.5, z: 0 });
    assert.equal(close.code, 'too_close');

    // Idempotent replay: same id returns the same result without planting again.
    const id = a.seq;
    a.send({ t: 'act', id, a: 'plant', p: { crop: 'carrot', x: 1.3, z: 1 } });
    const replay = await a.waitFor((m) => m.t === 'res' && m.id === id && m !== close);
    assert.equal(replay.code, close.code);

    // Ripening is pushed by the room tick; harvest; ripe crop shows fruit to others.
    clock.t += 60_000;
    await b.waitFor((m) => m.t === 'g' && m.slot === slotA && m.up?.some((p) => p.fruit));
    const plantId = planted.d.plants[0].id;
    const h = await a.act('harvest', { id: plantId });
    assert.equal(h.ok, true, h.msg);
    assert.equal(h.d.basket.length, 1);

    // Chat: filtered, broadcast, rate limited.
    a.send({ t: 'chat', text: 'hello www.spam.com friends' });
    const line = await b.waitFor((m) => m.t === 'chat');
    assert.equal(line.text, 'hello [link] friends');
    for (let i = 0; i < 6; i++) a.send({ t: 'chat', text: `spam ${i}` });
    await a.waitFor((m) => m.t === 'toast' && m.key === 'chat_slow');

    // Likes: B walks to A's sign, likes once per day, no self-like.
    const slotB = b.welcome.you.slot;
    const bGate = toWorld(slotB, 0, PLOT.gateZ + 1.6);
    const aSign = toWorld(slotA, SIGNS.owner.x, SIGNS.owner.z + 2);
    await walk(b, clock, bGate, { x: bGate.x * 0.75, z: bGate.z * 0.75 });
    await walk(b, clock, { x: bGate.x * 0.75, z: bGate.z * 0.75 }, { x: aSign.x * 0.8, z: aSign.z * 0.8 });
    await walk(b, clock, { x: aSign.x * 0.8, z: aSign.z * 0.8 }, aSign);
    const liked = await b.act('like', { slot: slotA });
    assert.equal(liked.ok, true, liked.msg);
    await a.waitFor((m) => m.t === 'like' && m.slot === slotA && m.likes === 1);
    assert.equal((await b.act('like', { slot: slotA })).code, 'liked');
    assert.equal((await a.act('like', { slot: slotA })).code, 'bad_target');

    // Speed hack is corrected.
    b.send({ t: 'mv', x: 0, z: 40, ry: 0, an: 0 });
    await b.waitFor((m) => m.t === 'fix');

    // Reconnect keeps the slot.
    a.ws.close();
    await a.closed;
    await new Promise((r) => setTimeout(r, 30));
    const a2 = await join(srv, ga);
    assert.equal(a2.welcome.you.slot, slotA);
    assert.equal(a2.welcome.me.basket.length, 1);

    // Plant something, then stop the server for 2 hours: offline growth on the next login.
    const p2 = await a2.act('plant', { crop: 'carrot', x: -1, z: 0.5 });
    assert.equal(p2.ok, true, p2.msg);
    a2.ws.close(); b.ws.close();
    await srv.app.close();
    clock.t += 2 * 3_600_000;
    srv = await boot(dbPath, clock);
    const a3 = await join(srv, ga);
    assert.equal(a3.welcome.me.basket.length, 1, 'state survived the restart');
    assert.ok(a3.welcome.away, 'away summary sent');
    assert.equal(a3.welcome.away.ripened.length, 1);
    assert.ok(a3.welcome.me.plants.find((p) => p.id === p2.d.plants.at(-1).id).fruit);
    a3.ws.close();
  } finally {
    await srv.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bad tickets and origins are refused', async () => {
  const dir = mkdtempSync(pathJoin(tmpdir(), 'mg-'));
  const clock = { t: START };
  const srv = await boot(pathJoin(dir, 't.db'), clock);
  try {
    const c = new Client(`${srv.ws}?ticket=nope`);
    assert.equal(await c.closed, 4002);
    const g = await guest(srv);
    const t = await ticket(srv, g.cookie);
    clock.t += 60_000; // ticket expired
    const c2 = new Client(`${srv.ws}?ticket=${t}`);
    assert.equal(await c2.closed, 4002);
  } finally {
    await srv.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('meme layer: lines and moments are shared, duels need consent, locked poses are hidden, stamps are listed', async () => {
  const dir = mkdtempSync(pathJoin(tmpdir(), 'mg-meme-'));
  const clock = { t: START };
  const srv = await boot(pathJoin(dir, 'meme.db'), clock, { memeTiming: { beardMs: 40, pointWaitMs: 150, botTapMs: 40, windowMs: 600 } });
  try {
    const ga = await guest(srv), gb = await guest(srv);
    const a = await join(srv, ga), b = await join(srv, gb);
    const sa = a.welcome.you.slot, sb = b.welcome.you.slot;
    const tick = () => { clock.t += 2_000; };

    // lines and moments come from fixed lists only
    a.send({ t: 'meme', k: 'say', i: 1 });
    assert.equal((await b.waitFor((m) => m.t === 'meme' && m.k === 'say')).i, 1);
    a.send({ t: 'meme', k: 'say', i: 999 });
    a.send({ t: 'meme', k: 'say', i: 'free text' });
    a.send({ t: 'meme', k: 'moment', id: '__proto__' });
    tick();
    a.send({ t: 'meme', k: 'moment', id: 'rain' });
    assert.equal((await b.waitFor((m) => m.t === 'meme' && m.k === 'moment')).id, 'rain');
    assert.equal(b.msgs.filter((m) => m.t === 'meme').length, 2, 'bad lines and moments were dropped');

    // a locked pose is not shown to others
    const me = a.welcome.room.members.find((m) => m.slot === sa);
    a.send({ t: 'mv', x: me.x, z: me.z, ry: 1, an: 13 });
    const hidden = await b.waitFor((m) => m.t === 'pos' && m.n.some((n) => n[0] === sa));
    assert.equal(hidden.n.find((n) => n[0] === sa)[4], 0);

    // far apart: no challenge
    tick();
    a.send({ t: 'meme', k: 'duel', kind: 'beard', slot: sb });
    await a.waitFor((m) => m.t === 'toast' && /closer/.test(m.msg));

    // bring them together on the server, then invite: nothing starts until B accepts
    const room = srv.rooms.rooms.values().next().value;
    const ma = room.memes.memberAt(sa), mb = room.memes.memberAt(sb);
    Object.assign(mb.pos, { x: ma.pos.x + 1, z: ma.pos.z });
    tick();
    a.send({ t: 'meme', k: 'duel', kind: 'beard', slot: sb });
    await b.waitFor((m) => m.t === 'duel' && m.ev === 'invite');
    assert.ok(!a.msgs.some((m) => m.t === 'duel' && m.ev === 'start'));
    const coins = ma.state.coins + mb.state.coins;
    b.send({ t: 'meme', k: 'accept' });
    const result = await a.waitFor((m) => m.t === 'duel' && m.ev === 'result');
    assert.notEqual(result.values[0], result.values[1]);
    assert.equal(result.winner, result.values[0] > result.values[1] ? sa : sb);
    const winner = result.winner === sa ? ma : mb;
    assert.equal(winner.state.meme.points, 5);
    assert.equal(ma.state.coins + mb.state.coins, coins, 'no coins change hands');
    assert.equal(winner.state.sp?.points ?? 0, 0, 'no Season Points');

    // pointing before the signal loses
    clock.t += 60_000;
    a.msgs.length = 0; b.msgs.length = 0;
    a.send({ t: 'meme', k: 'duel', kind: 'point', slot: sb });
    await b.waitFor((m) => m.t === 'duel' && m.ev === 'invite');
    b.send({ t: 'meme', k: 'accept' });
    const started = await a.waitFor((m) => m.t === 'duel' && m.ev === 'start');
    a.send({ t: 'meme', k: 'tap', duel: started.id });
    const early = await a.waitFor((m) => m.t === 'duel' && m.ev === 'result');
    assert.equal(early.reason, 'early');
    assert.equal(early.winner, sb);

    // against Gus: only near the market
    clock.t += 60_000;
    a.msgs.length = 0;
    a.send({ t: 'meme', k: 'duel', kind: 'beard', slot: -1 });
    await a.waitFor((m) => m.t === 'toast' && /Gus/.test(m.msg));

    // the weekly challenge and the stamp guestbook
    const ch = await (await fetch(`${srv.base}/api/challenge`)).json();
    assert.ok(ch.title && ch.tag && Array.isArray(ch.featured));
    srv.db.like(ma.pid, mb.pid, '2026-11-10');
    const st = await (await fetch(`${srv.base}/api/stamps`, { headers: { cookie: ga.cookie } })).json();
    assert.equal(st.list[0].name, gb.name);
    assert.equal((await fetch(`${srv.base}/api/stamps`)).status, 401);
    a.ws.close(); b.ws.close();
  } finally {
    await srv.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('featured challenge posts: only this week and only links to posts on X', () => {
  const dir = mkdtempSync(pathJoin(tmpdir(), 'mg-feat-'));
  try {
    const file = pathJoin(dir, 'featured.json');
    assert.deepEqual(readFeatured(file, '2026-11-23'), []);
    writeFileSync(file, JSON.stringify([
      { week: '2026-11-23', title: 'good', by: 'a', url: 'https://x.com/someone/status/123' },
      { week: '2026-11-23', title: 'bad host', url: 'https://x.com.evil.example/a/status/1' },
      { week: '2026-11-23', title: 'script', url: 'javascript:alert(1)' },
      { week: '2026-11-16', title: 'old', url: 'https://x.com/someone/status/9' },
    ]));
    assert.deepEqual(readFeatured(file, '2026-11-23').map((f) => f.title), ['good']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('post links: only a single post on X is accepted, and it is tidied', () => {
  assert.deepEqual(parsePostUrl(' https://twitter.com/some_one/status/12345?s=20 '), { postId: '12345', url: 'https://x.com/some_one/status/12345' });
  assert.equal(parsePostUrl('https://www.x.com/a/status/9/video/1').url, 'https://x.com/a/status/9');
  for (const bad of ['http://x.com/a/status/1', 'https://x.com.evil.example/a/status/1', 'https://evil.example/https://x.com/a/status/1', 'https://x.com/a', 'https://x.com@evil.example/a/status/1', 'javascript:alert(1)', 'https://x.com/a/status/abc', null]) assert.equal(parsePostUrl(bad), null, String(bad));
});

test('challenge entries: sent in the game, hidden until a moderator features them', async () => {
  const dir = mkdtempSync(pathJoin(tmpdir(), 'mg-entry-'));
  const clock = { t: START };
  const srv = await boot(pathJoin(dir, 'entry.db'), clock, { featuredPath: pathJoin(dir, 'none.json') });
  try {
    const ga = await guest(srv), gb = await guest(srv);
    const get = async (who) => (await fetch(`${srv.base}/api/challenge`, { headers: who ? { cookie: who.cookie } : {} })).json();
    const send = (who, body) => fetch(`${srv.base}/api/challenge/entry`, { method: 'POST', headers: { 'content-type': 'application/json', ...(who ? { cookie: who.cookie } : {}) }, body: JSON.stringify(body) });

    assert.equal((await send(null, { url: 'https://x.com/a/status/1' })).status, 401);
    assert.equal((await send(ga, { url: 'https://example.com/video' })).status, 400);
    assert.equal((await send(ga, { url: 'https://x.com/a/status/1', title: 'see www.spam.com now' })).status, 200);
    let mine = (await get(ga)).mine;
    assert.equal(mine.status, 'pending');
    assert.ok(!mine.title.includes('spam.com'), 'titles go through the chat filter');
    assert.deepEqual((await get(gb)).featured, [], 'not public before review');
    assert.equal((await get(gb)).mine, null);
    assert.equal((await send(gb, { url: 'https://twitter.com/zzz/status/1' })).status, 409, 'same post, other player');

    // a new link replaces the old one while it waits
    assert.equal((await send(ga, { url: 'https://x.com/a/status/2', title: 'my clip' })).status, 200);
    const rows = srv.db.listEntries(null, 'pending');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].url, 'https://x.com/a/status/2');

    assert.ok(srv.db.setEntryStatus(rows[0].id, 'featured'));
    const pub = await get(null);
    assert.deepEqual(pub.featured, [{ title: 'my clip', by: ga.name, url: 'https://x.com/a/status/2' }]);
    assert.equal((await send(ga, { url: 'https://x.com/a/status/3' })).status, 409, 'a featured entry cannot be swapped out');
    srv.db.setEntryStatus(rows[0].id, 'rejected');
    assert.deepEqual((await get(null)).featured, []);

    // rate limit: a handful of tries, then wait
    let limited = false;
    for (let i = 0; i < 8; i++) if ((await send(ga, { url: `https://x.com/a/status/${100 + i}` })).status === 429) limited = true;
    assert.ok(limited);
  } finally {
    await srv.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
