import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/app.js';
import { cleanJpeg, isPublic, PER_PLAYER } from '../src/share.js';

/** A small file with the structure of a JPEG: optional metadata, a size header, then "picture data". */
function jpeg({ width = 1200, height = 630, exif = true, fill = 1 } = {}) {
  const seg = (marker, body) => { const h = Buffer.alloc(4); h[0] = 0xff; h[1] = marker; h.writeUInt16BE(body.length + 2, 2); return Buffer.concat([h, body]); };
  const sof = Buffer.alloc(15); sof[0] = 8; sof.writeUInt16BE(height, 1); sof.writeUInt16BE(width, 3);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]), seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'binary')),
    ...(exif ? [seg(0xe1, Buffer.from('Exif\0\0SECRET-PLACE')), seg(0xfe, Buffer.from('SECRET-COMMENT'))] : []),
    seg(0xc0, sof), seg(0xda, Buffer.from([1, 2, 3])), Buffer.alloc(300, fill), Buffer.from([0xff, 0xd9]),
  ]);
}

test('only real, sensibly sized JPEG pictures are accepted, and metadata is removed', () => {
  const clean = cleanJpeg(jpeg());
  assert.deepEqual([clean.width, clean.height], [1200, 630]);
  assert.ok(!clean.image.includes('SECRET'), 'EXIF and comments are gone');
  assert.equal(cleanJpeg(Buffer.from('<html><script>alert(1)</script></html>'.repeat(20))), null);
  assert.equal(cleanJpeg(jpeg({ width: 9000 })), null);
  assert.equal(cleanJpeg(jpeg().subarray(0, -2)), null, 'cut off');
  assert.equal(cleanJpeg(Buffer.alloc(2_000_000, 0xff)), null);
});

test('X can only open https addresses that are not local', () => {
  assert.ok(isPublic('https://mihaomeme.garden'));
  for (const u of ['http://mihaomeme.garden', 'https://127.0.0.1:8850', 'https://localhost', 'https://192.168.1.4', 'nonsense']) assert.ok(!isPublic(u), u);
});

test('sharing a picture: needs a player, makes a page with a large X preview, and is limited', async () => {
  let t = Date.UTC(2026, 10, 25);
  const { app, db } = await createServer({ dbPath: ':memory:', secret: 's', origins: ['http://127.0.0.1:5190', 'https://mihaomeme.garden'], now: () => t });
  const post = (cookie, body, type = 'image/jpeg') => app.inject({ method: 'POST', url: '/api/share', headers: { 'content-type': type, ...(cookie ? { cookie } : {}) }, payload: body });
  assert.equal((await post(null, jpeg())).statusCode, 401);
  const guest = await app.inject({ method: 'POST', url: '/api/guest' });
  const cookie = guest.headers['set-cookie'].split(';')[0];
  assert.equal((await post(cookie, Buffer.from('not a picture'.repeat(40)))).statusCode, 400);

  t += 3_600_000;
  const r = await post(cookie, jpeg());
  assert.equal(r.statusCode, 200);
  const { id, url, public: open } = r.json();
  assert.equal(url, `https://mihaomeme.garden/api/s/${id}`);
  assert.equal(open, true);
  assert.equal((await post(cookie, jpeg())).json().id, id, 'the same picture is kept once');

  const page = await app.inject({ method: 'GET', url: `/api/s/${id}`, headers: { host: 'evil.example"><script>' } });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /name="twitter:card" content="summary_large_image"/);
  assert.ok(page.body.includes(`content="https://mihaomeme.garden/api/s/${id}/card.jpg"`));
  assert.ok(!page.body.includes('evil.example'), 'the address comes from the settings, not from the visitor');
  const card = await app.inject({ method: 'GET', url: `/api/s/${id}/card.jpg` });
  assert.equal(card.headers['content-type'], 'image/jpeg');
  assert.equal(card.headers['x-content-type-options'], 'nosniff');
  assert.ok(!card.rawPayload.includes('SECRET'));
  assert.equal((await app.inject({ method: 'GET', url: '/api/s/AAAAAAAAAAAAAAAA' })).statusCode, 404);

  const codes = [];
  for (let i = 0; i < 10; i++) codes.push((await post(cookie, jpeg({ fill: 10 + i }))).statusCode);
  assert.ok(codes.includes(429), 'uploads are rate limited');
  for (let i = 0; i < PER_PLAYER + 5; i++) { t += 3_600_000; await post(cookie, jpeg({ fill: 40 + i })); }
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM share_images').get().n, PER_PLAYER, 'each player keeps a limited number');
  db.raw.prepare('UPDATE players SET banned = 1').run();
  const left = db.raw.prepare('SELECT id FROM share_images LIMIT 1').get().id;
  assert.equal((await app.inject({ method: 'GET', url: `/api/s/${left}/card.jpg` })).statusCode, 404, 'a banned player\'s pictures are hidden');
  await app.close();
});
