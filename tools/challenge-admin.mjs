// Moderate Meme Challenge entries.
//   npm run challenge -- list [--week 2026-11-23] [--status pending|featured|rejected|all]
//   npm run challenge -- feature <id>
//   npm run challenge -- reject <id>        (also takes a featured entry down)
// Uses the game's database (--db, MG_DB, or server/data/meme-garden.db); it is safe while the server runs.
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../server/src/db.js';
import { challengeOfWeek } from '../shared/src/rules/memes.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
const [command, idArg] = args;
const path = opt('db') ?? process.env.MG_DB ?? resolve(ROOT, 'server/data/meme-garden.db');
const USAGE = 'Usage: npm run challenge -- list [--week YYYY-MM-DD] [--status pending|featured|rejected|all] | feature <id> | reject <id>';
/** Text typed by players is printed without control characters, so it cannot disguise anything in the terminal. */
const plain = (s) => String(s).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '?');

if (!['list', 'feature', 'reject'].includes(command)) { console.log(USAGE); process.exit(command ? 1 : 0); }
if (!existsSync(path)) { console.error(`No database at ${path}. Start the game once, or pass --db.`); process.exit(1); }
const db = openDb(path);
try {
  if (command === 'list') {
    const week = opt('week') ?? challengeOfWeek(Date.now()).week;
    const status = opt('status') ?? 'pending';
    const rows = db.listEntries(week, status === 'all' ? null : status);
    console.log(`Week of ${week}: ${rows.length} ${status === 'all' ? '' : `${status} `}entr${rows.length === 1 ? 'y' : 'ies'}`);
    for (const r of rows) console.log(`  #${r.id}  [${r.status}]  ${plain(r.by)}: ${plain(r.title)}\n        ${plain(r.url)}`);
    if (status === 'pending' && rows.length) console.log('\nOpen each link and watch it before you feature it.');
  } else {
    const id = Number(idArg);
    if (!Number.isInteger(id) || !db.setEntryStatus(id, command === 'feature' ? 'featured' : 'rejected')) { console.error(`No entry #${idArg}. ${USAGE}`); process.exitCode = 1; }
    else console.log(command === 'feature' ? `Entry #${id} is now featured.` : `Entry #${id} is rejected and not shown.`);
  }
} finally { db.close(); }
