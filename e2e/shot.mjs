// Quick visual check: open the game, wait for it to load, run a few steps, save screenshots.
// Usage: node e2e/shot.mjs [url]   (server must be running; default http://127.0.0.1:8850)
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(OUT, { recursive: true });
const url = process.argv[2] ?? 'http://127.0.0.1:8850';
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--window-size=1600,900'],
  protocolTimeout: 180_000,
});
try {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1600, height: 900 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loading.done', { timeout: 120_000 });
  await new Promise((r) => setTimeout(r, 2500));
  await page.screenshot({ path: resolve(OUT, '01-spawn.png') });
  // close the recovery-code modal if shown
  await page.evaluate(() => document.querySelector('#modal:not([hidden]) #okBtn')?.click());
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: resolve(OUT, '02-hud.png') });
  console.log(errors.length ? `Errors:\n${errors.join('\n')}` : 'No page errors.');
} finally {
  await browser.close();
}
