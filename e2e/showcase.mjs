// Visual check of homes, decorations, pets, eggs and Sky Island: runs a throwaway server on its own port with a
// temporary database, gives the test player a rich garden, and saves screenshots to e2e/out/show-*.png.
// Usage: node e2e/showcase.mjs   (needs a built client: npm run build -w client)
import puppeteer from 'puppeteer-core';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server/src/app.js';
import { HOME_SPOT, ISLAND } from '../shared/src/data/features.js';
import { toWorld } from '../shared/src/world/village-layout.js';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, 'out');
mkdirSync(OUT, { recursive: true });
const dir = join(tmpdir(), `mg-show-${Date.now()}`);
mkdirSync(dir, { recursive: true });
const PORT = 8861;
const base = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const { app, rooms } = await createServer({ dbPath: join(dir, 'show.db'), secret: 'show', origins: [base], staticDir: resolve(here, '../client/dist') });
await app.listen({ port: PORT, host: '127.0.0.1' });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
  protocolTimeout: 300_000,
});
const errors = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 680 });
  page.on('pageerror', (e) => errors.push(e.message));
  const ready = async () => {
    await page.waitForSelector('#loading.done', { timeout: 180_000 });
    await page.evaluate(() => document.querySelector('#modal:not([hidden]) #okBtn')?.click());
    await wait(800);
  };
  await page.goto(`${base}/?debug`, { waitUntil: 'domcontentloaded' });
  await ready();

  // a new player: the empty home spot with its sign, then the plaza with the pet shop and name tags
  {
    const slot = await page.evaluate(() => window.__mg.store.you.slot);
    const spot = toWorld(slot, HOME_SPOT.x, HOME_SPOT.z + 9);
    await page.evaluate((x, z) => window.__mg.player.walkTo(x, z), spot.x, spot.z);
    await wait(12000);
    await page.screenshot({ path: `${OUT}/show-00-homespot.png` });
    await page.evaluate(() => window.__mg.act('travel', { to: 'pets' }, { quiet: true }));
    await wait(2500);
    await page.screenshot({ path: `${OUT}/show-00-petshop.png` });
    await page.keyboard.press('KeyE');
    await wait(400);
    await page.keyboard.press('Digit1');
    await wait(500);
    await page.screenshot({ path: `${OUT}/show-00-petshop-panel.png` });
    await page.evaluate(() => window.__mg.hud.modal(null));
    await page.evaluate(() => window.__mg.act('travel', { to: 'board' }, { quiet: true }));
    await wait(2500);
    await page.screenshot({ path: `${OUT}/show-00-plaza.png` });
  }

  // make the player rich, with a home, decorations, pets and eggs (directly in the server's memory)
  const [{ member }] = [...rooms.byPlayer.values()];
  const s = member.state, now = Date.now();
  Object.assign(s, { coins: 5e8, gems: 500, soil: 2, home: 4, rebirths: 2, title: 'Curious Botanist' });
  s.pets = [
    { id: 'a1', kind: 'dog', name: 'Dog', level: 1, bond: 30, equipped: true, mode: 'speedy', last: now },
    { id: 'a2', kind: 'capybara', name: 'Capybara', level: 0, bond: 3, equipped: true, mode: 'patient', last: now },
    { id: 'a3', kind: 'bunny', name: 'Bunny', level: 0, bond: 0, equipped: true, mode: 'speedy', last: now },
    { id: 'a4', kind: 'bee', name: 'Bee', level: 0, bond: 0, equipped: false, mode: 'speedy', last: now },
  ];
  s.eggs = [{ id: 'g1', kind: 'rare', ready: now - 1000 }, { id: 'g2', kind: 'legendary', ready: now + 300_000 }];
  const decor = [['gnome', -12, 6], ['birdbath', 11, 6], ['scarecrow', -12, -3], ['arch', 0, 9.5], ['minimill', 12, -4], ['lamp', -6, 9.5], ['lamp', 6, 9.5], ['goldgnome', 9, 8], ['flowerbed', -9, 9], ['bench', 12, 1.5], ['trophy', -4, -9]];
  s.decor = decor.map(([kind, x, z], i) => ({ id: `d${i}`, kind, x, z, rot: 0 }));
  s.decorInv = { fountain: 1, feather: 2 };
  s.island = { ...(s.island ?? {}), unlocked: true, acorns: 12, picked: [], day: '', days: 0 };
  s.tools = { ...s.tools, magnifier: true };
  s.seeds = { ...s.seeds, carrot: 10 };
  member.dirty = true;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready();

  // garden view: plant a few crops so the pets have work, then watch them
  const slot = await page.evaluate(() => window.__mg.store.you.slot);
  await page.evaluate(() => window.__mg.act('travel', { to: 'garden' }, { quiet: true }));
  await wait(1500);
  const mid = toWorld(slot, 0, 5);
  await page.evaluate((x, z) => new Promise((r) => window.__mg.player.walkTo(x, z, r)), mid.x, mid.z);
  for (const [x, z] of [[-3, 2.5], [0, 2.5], [3, 2.5], [-1.5, 0], [1.5, 0]]) {
    const r = await page.evaluate((x, z) => window.__mg.act('plant', { crop: 'carrot', x, z }, { quiet: true }), x, z);
    if (!r.ok) console.log('plant', r.msg);
  }
  await wait(16000);
  await page.screenshot({ path: `${OUT}/show-01-garden.png` });
  await wait(6000);
  await page.screenshot({ path: `${OUT}/show-01b-garden.png` });
  // the path view toward the plaza: shop tags in perspective
  const path = toWorld(slot, 0, 40);
  await page.evaluate((x, z) => window.__mg.player.walkTo(x, z), path.x, path.z);
  await wait(9000);
  await page.screenshot({ path: `${OUT}/show-01c-path.png` });
  await page.evaluate(() => window.__mg.F.pets());
  await wait(300);
  await page.screenshot({ path: `${OUT}/show-02-pets.png` });
  await page.evaluate(() => window.__mg.F.decor());
  await wait(300);
  await page.screenshot({ path: `${OUT}/show-03-decor.png` });
  await page.evaluate(() => window.__mg.hud.modal(null));

  // Sky Island
  const r = await page.evaluate(() => window.__mg.act('travel', { to: 'island' }, { quiet: true }));
  console.log('travel island', r.ok, r.msg ?? '');
  await wait(4000);
  await page.screenshot({ path: `${OUT}/show-04-island.png` });
  const near = await page.evaluate(() => document.querySelector('#prompt:not([hidden]) #promptTitle')?.textContent ?? '');
  console.log('island prompt:', near, 'center', ISLAND.center);
  console.log('page errors:', errors.length ? errors : 'none');
} finally {
  await browser.close();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
}
