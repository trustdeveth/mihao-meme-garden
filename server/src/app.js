// HTTP API + WebSocket endpoint. Guests get an httpOnly session cookie; the socket uses a short-lived ticket.
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import { randomUUID, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { challengeOfWeek } from '@mg/shared/rules/memes';
import { CHALLENGE_TAG } from '@mg/shared/data/memes';
import { z } from 'zod';
import { openDb } from './db.js';
import { RoomManager } from './rooms.js';
import { registerChain, chainConfig } from './chain.js';
import { registerShare } from './share.js';
import { sha256, token, recoveryCode, normalizeRecovery, guestName, makeTicket, readTicket, Bucket, cleanChat } from './security.js';

const SESSION_COOKIE = 'mg_session';

/** A link to one post on X, in a tidy form. Anything else gives null. */
export function parsePostUrl(raw) {
  const m = /^https:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(\w{1,15})\/status\/(\d{1,25})(?:[/?#].*)?$/.exec(String(raw ?? '').trim());
  return m ? { postId: m[2], url: `https://x.com/${m[1]}/status/${m[2]}` } : null;
}

/**
 * Featured weekly-challenge posts, picked by a moderator: a JSON list of {week, title, by, url}.
 * Only links to posts on X are passed on; anything else (or a broken file) is ignored.
 */
export function readFeatured(file, week) {
  let list;
  try { list = JSON.parse(readFileSync(file, 'utf8')); } catch { return []; }
  if (!Array.isArray(list)) return [];
  return list
    .filter((f) => f && f.week === week && typeof f.url === 'string' && /^https:\/\/(x|twitter)\.com\/\w+\/status\/\d+/.test(f.url))
    .slice(0, 10)
    .map((f) => ({ title: String(f.title ?? '').slice(0, 80), by: String(f.by ?? '').slice(0, 40), url: f.url.slice(0, 200) }));
}
const SESSION_MS = 365 * 86_400_000;

/**
 * @param {{dbPath?:string, secret?:string, now?:()=>number, origins?:string[], allowNoOrigin?:boolean,
 *          staticDir?:string, logger?:boolean, tickMs?:number, posMs?:number, flushMs?:number}} opts
 */
export async function createServer(opts = {}) {
  const now = opts.now ?? (() => Date.now());
  const db = openDb(opts.dbPath ?? 'data/meme-garden.db');
  const secret = opts.secret ?? process.env.MG_SECRET ?? db.meta('dev_secret') ?? (() => {
    const s = randomBytes(32).toString('hex');
    db.setMeta('dev_secret', s);
    return s;
  })();
  let seed = Number(db.meta('world_seed'));
  if (!Number.isInteger(seed) || seed <= 0) { seed = randomBytes(4).readUInt32LE(0) || 1; db.setMeta('world_seed', seed); }

  const rooms = new RoomManager({ db, seed, secret, now, memeTiming: opts.memeTiming });
  const origins = new Set(opts.origins ?? ['http://127.0.0.1:5190', 'http://localhost:5190', 'http://127.0.0.1:8850', 'http://localhost:8850']);
  const guestLimit = new Map(); // ip -> Bucket

  const app = Fastify({ logger: opts.logger ?? false, trustProxy: true, bodyLimit: 16 * 1024 });
  await app.register(cookie);
  await app.register(websocket, { options: { maxPayload: 4096 } });

  const cookieOpts = { path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: SESSION_MS / 1000 };

  function startSession(reply, pid) {
    const raw = token();
    db.createSession(sha256(raw), pid, now(), now() + SESSION_MS);
    reply.setCookie(SESSION_COOKIE, raw, cookieOpts);
  }
  function sessionPlayer(req) {
    const raw = req.cookies?.[SESSION_COOKIE];
    if (!raw) return null;
    const s = db.session(sha256(raw), now());
    if (!s) return null;
    const p = db.player(s.player_id);
    return p && !p.banned ? p : null;
  }

  app.get('/api/health', async () => ({ ok: true, ...rooms.stats() }));

  app.post('/api/guest', async (req, reply) => {
    const ip = req.ip;
    if (!guestLimit.has(ip)) guestLimit.set(ip, new Bucket(opts.guestRate ?? 1 / 30, opts.guestBurst ?? 5));
    if (!guestLimit.get(ip).take(now())) return reply.code(429).send({ error: 'Too many new gardens from here. Try again soon.' });
    const existing = sessionPlayer(req);
    if (existing) return { playerId: existing.id, name: existing.name, recoveryCode: null };
    const pid = randomUUID();
    const code = recoveryCode();
    const name = guestName();
    db.createPlayer({ id: pid, name, now: now(), recoveryHash: sha256(normalizeRecovery(code)) });
    startSession(reply, pid);
    return { playerId: pid, name, recoveryCode: code };
  });

  const recoverBody = z.object({ recoveryCode: z.string().min(8).max(40) });
  app.post('/api/session/recover', async (req, reply) => {
    const parsed = recoverBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Enter your recovery code.' });
    const p = db.playerByRecovery(sha256(normalizeRecovery(parsed.data.recoveryCode)));
    if (!p) return reply.code(404).send({ error: 'That code was not found.' });
    startSession(reply, p.id);
    return { playerId: p.id, name: p.name };
  });

  const makeCode = () => recoveryCode().replace(/-/g, '').slice(0, 6);

  app.get('/api/me', async (req, reply) => {
    const p = sessionPlayer(req);
    if (!p) return reply.code(401).send({ error: 'No session.' });
    return { playerId: p.id, name: p.name, friendCode: db.friendCode(p.id, makeCode) };
  });

  // ---- friends ----
  app.get('/api/friends', async (req, reply) => {
    const p = sessionPlayer(req);
    if (!p) return reply.code(401).send({ error: 'No session.' });
    const mine = rooms.byPlayer.get(p.id)?.room;
    return {
      code: db.friendCode(p.id, makeCode),
      friends: db.friends(p.id).map((f) => {
        const e = rooms.byPlayer.get(f.id);
        return { id: f.id, name: f.name, online: !!e?.member.ws, room: e?.room.id ?? null, sameRoom: !!e && e.room === mine, roomFull: e ? e.room.freeSlot() < 0 : false };
      }),
    };
  });
  const codeBody = z.object({ code: z.string().min(4).max(12) });
  app.post('/api/friends/add', async (req, reply) => {
    const p = sessionPlayer(req);
    if (!p) return reply.code(401).send({ error: 'No session.' });
    const parsed = codeBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Enter a friend code.' });
    const other = db.playerByCode(parsed.data.code.toUpperCase().replace(/[^A-Z0-9]/g, ''));
    if (!other || other.id === p.id) return reply.code(404).send({ error: 'No gardener has that code.' });
    db.befriend(p.id, other.id, now());
    return { ok: true, name: other.name };
  });
  app.post('/api/friends/remove', async (req, reply) => {
    const p = sessionPlayer(req);
    if (!p) return reply.code(401).send({ error: 'No session.' });
    db.unfriend(p.id, String(req.body?.id ?? ''));
    return { ok: true };
  });

  // ---- meme layer: the guestbook of "mihao" stamps and the weekly challenge ----
  app.get('/api/stamps', async (req, reply) => {
    const p = sessionPlayer(req);
    if (!p) return reply.code(401).send({ error: 'No session.' });
    return { total: db.likes(p.id), list: db.stamps(p.id) };
  });
  const featuredFile = opts.featuredPath ?? resolve(dirname(fileURLToPath(import.meta.url)), '../data/featured.json');
  app.get('/api/challenge', async (req) => {
    const c = challengeOfWeek(now());
    // approved entries from the game, then any added by hand to featured.json (each post once)
    const featured = [...db.featuredEntries(c.week), ...readFeatured(featuredFile, c.week)].filter((f, i, all) => all.findIndex((o) => o.url === f.url) === i).slice(0, 10);
    const p = sessionPlayer(req);
    const e = p ? db.challengeEntry(c.week, p.id) : null;
    return { ...c, tag: CHALLENGE_TAG, featured, mine: e ? { url: e.url, title: e.title, status: e.status } : null };
  });
  // players send in a link to their post; nothing is shown to others until a moderator approves it
  const entryLimit = new Map(); // player id -> Bucket
  const entryBody = z.object({ url: z.string().min(10).max(200), title: z.string().max(120).optional() });
  app.post('/api/challenge/entry', async (req, reply) => {
    const p = sessionPlayer(req);
    if (!p) return reply.code(401).send({ error: 'No session.' });
    if (!entryLimit.has(p.id)) entryLimit.set(p.id, new Bucket(6 / 3600, 6));
    if (!entryLimit.get(p.id).take(now())) return reply.code(429).send({ error: 'Too many tries. Wait a while and send it again.' });
    const parsed = entryBody.safeParse(req.body);
    const post = parsed.success ? parsePostUrl(parsed.data.url) : null;
    if (!post) return reply.code(400).send({ error: 'Paste the link to your post on X, like https://x.com/name/status/123.' });
    const c = challengeOfWeek(now());
    const title = cleanChat(parsed.data.title)?.slice(0, 80) ?? c.title; // cleanChat gives null for an empty title
    const r = db.submitEntry(c.week, p.id, post.postId, post.url, title, now());
    if (r === 'featured') return reply.code(409).send({ error: 'Your entry is already featured this week.' });
    if (r === 'taken') return reply.code(409).send({ error: 'Someone already entered that post.' });
    return { ok: true, mine: { url: post.url, title, status: 'pending' } };
  });

  // pictures for "Post to X" (see share.js)
  await registerShare(app, { db, sessionPlayer, now, origins, publicUrl: opts.publicUrl ?? process.env.MG_PUBLIC_URL, enabled: (opts.share ?? process.env.MG_SHARE) !== '0' });

  app.post('/api/ws-ticket', async (req, reply) => {
    const p = sessionPlayer(req);
    if (!p) return reply.code(401).send({ error: 'No session.' });
    return { ticket: makeTicket(secret, p.id, now()) };
  });

  app.get('/ws', { websocket: true }, (socket, req) => {
    const origin = req.headers.origin;
    if (origin ? !origins.has(origin) : !opts.allowNoOrigin) { socket.close(4003, 'origin'); return; }
    const t = readTicket(secret, req.query?.ticket, now());
    const player = t && db.player(t.pid);
    if (!player || player.banned) { socket.close(4002, 'ticket'); return; }
    let joined = null;
    socket.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(String(data)); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      if (!joined) {
        if (msg.t !== 'hello') return;
        const join = typeof req.query?.join === 'string' ? req.query.join.slice(0, 64) : null;
        joined = rooms.connect(player.id, player.name, socket, join);
        return;
      }
      const e = rooms.byPlayer.get(player.id);
      if (!e || e.member.ws !== socket) return;
      try { e.room.onMessage(e.member, msg); } catch (err) { app.log.error(err); }
    });
    socket.on('close', () => { if (joined) rooms.disconnect(player.id, socket); });
    socket.on('error', () => {});
  });

  if (opts.staticDir && existsSync(opts.staticDir)) {
    const fstatic = (await import('@fastify/static')).default;
    await app.register(fstatic, { root: opts.staticDir, wildcard: true, maxAge: '1h', preCompressed: true });
    app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api') ? reply.code(404).send({ error: 'Not found' }) : reply.sendFile('index.html')));
  }

  const timers = [
    setInterval(() => rooms.tick(), opts.tickMs ?? 1000),
    setInterval(() => rooms.broadcastPositions(), opts.posMs ?? 100),
    setInterval(() => rooms.flush(), opts.flushMs ?? 5000),
    setInterval(() => db.pruneChat(now() - 7 * 86_400_000), 3_600_000),
  ];

  app.addHook('onClose', async () => {
    timers.forEach(clearInterval);
    rooms.flush();
    rooms.closed = true;
    db.close();
  });

  const chain = registerChain(app, { db, rooms, sessionPlayer, now, config: opts.chain ?? chainConfig() });
  return { app, rooms, db, seed, chain };
}
