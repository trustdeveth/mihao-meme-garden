// "Connect X": a player proves which X account is theirs (OAuth 2.0 with PKCE), and an account on the gift
// list unlocks its admin cat: wear it in the game and download the gift zip. Off unless configured.
//
// The game reads only the account's id and username. It never posts, and keeps no X token.
//
// MG_X_CLIENT_ID, MG_X_CLIENT_SECRET (confidential apps), MG_X_REDIRECT_URI  -> real sign-in
// MG_X_MOCK=1  -> a pretend sign-in page for testing on this computer only; never in production
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, existsSync, createReadStream, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminCat, ADMIN_CATS } from '@mg/shared/data/admin-cats';
import { Bucket } from './security.js';

const here = dirname(fileURLToPath(import.meta.url));
const AUTHORIZE = 'https://x.com/i/oauth2/authorize';
const TOKEN = 'https://api.x.com/2/oauth2/token';
const ME = 'https://api.x.com/2/users/me';
const PENDING_MS = 10 * 60_000;
const USERNAME = /^\w{1,15}$/;
export const LOCAL_REDIRECT = 'http://127.0.0.1:5190/api/x/callback';

export function xConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  if (env.MG_X_CLIENT_ID) {
    const redirectUri = env.MG_X_REDIRECT_URI || (production ? '' : LOCAL_REDIRECT);
    if (!redirectUri) throw new Error('MG_X_REDIRECT_URI is required with MG_X_CLIENT_ID in production');
    return { mode: 'real', clientId: env.MG_X_CLIENT_ID, clientSecret: env.MG_X_CLIENT_SECRET || null, redirectUri };
  }
  if (env.MG_X_MOCK === '1' && !production) return { mode: 'mock' };
  return { mode: 'off' };
}

/** The gift list, read fresh each time so edits apply without a restart. Names are matched without case. */
export function readGifts(file) {
  let data;
  try { data = JSON.parse(readFileSync(file, 'utf8')); } catch { return new Map(); }
  return new Map(Object.entries(data?.accounts ?? {}).filter(([name]) => USERNAME.test(name)).map(([name, cat]) => [name.toLowerCase(), adminCat(cat)?.id ?? null]));
}

/**
 * The pretend sign-in must be unreachable from outside: the connection has to come from this computer, ask for a
 * local address, and not have passed through a proxy that adds forwarding headers (as the live site's does).
 */
export function isThisComputer(req) {
  const from = req.raw.socket?.remoteAddress ?? '';
  const host = String(req.headers.host ?? '').replace(/:\d+$/, '');
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(from) && ['127.0.0.1', 'localhost', '[::1]'].includes(host)
    && !['x-forwarded-for', 'x-forwarded-host', 'forwarded', 'x-real-ip'].some((h) => req.headers[h] !== undefined);
}

const b64 = (buf) => buf.toString('base64url');

export function registerX(app, { db, rooms, sessionPlayer, now, config, giftsFile, giftsDir, fetchImpl = fetch }) {
  const sql = db.raw;
  sql.exec(`
    CREATE TABLE IF NOT EXISTS x_links (player_id TEXT PRIMARY KEY, x_id TEXT NOT NULL UNIQUE, username TEXT NOT NULL, linked_at INTEGER NOT NULL,
      mock INTEGER NOT NULL, test_cat TEXT, wearing INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS x_pins (handle TEXT PRIMARY KEY, x_id TEXT NOT NULL, at INTEGER NOT NULL);
  `);
  const q = {
    link: sql.prepare('SELECT * FROM x_links WHERE player_id = ?'),
    byX: sql.prepare('SELECT * FROM x_links WHERE x_id = ?'),
    put: sql.prepare('INSERT INTO x_links(player_id, x_id, username, linked_at, mock, test_cat, wearing) VALUES(?, ?, ?, ?, ?, ?, ?)'),
    drop: sql.prepare('DELETE FROM x_links WHERE player_id = ?'),
    wear: sql.prepare('UPDATE x_links SET wearing = ? WHERE player_id = ?'),
    pin: sql.prepare('SELECT x_id FROM x_pins WHERE handle = ?'),
    addPin: sql.prepare('INSERT OR IGNORE INTO x_pins(handle, x_id, at) VALUES(?, ?, ?)'),
  };
  const mock = config.mode === 'mock';
  const file = giftsFile ?? resolve(here, '../x-gifts.json');
  const zips = giftsDir ?? resolve(here, '../../output/gifts');
  const zipFor = (cat) => resolve(zips, `mihao-gift-${String(cat.number).padStart(2, '0')}-${cat.id}.zip`);

  /** The player's link, if it was made in the mode the server runs in now: pretend links never count for real. */
  const linkOf = (pid) => { const l = config.mode === 'off' ? null : q.link.get(pid); return l && !!l.mock === mock ? l : null; };

  /** What this link is entitled to. */
  function entitlement(link) {
    const handle = link.username.toLowerCase();
    const gifts = readGifts(file);
    if (!gifts.has(handle)) return { listed: false, taken: false, cat: null };
    // a username can be given up and taken by someone else: the first account to claim a listed name keeps it
    const pin = mock ? null : q.pin.get(handle);
    if (pin && pin.x_id !== link.x_id) return { listed: true, taken: true, cat: null };
    return { listed: true, taken: false, cat: adminCat(gifts.get(handle) ?? (mock ? link.test_cat : null)) };
  }

  /** The cat other players see on this player, or null. */
  function giftOf(pid) {
    const l = linkOf(pid);
    return l?.wearing ? entitlement(l).cat?.id ?? null : null;
  }

  /** Tell the village when a player's look changes. */
  function refresh(pid) {
    const e = rooms.byPlayer.get(pid);
    if (!e) return;
    const gift = giftOf(pid);
    if (e.member.gift === gift) return;
    e.member.gift = gift;
    e.room.broadcast({ t: 'gift', slot: e.member.slot, gift });
  }

  function save(pid, { id, username, testCat = null }) {
    const before = q.byX.get(id); // the gift follows the X account: linking it here unlinks it from another garden
    q.drop.run(pid);
    if (before) q.drop.run(before.player_id);
    q.put.run(pid, id, username, now(), mock ? 1 : 0, testCat, 0);
    if (!mock && readGifts(file).has(username.toLowerCase())) q.addPin.run(username.toLowerCase(), id, now());
    db.audit(pid, now(), 'x_link', { username, mock });
    if (before && before.player_id !== pid) refresh(before.player_id);
    refresh(pid);
  }

  const pending = new Map(); // state -> {pid, verifier, expires}
  const limits = new Map(); // player id -> Bucket
  function takePending(req, state) {
    const p = pending.get(String(state ?? ''));
    if (!p) return null;
    const player = sessionPlayer(req);
    // the sign-in must come back to the same garden that started it, so nobody can be linked to a stranger's X
    if (!player || player.id !== p.pid) return null;
    pending.delete(String(state));
    return p.expires > now() ? p : null;
  }
  const back = (reply, result) => reply.header('cache-control', 'no-store').redirect(`/?x=${result}`);
  const needPlayer = (req, reply) => {
    if (config.mode === 'off') { reply.code(404).send({ error: 'Connect X is not switched on.' }); return null; }
    const p = sessionPlayer(req);
    if (!p) reply.code(401).send({ error: 'No session.' });
    return p;
  };

  app.get('/api/x/status', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    if (config.mode === 'off') return { enabled: false };
    const p = sessionPlayer(req);
    const l = p ? linkOf(p.id) : null;
    if (!l) return { enabled: true, mock, linked: null, listed: false, taken: false, gift: null, wearing: false };
    const e = entitlement(l);
    return {
      enabled: true, mock, linked: { username: l.username }, listed: e.listed, taken: e.taken,
      gift: e.cat ? { id: e.cat.id, name: e.cat.name, download: existsSync(zipFor(e.cat)) } : null,
      wearing: !!(e.cat && l.wearing),
    };
  });

  app.post('/api/x/start', async (req, reply) => {
    const p = needPlayer(req, reply);
    if (!p) return reply;
    if (mock && !isThisComputer(req)) return reply.code(403).send({ error: 'The test sign-in works only on the computer that runs the game.' });
    if (!limits.has(p.id)) limits.set(p.id, new Bucket(1 / 30, 8));
    if (!limits.get(p.id).take(now())) return reply.code(429).send({ error: 'Too many tries. Wait a moment.' });
    for (const [k, v] of pending) if (v.pid === p.id || v.expires <= now()) pending.delete(k);
    const state = b64(randomBytes(24)), verifier = b64(randomBytes(48));
    pending.set(state, { pid: p.id, verifier, expires: now() + PENDING_MS });
    if (mock) return { url: `/api/x/mock?state=${state}` };
    const url = new URL(AUTHORIZE);
    url.search = new URLSearchParams({
      response_type: 'code', client_id: config.clientId, redirect_uri: config.redirectUri, scope: 'tweet.read users.read', state,
      code_challenge: b64(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
    }).toString();
    return { url: url.toString() };
  });

  app.get('/api/x/callback', async (req, reply) => {
    if (config.mode !== 'real') return reply.code(404).send({ error: 'Not found' });
    const p = takePending(req, req.query?.state);
    if (!p) return back(reply, 'expired');
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (req.query.error || !code) return back(reply, 'cancelled');
    try {
      const form = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: config.redirectUri, code_verifier: p.verifier });
      const headers = { 'content-type': 'application/x-www-form-urlencoded' };
      if (config.clientSecret) headers.authorization = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`;
      else form.set('client_id', config.clientId);
      const tokenRes = await fetchImpl(TOKEN, { method: 'POST', headers, body: form.toString(), signal: AbortSignal.timeout(15_000) });
      const grant = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok || !grant.access_token) throw new Error(`token request failed (${tokenRes.status})`);
      const meRes = await fetchImpl(ME, { headers: { authorization: `Bearer ${grant.access_token}` }, signal: AbortSignal.timeout(15_000) });
      const me = (await meRes.json().catch(() => ({}))).data;
      if (!meRes.ok || !/^\d{1,25}$/.test(me?.id ?? '') || !USERNAME.test(me?.username ?? '')) throw new Error(`user request failed (${meRes.status})`);
      save(p.pid, { id: me.id, username: me.username });
      return back(reply, 'connected');
    } catch (e) {
      console.error('Connect X:', e.message); // never the code or a token
      return back(reply, 'failed');
    }
  });

  if (mock) {
    const page = (state) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Test sign-in</title>
<style>body{font:18px system-ui,sans-serif;background:#2a0f10;color:#fff6df;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
form{background:#fff6df;color:#2a1a10;border-radius:16px;padding:24px;max-width:460px}b.warn{display:block;background:#b3181b;color:#fff;border-radius:8px;padding:10px;margin-bottom:12px}
input,select,button{font:inherit;width:100%;box-sizing:border-box;padding:10px;margin:6px 0 14px;border:3px solid #4a2c14;border-radius:10px}button{background:#f2b632;font-weight:800;cursor:pointer}</style>
<form action="/api/x/mock/done" method="get"><b class="warn">TEST MODE: this is not X, and nothing is checked. It works only on this computer.</b>
<input type="hidden" name="state" value="${state}">
<label>Pretend to be this X username<input name="username" list="names" required pattern="\\w{1,15}" maxlength="15" autocomplete="off"></label>
<datalist id="names">${[...readGifts(file).keys()].map((n) => `<option value="${n}">`).join('')}</datalist>
<label>If that admin has no cat chosen yet, test with:<select name="cat"><option value="">no cat</option>${ADMIN_CATS.map((c) => `<option value="${c.id}">${c.number}. ${c.name}</option>`).join('')}</select></label>
<button>Pretend sign-in</button><a href="/?x=cancelled">Cancel</a></form>`;
    app.get('/api/x/mock', async (req, reply) => {
      const state = String(req.query?.state ?? '');
      if (!isThisComputer(req)) return reply.code(403).send({ error: 'Local only.' });
      if (!pending.has(state)) return back(reply, 'expired');
      return reply.header('cache-control', 'no-store').type('text/html; charset=utf-8').send(page(state));
    });
    app.get('/api/x/mock/done', async (req, reply) => {
      if (!isThisComputer(req)) return reply.code(403).send({ error: 'Local only.' });
      const username = String(req.query?.username ?? '').replace(/^@/, '');
      if (!USERNAME.test(username)) return reply.code(400).send({ error: 'Use letters, numbers or _ (15 at most).' });
      const p = takePending(req, req.query?.state);
      if (!p) return back(reply, 'expired');
      save(p.pid, { id: `mock:${username.toLowerCase()}`, username, testCat: adminCat(req.query?.cat)?.id ?? null });
      return back(reply, 'connected');
    });
  }

  app.post('/api/x/wear', async (req, reply) => {
    const p = needPlayer(req, reply);
    if (!p) return reply;
    const l = linkOf(p.id);
    const on = req.body?.on === true;
    if (!l || (on && !entitlement(l).cat)) return reply.code(403).send({ error: 'There is no admin cat for this garden.' });
    q.wear.run(on ? 1 : 0, p.id);
    refresh(p.id);
    return { ok: true, wearing: on };
  });

  app.post('/api/x/disconnect', async (req, reply) => {
    const p = needPlayer(req, reply);
    if (!p) return reply;
    q.drop.run(p.id);
    db.audit(p.id, now(), 'x_unlink', null);
    refresh(p.id);
    return { ok: true };
  });

  app.get('/api/x/gift', async (req, reply) => {
    const p = needPlayer(req, reply);
    if (!p) return reply;
    const l = linkOf(p.id);
    const cat = l ? entitlement(l).cat : null;
    if (!cat) return reply.code(403).send({ error: 'There is no gift for this garden.' });
    const zip = zipFor(cat);
    if (!existsSync(zip)) return reply.code(404).send({ error: 'The gift file is not on this server yet.' });
    return reply.header('cache-control', 'no-store').header('content-length', statSync(zip).size)
      .header('content-disposition', `attachment; filename="mihao-gift-${cat.id}.zip"`).type('application/zip').send(createReadStream(zip));
  });

  rooms.giftOf = giftOf;
  return { giftOf, mode: config.mode };
}
