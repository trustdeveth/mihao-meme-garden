// Makes the meme pictures of the ten admin cats in the garden, into output/memes.
//   node tools/models/admins/memes.mjs                        every picture
//   node tools/models/admins/memes.mjs --only green-hoodie,thermal
// pfp/        square profile pictures, no words
// captioned/  the same cats with a meme line and the website
// clean/      the two looks with smoking or a stain, with those parts left out
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const out = resolve(root, 'output/memes');
const at = process.argv.indexOf('--only');
const only = at >= 0 ? process.argv[at + 1].split(',') : null;
const CLEAN = ['green-hoodie', 'pink-hair'];
for (const d of ['pfp', 'captioned', 'clean']) mkdirSync(join(out, d), { recursive: true });

const vite = await createServer({ configFile: false, root: resolve(root, 'client'), logLevel: 'error', server: { host: '127.0.0.1', port: 5336, fs: { allow: [root] } } });
await vite.listen();
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--no-sandbox'], protocolTimeout: 600_000 });
const messages = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => messages.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) messages.push(m.text()); });
  await page.goto(`http://127.0.0.1:5336/@fs/${here.replace(/\\/g, '/')}/memes.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.memes, { timeout: 60_000 }).catch((e) => { console.log(messages); throw e; });
  await page.evaluate(() => window.memes.init());
  const list = await page.evaluate(() => window.memes.list);
  const save = async (file, id, options) => writeFileSync(join(out, file), Buffer.from(await page.evaluate((i, o) => window.memes.picture(i, o), id, options), 'base64'));
  if (only?.includes('support')) {
    writeFileSync(join(out, 'ansem-support.jpg'), Buffer.from(await page.evaluate(() => window.memes.supportPoster({ title: 'GARDENS GROW BACK.', sub: 'Stand strong, Ansem.', from: 'with love from the Mihao Meme Garden' })), 'base64'));
    console.log('ansem-support.jpg done');
  }
  if (only?.includes('roadmap')) {
    writeFileSync(join(out, 'roadmap.jpg'), Buffer.from(await page.evaluate(() => window.memes.roadmapPoster()), 'base64'));
    console.log('roadmap.jpg done');
  }
  for (const [i, id] of list.entries()) {
    if (only && !only.includes(id)) continue;
    const name = `${String(i + 1).padStart(2, '0')}-${id}`;
    await save(`pfp/${name}.png`, id, {});
    await save(`captioned/${name}.jpg`, id, { captioned: true });
    if (CLEAN.includes(id)) {
      await save(`clean/${name}-pfp.png`, id, { clean: true });
      await save(`clean/${name}-captioned.jpg`, id, { captioned: true, clean: true });
    }
    console.log(name, 'done');
  }
} finally {
  if (messages.length) console.log('page messages:', [...new Set(messages)].slice(0, 12));
  await browser.close();
  await vite.close();
}
