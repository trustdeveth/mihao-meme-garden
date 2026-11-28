// The Mihao Meme Garden pictures for Meme Depot, into output/depot.
//   node tools/models/admins/depot.mjs                 memes/ and blank templates/
//   node tools/models/admins/depot.mjs --banner        the wide picture announcing the depot (after the sets exist)
//   node tools/models/admins/depot.mjs --set 2         the second set (depot-set2.mjs), into output/depot-2
//   node tools/models/admins/depot.mjs --only gm,gn
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MEMES = [
  { id: 'gm', time: 'sunrise', cats: [{ pose: 'wave', at: 0.55 }], top: 'GM, GARDENERS', bottom: 'mihao.' },
  { id: 'gn', time: 'night', camera: 'full', cats: [{ look: 'ghost', pose: 'sit', at: 0.8 }], top: 'GN, GARDEN', bottom: 'see you at harvest.', bottomSize: 130 },
  { id: 'mihao', time: 'golden', spot: 'beds', camera: 'face', cats: [{ pose: 'stance' }], bottom: 'MIHAO.', bottomSize: 270, template: 'the-stare' },
  { id: 'any-last-words', time: 'dusk', camera: 'full', cats: [{ pose: 'stance', x: -0.78, turn: 0.55 }], props: [{ kind: 'crate', pos: [0.95, 0, 0.45], h: 0.9 }, { kind: 'pumpkin', pos: [0.95, 0.9, 0.45], size: 0.8 }], top: 'ANY LAST WORDS?', bottom: 'pumpkin: ...', bottomSize: 120, template: 'face-off-with-pumpkin' },
  { id: 'wen-harvest', camera: 'full', lift: 0.34, cats: [{ look: 'gardener', pose: 'sit', at: 0.8, x: -0.62, turn: 0.5 }], props: [{ kind: 'sprout', pos: [0.74, 0, 0.75], scale: 1.35 }], top: 'WEN HARVEST?', bottom: 'PLANTED 4 SECONDS AGO', bottomSize: 128, template: 'waiting' },
  { id: 'harvest-day', time: 'golden', camera: 'full', lift: 0.36, cats: [{ pose: 'dance', at: 0.45, z: -0.35 }, { look: 'sailor', pose: 'dance', at: 0.9, x: -1.45, z: -0.7, turn: 0.2 }, { look: 'lime', pose: 'dance', at: 1.3, x: 1.45, z: -0.7, turn: -0.2 }], props: [{ kind: 'heap', pos: [0, 0, 0.85], spread: 1.15, n: 48 }], top: 'HARVEST DAY', bottom: 'EVERYBODY MIHAO' },
  { id: 'sold', time: 'golden', spot: 'market', camera: 'full', lift: 0.34, cats: [{ look: 'captain', pose: 'flex', at: 0.4, x: -0.5, turn: 0.25 }], props: [{ kind: 'coins', pos: [0.82, 0.02, 0.55], scale: 1.15 }], top: 'SOLD!', topSize: 230, bottom: 'RICH IN GARDEN COINS', bottomSize: 124, sub: 'in-game coins only. mihao.', template: 'counting-coins' },
  { id: 'water-first', camera: 'full', lift: 0.3, cats: [{ look: 'gardener', pose: 'water', at: 0.6, x: 0.35, turn: -0.35 }], props: [{ kind: 'can', pos: [-0.32, 1.22, 0.55] }, { kind: 'sprout', pos: [-0.98, 0, 0.72], scale: 1.15 }], top: 'WATER FIRST.', bottom: 'QUESTIONS LATER.', bottomSize: 150 },
  { id: 'beard-storm', time: 'night', camera: 'full', storm: true, lift: -0.22, cats: [{ pose: 'shock', at: 0.45 }], props: [{ kind: 'umbrella', pos: [0.5, 2.5, 0.22], rot: [0, 0, 0.34], scale: 0.8 }], top: 'BEARD STORM', bottom: 'PROTECT THE MOUSTACHE', bottomSize: 124, template: 'storm' },
  { id: 'official-inspection', time: 'day', camera: 'full', cats: [{ pose: 'point', at: 0.6, x: -0.82, turn: 0.7 }, { look: 'gardener', pose: 'shock', at: 0.45, x: 0.9, turn: -0.6 }], top: 'OFFICIAL INSPECTION', topSize: 150, bottom: 'SHOW ME 3 PLANTS.', bottomSize: 130, template: 'inspection' },
  { id: 'beard-battle', time: 'dusk', camera: 'half', cats: [{ pose: 'stance', x: -0.72, turn: 1.0 }, { look: 'grandmaster', pose: 'stance', x: 0.72, turn: -1.0 }], top: 'BEARD BATTLE', bottom: 'MINE IS LONGER.', bottomSize: 150, template: 'beard-battle' },
  { id: 'golden-crop', time: 'night', camera: 'full', cats: [{ pose: 'point', at: 0.6, x: -0.75, turn: 0.55 }], props: [{ kind: 'pumpkin', pos: [0.82, 0.04, 0.6], size: 1.15, gold: true }], top: "IT'S GOLDEN!", topColor: '#ffd84a', bottom: 'VERY RARE. VERY MIHAO.', bottomSize: 118, template: 'golden-find' },
  { id: 'touch-grass', camera: 'full', spot: 'blossom', time: 'blossom', lift: 0.2, cats: [{ look: 'gardener', pose: 'sit', at: 0.8, x: -0.15, turn: -0.35, y: 0.05 }], props: [{ kind: 'grass', pos: [-0.1, 0, 0.25] }], top: 'I TOUCHED GRASS', bottom: 'DOCTOR SAID MIHAO', bottomSize: 140 },
  { id: 'garden-squad', time: 'sunrise', camera: 'wide', cats: [{ pose: 'stance', z: 0.45 }, { look: 'lime', x: -1.12, z: -0.25 }, { look: 'sailor', x: 1.12, z: -0.25 }, { look: 'ghost', x: -2.2, z: -0.9 }, { look: 'captain', x: 2.2, z: -0.9 }], top: 'THE GARDEN SQUAD', topSize: 160, bottom: 'NO CAT LEFT BEHIND', bottomSize: 140, template: 'the-squad' },
  { id: 'keep-calm', time: 'blossom', spot: 'blossom', cats: [{ look: 'grandmaster', pose: 'stance' }], top: 'KEEP CALM', bottom: 'AND MIHAO', bottomSize: 190 },
  { id: 'one-more-plant', time: 'night', spot: 'plaza', camera: 'face', crops: ['starflower', 'moonblossom', 'orchid', 'candyblossom'], cats: [{ look: 'ghost', pose: 'shock', at: 0.45 }], top: '"ONE MORE PLANT"', topSize: 135, bottom: 'ME AT 3 AM', bottomSize: 160 },
  { id: 'who-took-my-pumpkin', time: 'dusk', camera: 'full', cats: [{ look: 'gardener', pose: 'shock', at: 0.45, x: -0.45, turn: 0.3 }], props: [{ kind: 'crate', pos: [0.9, 0, 0.5], h: 0.75 }], bubble: ['MY PUMPKIN?!', 520, 420], bottom: 'WHO TOOK IT?', bottomSize: 160, template: 'something-is-missing' },
  { id: 'welcome', time: 'sunrise', spot: 'beds', camera: 'full', cats: [{ pose: 'wave', at: 0.55, x: 0 }, { look: 'phoenix', pose: 'wave', at: 1.0, x: -1.5, z: -0.65, turn: 0.2 }, { look: 'sailor', pose: 'wave', at: 0.3, x: 1.5, z: -0.65, turn: -0.2 }], top: 'WELCOME TO THE GARDEN', topSize: 128, bottom: 'MIHAO MEME GARDEN', bottomSize: 140, sub: 'plant. harvest. be very mihao.' },
];

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const setNumber = process.argv.includes('--set') ? Number(process.argv[process.argv.indexOf('--set') + 1]) : 1;
// numbers carry on from the sets before, so no two pictures in the depot share a file name
const list = setNumber === 2 ? (await import('./depot-set2.mjs')).default : MEMES;
const first = setNumber === 2 ? MEMES.length + 1 : 1;
const out = resolve(root, setNumber === 1 ? 'output/depot' : `output/depot-${setNumber}`);
const at = process.argv.indexOf('--only');
const only = at >= 0 ? process.argv[at + 1].split(',') : null;
for (const d of ['memes', 'templates']) mkdirSync(join(out, d), { recursive: true });

const vite = await createServer({ configFile: false, root: resolve(root, 'client'), logLevel: 'error', server: { host: '127.0.0.1', port: 5337, fs: { allow: [root] } } });
await vite.listen();
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--no-sandbox'], protocolTimeout: 600_000 });
const messages = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => messages.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) messages.push(m.text()); });
  await page.goto(`http://127.0.0.1:5337/@fs/${here.replace(/\\/g, '/')}/depot.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.depot, { timeout: 60_000 }).catch((e) => { console.log(messages); throw e; });
  await page.evaluate(() => window.depot.init());
  const bannerOnly = process.argv.includes('--banner');
  if (bannerOnly) {
    const cards = ['depot/memes/mihao-garden-01-gm', 'depot/memes/mihao-garden-11-beard-battle', 'depot/memes/mihao-garden-06-harvest-day',
      'depot-2/memes/mihao-garden-22-approved', 'depot/memes/mihao-garden-05-wen-harvest', 'depot-2/memes/mihao-garden-27-weekend-festival']
      .map((f) => `data:image/jpeg;base64,${readFileSync(resolve(root, `output/${f}.jpg`)).toString('base64')}`);
    writeFileSync(resolve(root, 'output/depot-announcement.jpg'), Buffer.from(await page.evaluate((c) => window.depot.banner(c, 'memedepot.com/d/mihao-meme-garden'), cards), 'base64'));
    console.log('output/depot-announcement.jpg done');
  }
  for (const [i, spec] of (bannerOnly ? [] : list).entries()) {
    if (only && !only.includes(spec.id)) continue;
    const n = String(i + first).padStart(2, '0');
    const save = async (file, words) => writeFileSync(join(out, file), Buffer.from(await page.evaluate((s, w) => window.depot.make(s, w), spec, words), 'base64'));
    await save(`memes/mihao-garden-${n}-${spec.id}.jpg`, true);
    if (spec.template) await save(`templates/mihao-garden-template-${spec.template}.jpg`, false);
    console.log(n, spec.id, spec.template ? '+ template' : '');
  }
} finally {
  if (messages.length) console.log('page messages:', [...new Set(messages)].slice(0, 12));
  await browser.close();
  await vite.close();
}
