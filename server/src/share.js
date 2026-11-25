// Pictures for "Post to X". X's post link cannot carry a file, so the game keeps the picture here and puts a page
// for it in the post; X reads that page and shows the picture as a large preview.
// Everything is under /api so that a web server or Vercel rule that already forwards /api needs no change.
//
// Because anyone playing can upload, this is deliberately narrow: JPEG pictures only (checked byte by byte, with
// hidden metadata removed), small, rate limited, capped in number, never listed anywhere, and removable with
// `npm run shares`. Nothing a player types is put on the page. Set MG_SHARE=0 to switch uploads off.
import { createHash, randomBytes } from 'node:crypto';
import { Bucket } from './security.js';

export const MAX_BYTES = 1_500_000;
const MAX_SIDE = 2400, MIN_SIDE = 200;
export const PER_PLAYER = 20;
export const TOTAL = 2000;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS share_images (
  id TEXT PRIMARY KEY, player_id TEXT NOT NULL, at INTEGER NOT NULL, hash TEXT NOT NULL,
  width INTEGER NOT NULL, height INTEGER NOT NULL, image BLOB NOT NULL, UNIQUE(player_id, hash)
);
CREATE INDEX IF NOT EXISTS share_images_at ON share_images(at);`;

/**
 * Checks that the bytes are a JPEG picture and returns a copy without its metadata (EXIF, comments and so on),
 * plus its size. Returns null for anything else.
 */
export function cleanJpeg(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 200 || buf.length > MAX_BYTES) return null;
  if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[buf.length - 2] !== 0xff || buf[buf.length - 1] !== 0xd9) return null;
  const keep = [buf.subarray(0, 2)];
  let at = 2, size = null;
  while (at + 4 <= buf.length) {
    if (buf[at] !== 0xff) return null;
    const marker = buf[at + 1];
    if (marker === 0xda) { // the picture data runs from here to the end
      if (!size) return null;
      keep.push(buf.subarray(at));
      return { image: Buffer.concat(keep), ...size };
    }
    const length = buf.readUInt16BE(at + 2);
    const end = at + 2 + length;
    if (length < 2 || end > buf.length) return null;
    if (marker >= 0xc0 && marker <= 0xc3) size = { height: buf.readUInt16BE(at + 5), width: buf.readUInt16BE(at + 7) };
    if (size && (size.width > MAX_SIDE || size.height > MAX_SIDE || size.width < MIN_SIDE || size.height < MIN_SIDE)) return null;
    const metadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!metadata) keep.push(buf.subarray(at, end));
    at = end;
  }
  return null;
}

const isLocal = (host) => /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/.test(host);
/** True when X can open this address: https and not a home or office one. */
export function isPublic(base) {
  try { const u = new URL(base); return u.protocol === 'https:' && !isLocal(u.host); } catch { return false; }
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page(base, row) {
  const url = escapeHtml(`${base}/api/s/${row.id}`), image = escapeHtml(`${base}/api/s/${row.id}/card.jpg`), home = escapeHtml(`${base}/`);
  const title = 'Mihao Meme Garden', text = 'any last words? mihao.';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><meta name="robots" content="noindex"><meta name="description" content="${text}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${text}"><meta name="twitter:image" content="${image}">
<meta property="og:type" content="website"><meta property="og:title" content="${title}"><meta property="og:description" content="${text}"><meta property="og:url" content="${url}">
<meta property="og:image" content="${image}"><meta property="og:image:width" content="${row.width}"><meta property="og:image:height" content="${row.height}">
<style>body{margin:0;background:#17120F;color:#FFF4DC;font:18px system-ui,Arial,sans-serif;text-align:center}img{display:block;max-width:min(100%,1200px);max-height:80vh;margin:0 auto}a{display:inline-block;margin:18px;padding:10px 26px;background:#F2B632;color:#17120F;border-radius:8px;font-weight:800;text-decoration:none}</style>
</head><body><img src="${image}" alt="A Mihao Meme Garden picture"><a href="${home}">Play Mihao Meme Garden</a></body></html>`;
}

/** @param {{db:any, sessionPlayer:Function, now:()=>number, publicUrl?:string, origins:Set<string>, enabled?:boolean}} deps */
export async function registerShare(app, { db, sessionPlayer, now, publicUrl = '', origins, enabled = true }) {
  const sql = db.raw;
  sql.exec(SCHEMA);
  const q = {
    same: sql.prepare('SELECT id FROM share_images WHERE player_id = ? AND hash = ?'),
    add: sql.prepare('INSERT INTO share_images(id, player_id, at, hash, width, height, image) VALUES(?, ?, ?, ?, ?, ?, ?)'),
    get: sql.prepare('SELECT s.* FROM share_images s JOIN players p ON p.id = s.player_id WHERE s.id = ? AND p.banned = 0'),
    trimPlayer: sql.prepare('DELETE FROM share_images WHERE player_id = ?1 AND id NOT IN (SELECT id FROM share_images WHERE player_id = ?1 ORDER BY at DESC, rowid DESC LIMIT ?2)'),
    trimAll: sql.prepare('DELETE FROM share_images WHERE id NOT IN (SELECT id FROM share_images ORDER BY at DESC, rowid DESC LIMIT ?)'),
  };
  // the address people (and X) use: set MG_PUBLIC_URL, or the first public one in MG_ORIGINS
  const configured = (publicUrl || [...origins].find(isPublic) || '').replace(/\/+$/, '');
  const baseFor = (req) => configured || (/^[a-z0-9.\-:[\]]+$/i.test(req.host ?? '') ? `${req.protocol}://${req.host}` : '');

  const limits = new Map();
  const allow = (key, rate, burst) => { if (!limits.has(key)) limits.set(key, new Bucket(rate, burst)); return limits.get(key).take(now()); };

  await app.register(async (scope) => {
    scope.addContentTypeParser('image/jpeg', { parseAs: 'buffer' }, (req, body, done) => done(null, body));
    scope.post('/api/share', { bodyLimit: MAX_BYTES }, async (req, reply) => {
      if (!enabled) return reply.code(503).send({ error: 'Picture links are switched off.' });
      const p = sessionPlayer(req);
      if (!p) return reply.code(401).send({ error: 'No session.' });
      if (!allow(`p:${p.id}`, 12 / 3600, 6) || !allow(`ip:${req.ip}`, 40 / 3600, 20)) return reply.code(429).send({ error: 'Too many pictures. Wait a little.' });
      const clean = cleanJpeg(req.body);
      if (!clean) return reply.code(400).send({ error: 'That is not a picture the game can share.' });
      const hash = createHash('sha256').update(clean.image).digest('hex');
      let id = q.same.get(p.id, hash)?.id;
      if (!id) {
        id = randomBytes(12).toString('base64url'); // long and random: pictures cannot be guessed
        q.add.run(id, p.id, now(), hash, clean.width, clean.height, clean.image);
        q.trimPlayer.run(p.id, PER_PLAYER);
        q.trimAll.run(TOTAL);
      }
      const base = baseFor(req);
      return { id, url: `${base}/api/s/${id}`, public: isPublic(base) };
    });
  });

  const find = (id) => (/^[A-Za-z0-9_-]{16}$/.test(id) ? q.get.get(id) : null);
  app.get('/api/s/:id', async (req, reply) => {
    const row = find(req.params.id);
    if (!row) return reply.code(404).type('text/plain').send('This picture is gone.');
    return reply.type('text/html; charset=utf-8').header('x-content-type-options', 'nosniff').header('cache-control', 'public, max-age=300').send(page(baseFor(req), row));
  });
  app.get('/api/s/:id/card.jpg', async (req, reply) => {
    const row = find(req.params.id);
    if (!row) return reply.code(404).type('text/plain').send('This picture is gone.');
    return reply.type('image/jpeg').header('x-content-type-options', 'nosniff').header('cache-control', 'public, max-age=86400').send(Buffer.from(row.image));
  });
}
