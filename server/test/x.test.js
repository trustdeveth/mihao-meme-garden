// "Connect X": only the account X confirms gets its admin cat, and the pretend sign-in stays on this computer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../src/app.js';
import { xConfig, readGifts } from '../src/x.js';

const START = Date.UTC(2026, 10, 27, 12);
const REAL = { mode: 'real', clientId: 'client-1', clientSecret: 'secret-1', redirectUri: 'http://127.0.0.1:5190/api/x/callback' };

/** X as the tests see it: the code says who signs in. */
function fakeX(users, log = []) {
  return async (url, init) => {
    log.push({ url: String(url), init });
    const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
    if (String(url).endsWith('/2/oauth2/token')) {
      const code = new URLSearchParams(init.body).get('code');
      return users[code] ? json(200, { access_token: `token-for-${code}` }) : json(400, { error: 'invalid_grant' });
    }
    return json(200, { data: users[init.headers.authorization.replace('Bearer token-for-', '')] });
  };
}

async function setup({ x = REAL, accounts = { BrickTart: 4, onlyvoss: null }, users = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mg-x-'));
  const gifts = join(dir, 'gifts.json');
  writeFileSync(gifts, JSON.stringify({ accounts }));
  writeFileSync(join(dir, 'mihao-gift-04-helmet-pilot.zip'), 'ZIPDATA');
  const log = [];
  const clock = { t: START };
  const srv = await createServer({ dbPath: join(dir, 'x.db'), secret: 's', now: () => clock.t, allowNoOrigin: true, x, xGiftsFile: gifts, xGiftsDir: dir, xFetch: fakeX(users, log), guestRate: 100, guestBurst: 100, tickMs: 1e6, posMs: 1e6, flushMs: 1e6 });
  const call = async (method, url, { cookie, body, headers, remoteAddress } = {}) => srv.app.inject({
    method, url, remoteAddress, payload: body, headers: { host: '127.0.0.1:8850', ...(cookie ? { cookie } : {}), ...headers },
  });
  const guest = async () => String((await call('POST', '/api/guest', { body: {} })).headers['set-cookie']).split(';')[0];
  const start = async (cookie) => (await call('POST', '/api/x/start', { cookie, body: {} })).json().url;
  const stateOf = (url) => new URL(url, 'http://127.0.0.1').searchParams.get('state');
  const signIn = async (cookie, code) => call('GET', `/api/x/callback?state=${stateOf(await start(cookie))}&code=${code}`, { cookie });
  const status = async (cookie) => (await call('GET', '/api/x/status', { cookie })).json();
  return { srv, dir, gifts, log, clock, call, guest, start, stateOf, signIn, status, done: async () => { await srv.app.close(); rmSync(dir, { recursive: true, force: true }); } };
}

const USERS = { admin: { id: '100', username: 'bricktart' }, waiting: { id: '200', username: 'onlyvoss' }, stranger: { id: '300', username: 'someone' }, impostor: { id: '999', username: 'bricktart' } };

test('settings: off unless configured, and the pretend sign-in never in production', () => {
  assert.equal(xConfig({}).mode, 'off');
  assert.equal(xConfig({ MG_X_MOCK: '1' }).mode, 'mock');
  assert.equal(xConfig({ MG_X_MOCK: '1', NODE_ENV: 'production' }).mode, 'off');
  assert.equal(xConfig({ MG_X_MOCK: '1', MG_X_CLIENT_ID: 'a' }).mode, 'real');
  assert.throws(() => xConfig({ MG_X_CLIENT_ID: 'a', NODE_ENV: 'production' }), /MG_X_REDIRECT_URI/);
});

test('the gift list in the project is readable and assigns nobody yet by guesswork', () => {
  const gifts = readGifts(new URL('../x-gifts.json', import.meta.url));
  assert.equal(gifts.size, 12);
  assert.ok(gifts.has('reallybigdream'));
});

test('switched off, nothing is offered', async () => {
  const t = await setup({ x: { mode: 'off' } });
  try {
    const cookie = await t.guest();
    assert.deepEqual(await t.status(cookie), { enabled: false });
    for (const [m, u] of [['POST', '/api/x/start'], ['POST', '/api/x/wear'], ['GET', '/api/x/gift'], ['GET', '/api/x/mock'], ['GET', '/api/x/mock/done'], ['GET', '/api/x/callback']]) assert.equal((await t.call(m, u, { cookie, body: m === 'POST' ? {} : undefined })).statusCode, 404, u);
  } finally { await t.done(); }
});

test('real sign-in: PKCE, the right account gets its cat, and only that garden', async () => {
  const t = await setup({ users: USERS });
  try {
    const cookie = await t.guest();
    const url = new URL(await t.start(cookie));
    assert.equal(url.origin + url.pathname, 'https://x.com/i/oauth2/authorize');
    assert.equal(url.searchParams.get('scope'), 'tweet.read users.read');
    assert.equal(url.searchParams.get('redirect_uri'), REAL.redirectUri);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    const r = await t.call('GET', `/api/x/callback?state=${url.searchParams.get('state')}&code=admin`, { cookie });
    assert.equal(r.headers.location, '/?x=connected');
    const form = new URLSearchParams(t.log[0].init.body);
    assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'), url.searchParams.get('code_challenge'));
    assert.equal(t.log[0].init.headers.authorization, `Basic ${Buffer.from('client-1:secret-1').toString('base64')}`);

    assert.deepEqual(await t.status(cookie), { enabled: true, mock: false, linked: { username: 'bricktart' }, listed: true, taken: false, gift: { id: 'helmet-pilot', name: 'Helmet Pilot', download: true }, wearing: false });
    const zip = await t.call('GET', '/api/x/gift', { cookie });
    assert.equal(zip.statusCode, 200);
    assert.match(zip.headers['content-disposition'], /mihao-gift-helmet-pilot\.zip/);
    assert.equal(zip.body, 'ZIPDATA');

    const other = await t.guest();
    assert.equal((await t.call('GET', '/api/x/gift', { cookie: other })).statusCode, 403, 'another garden gets nothing');
    assert.equal((await t.call('GET', '/api/x/gift')).statusCode, 401, 'nor does a visitor');
    assert.equal((await t.call('POST', '/api/x/wear', { cookie: other, body: { on: true } })).statusCode, 403);
    // nothing of X's is kept
    const saved = JSON.stringify(t.srv.db.raw.prepare('SELECT * FROM x_links').all()) + JSON.stringify(t.srv.db.raw.prepare('SELECT * FROM audit').all());
    assert.ok(!saved.includes('token-for') && !saved.includes('secret-1'));
  } finally { await t.done(); }
});

test('a sign-in works once, only for the garden that started it, and not too late', async () => {
  const t = await setup({ users: USERS });
  try {
    const mine = await t.guest(), theirs = await t.guest();
    const state = t.stateOf(await t.start(mine));
    assert.equal((await t.call('GET', `/api/x/callback?state=${state}&code=admin`, { cookie: theirs })).headers.location, '/?x=expired', 'a link sent to someone else does nothing');
    assert.equal((await t.status(theirs)).linked, null);
    assert.equal((await t.call('GET', `/api/x/callback?state=${state}&code=admin`, { cookie: mine })).headers.location, '/?x=connected');
    assert.equal((await t.call('GET', `/api/x/callback?state=${state}&code=admin`, { cookie: mine })).headers.location, '/?x=expired', 'used up');
    t.clock.t += 60_000;
    const late = t.stateOf(await t.start(theirs));
    t.clock.t += 11 * 60_000;
    assert.equal((await t.call('GET', `/api/x/callback?state=${late}&code=admin`, { cookie: theirs })).headers.location, '/?x=expired');
    assert.equal((await t.call('GET', `/api/x/callback?state=${t.stateOf(await t.start(theirs))}&error=access_denied`, { cookie: theirs })).headers.location, '/?x=cancelled');
    assert.equal((await t.signIn(theirs, 'wrong-code')).headers.location, '/?x=failed');
  } finally { await t.done(); }
});

test('not on the list, no cat yet, a reused username, and moving to another garden', async () => {
  const t = await setup({ users: USERS });
  try {
    const a = await t.guest(), b = await t.guest(), c = await t.guest();
    await t.signIn(a, 'stranger');
    assert.deepEqual([(await t.status(a)).listed, (await t.status(a)).gift], [false, null]);
    await t.signIn(b, 'waiting');
    assert.deepEqual([(await t.status(b)).listed, (await t.status(b)).gift], [true, null]);
    // the team chooses a cat: it appears without a restart
    writeFileSync(t.gifts, JSON.stringify({ accounts: { bricktart: 4, onlyvoss: 'ansem' } }));
    assert.equal((await t.status(b)).gift.id, 'ansem');

    t.clock.t += 600_000;
    await t.signIn(a, 'admin');
    assert.equal((await t.status(a)).gift.id, 'helmet-pilot');
    // someone else later holds the same username
    await t.signIn(c, 'impostor');
    assert.deepEqual([(await t.status(c)).taken, (await t.status(c)).gift], [true, null]);
    // the real admin on a new device: the gift follows the X account
    const phone = await t.guest();
    await t.signIn(phone, 'admin');
    assert.equal((await t.status(phone)).gift.id, 'helmet-pilot');
    assert.equal((await t.status(a)).linked, null);
  } finally { await t.done(); }
});

test('pretend sign-in: works on this computer, refuses everyone else, and never counts for real', async () => {
  const t = await setup({ x: { mode: 'mock' } });
  try {
    const cookie = await t.guest();
    for (const outside of [{ remoteAddress: '203.0.113.7' }, { headers: { host: 'mihaomeme.garden' } }, { headers: { 'x-forwarded-for': '203.0.113.7' } }, { remoteAddress: '203.0.113.7', headers: { 'x-forwarded-for': '127.0.0.1' } }]) {
      assert.equal((await t.call('POST', '/api/x/start', { cookie, body: {}, ...outside })).statusCode, 403, JSON.stringify(outside));
      assert.equal((await t.call('GET', '/api/x/mock?state=a', { cookie, ...outside })).statusCode, 403);
      assert.equal((await t.call('GET', '/api/x/mock/done?state=a&username=bricktart', { cookie, ...outside })).statusCode, 403);
    }
    const url = await t.start(cookie);
    const page = await t.call('GET', url, { cookie });
    assert.match(page.body, /TEST MODE/);
    assert.equal((await t.call('GET', `/api/x/mock/done?state=${t.stateOf(url)}&username=onlyvoss&cat=ansem`, { cookie })).headers.location, '/?x=connected');
    assert.equal((await t.status(cookie)).gift.id, 'ansem', 'an unassigned admin can be tested with any cat');
    assert.equal((await t.call('GET', '/api/x/callback?state=a&code=b', { cookie })).statusCode, 404);
    assert.equal(t.srv.db.raw.prepare('SELECT COUNT(*) AS n FROM x_pins').get().n, 0, 'a pretend sign-in claims no name');

    // the same database under real sign-in: the pretend link is ignored
    await t.srv.app.close();
    const real = await createServer({ dbPath: join(t.dir, 'x.db'), secret: 's', now: () => t.clock.t, allowNoOrigin: true, x: REAL, xGiftsFile: t.gifts, xGiftsDir: t.dir });
    const s = (await real.app.inject({ method: 'GET', url: '/api/x/status', headers: { cookie } })).json();
    assert.equal(s.linked, null);
    assert.equal(real.x.giftOf(real.db.raw.prepare('SELECT player_id FROM x_links').get().player_id), null);
    await real.app.close();
  } finally { rmSync(t.dir, { recursive: true, force: true }); }
});
