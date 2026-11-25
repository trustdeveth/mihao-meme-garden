// Entry point: node server/src/index.js  (PORT, HOST, MG_SECRET, MG_DB, MG_ORIGINS)
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createServer } from './app.js';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 8850);
const host = process.env.HOST ?? '127.0.0.1';
const origins = process.env.MG_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean);

const { app, rooms } = await createServer({
  dbPath: process.env.MG_DB ?? resolve(here, '../data/meme-garden.db'),
  origins,
  staticDir: resolve(here, '../../client/dist'),
  logger: process.env.NODE_ENV === 'production',
});

await app.listen({ port, host });
console.log(`Meme Garden server on http://${host}:${port}`);

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  console.log(`Saving ${rooms.stats().players} players...`);
  await app.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
