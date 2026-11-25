// Look after the pictures players shared to X.
//   npm run shares -- list [how many]     newest first, with the player's name and the picture's address
//   npm run shares -- delete <id>         take one picture down
//   npm run shares -- delete-player <name> take down all of one player's pictures
// Uses the game's database (--db, MG_DB, or server/data/meme-garden.db); it is safe while the server runs.
// X keeps its own copy of a preview for a while: to remove a post, report it on X as well.
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../server/src/db.js';
import { SCHEMA } from '../server/src/share.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const at = args.indexOf('--db');
const path = (at >= 0 ? args.splice(at, 2)[1] : null) ?? process.env.MG_DB ?? resolve(ROOT, 'server/data/meme-garden.db');
const [command, ...rest] = args;
const value = rest.join(' ');
const USAGE = 'Usage: npm run shares -- list [how many] | delete <id> | delete-player <name>';

if (!['list', 'delete', 'delete-player'].includes(command)) { console.log(USAGE); process.exit(command ? 1 : 0); }
if (!existsSync(path)) { console.error(`No database at ${path}. Start the game once, or pass --db.`); process.exit(1); }
const db = openDb(path);
db.raw.exec(SCHEMA);
/** Names are printed without control characters, so they cannot disguise anything in the terminal. */
const plain = (s) => String(s).replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, '?');
try {
  if (command === 'list') {
    const rows = db.raw.prepare('SELECT s.id, s.at, length(s.image) AS bytes, p.name FROM share_images s JOIN players p ON p.id = s.player_id ORDER BY s.at DESC LIMIT ?').all(Number(value) || 30);
    console.log(`${rows.length} newest shared picture${rows.length === 1 ? '' : 's'}`);
    for (const r of rows) console.log(`  ${r.id}  ${new Date(r.at).toISOString().slice(0, 16)}  ${Math.round(r.bytes / 1024)} KB  ${plain(r.name)}\n        /api/s/${r.id}`);
  } else {
    const removed = command === 'delete'
      ? db.raw.prepare('DELETE FROM share_images WHERE id = ?').run(value).changes
      : db.raw.prepare('DELETE FROM share_images WHERE player_id IN (SELECT id FROM players WHERE name = ?)').run(value).changes;
    console.log(removed ? `Removed ${removed} picture${removed === 1 ? '' : 's'}.` : `Nothing matched "${plain(value)}". ${USAGE}`);
    if (!removed) process.exitCode = 1;
  }
} finally { db.close(); }
