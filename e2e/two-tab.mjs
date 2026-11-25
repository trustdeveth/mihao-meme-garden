// End-to-end: two players in separate browser profiles join the same village, one plants with the mouse,
// the other sees the plant appear and grow; chat bubbles show up; screenshots go to e2e/out.
// Usage: node e2e/two-tab.mjs [url]   (server must be running and serving the built client)
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(OUT, { recursive: true });
const url = `${process.argv[2] ?? 'http://127.0.0.1:8850'}/?debug`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
  protocolTimeout: 300_000,
});

async function open(name, viewport = { width: 960, height: 560 }) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loading.done', { timeout: 180_000 });
  await page.evaluate(() => document.querySelector('#modal:not([hidden]) #okBtn')?.click());
  await wait(800);
  page.slot = await page.evaluate(() => window.__mg.store.you.slot);
  console.log(`${name}: joined room ${await page.evaluate(() => window.__mg.store.roomId)} on plot ${page.slot}`);
  return page;
}

try {
  const a = await open('A');
  const b = await open('B');
  assert.equal(await a.evaluate(() => window.__mg.store.roomId), await b.evaluate(() => window.__mg.store.roomId), 'same room');
  await b.waitForFunction((s) => window.__mg.store.members.has(s), {}, a.slot);

  // A selects the carrot seed (hotbar 5) and clicks the middle of the soil: the gardener walks over and plants.
  await a.keyboard.press('Digit5');
  const p = await a.evaluate((s) => window.__mg.screenOf(s, 0, 0), a.slot);
  await a.mouse.click(p.x, p.y);
  try {
    await a.waitForFunction(() => window.__mg.store.me.plants.length === 1, { timeout: 60_000 });
  } catch (e) {
    console.log('diagnostics:', await a.evaluate(() => JSON.stringify({ pos: window.__mg.player.pos, target: window.__mg.player.target && { x: window.__mg.player.target.x, z: window.__mg.player.target.z }, sel: window.__mg.hud.selected, toast: document.querySelector('#toast').textContent, fps: window.__mgFps })));
    await a.screenshot({ path: resolve(OUT, 'fail.png') });
    throw e;
  }
  console.log('A planted a carrot with a mouse click.');
  await b.waitForFunction((s) => (window.__mg.store.gardens.get(s)?.plants.size ?? 0) === 1, { timeout: 10_000 }, a.slot);
  console.log('B sees the carrot in A\'s garden.');
  await a.screenshot({ path: resolve(OUT, 'A-planted.png') });

  // Chat bubble seen by the other player.
  await a.focus('#chatInput');
  await a.keyboard.type('Hello neighbour!');
  await a.keyboard.press('Enter');
  await b.waitForFunction(() => window.__mg.bubbles().includes('Hello neighbour!'), { timeout: 10_000 });
  console.log('B sees A\'s chat bubble.');

  // Wait for the carrot to ripen (40 s base), harvest it with E, then check B sees the harvest.
  await a.waitForFunction(() => { const p = window.__mg.store.me.plants[0]; return p && window.__mg.store.now() >= p.readyAt + 1500; }, { timeout: 90_000, polling: 1000 });
  await a.keyboard.press('KeyE');
  await a.waitForFunction(() => window.__mg.store.me.basket.length === 1, { timeout: 10_000 });
  console.log('A harvested the carrot with E.');
  await b.waitForFunction((s) => (window.__mg.store.gardens.get(s)?.plants.size ?? 1) === 0, { timeout: 10_000 }, a.slot);
  console.log('B sees the carrot was harvested.');

  // Travel to the market and sell.
  await a.click('[data-travel="market"]');
  try { await a.waitForSelector('#dialogue:not([hidden])', { timeout: 30_000 }); } catch (e) {
    await a.screenshot({ path: resolve(OUT, 'A-market-fail.png') });
    console.log('market dialogue missing; modal:', await a.evaluate(() => document.querySelector('#modal:not([hidden]) #modalCard')?.innerText.slice(0, 120)), '| pos', await a.evaluate(() => JSON.stringify(window.__mg.player.pos)));
    throw e;
  }
  await a.screenshot({ path: resolve(OUT, 'A-market.png') });
  const coins = await a.evaluate(() => window.__mg.store.me.coins);
  await a.keyboard.press('Digit3'); // "Sell everything"
  await a.waitForFunction((c) => window.__mg.store.me.coins > c, { timeout: 10_000 }, coins);
  console.log(`A sold the carrot: ${coins} -> ${await a.evaluate(() => window.__mg.store.me.coins)} coins.`);
  await b.screenshot({ path: resolve(OUT, 'B-view.png') });

  // Mobile layout check.
  const m = await open('Mobile', { width: 390, height: 844, isMobile: true, hasTouch: true });
  await m.screenshot({ path: resolve(OUT, 'mobile.png') });

  for (const [n, pg] of [['A', a], ['B', b], ['Mobile', m]]) assert.deepEqual(pg.errors, [], `${n} page errors`);
  console.log('E2E passed.');
} finally {
  await browser.close();
}
