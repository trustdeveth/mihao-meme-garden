// The loading screen must be styled before the game JavaScript is available.
// Run: npm run build && node e2e/loading.mjs
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer, preview } from 'vite';
import puppeteer from 'puppeteer-core';

const root = resolve(import.meta.dirname, '../client');
const out = resolve(import.meta.dirname, 'out');
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  for (const mode of ['dev', 'production']) {
    const server = mode === 'dev'
      ? await createServer({ root, server: { port: 0, strictPort: false } })
      : await preview({ root, preview: { port: 0, strictPort: false } });
    if (mode === 'dev') await server.listen();
    const url = `http://127.0.0.1:${server.httpServer.address().port}`;
    try {
      for (const [width, height] of [[1280, 800], [390, 844]]) {
        const page = await browser.newPage();
        try {
          await page.setViewport({ width, height });
          await page.setCacheEnabled(false);
          await page.setRequestInterception(true);
          page.on('request', request => request.resourceType() === 'script' ? request.abort() : request.continue());
          await page.goto(url, { waitUntil: 'networkidle0' });
          const state = await page.evaluate(async () => {
            await document.fonts.ready;
            const loading = document.querySelector('#loading');
            const style = getComputedStyle(loading);
            const rect = loading.getBoundingClientRect();
            return {
              stylesheetInHead: !!document.head.querySelector('link[rel="stylesheet"]'),
              display: style.display, position: style.position, background: style.backgroundColor,
              fillsViewport: rect.x === 0 && rect.y === 0 && rect.width === innerWidth && rect.height === innerHeight,
              imagesLoaded: [...loading.querySelectorAll('img')].every(img => img.complete && img.naturalWidth > 0),
              fontLoaded: document.fonts.check('800 16px "Baloo 2"'),
            };
          });
          assert.deepEqual(state, {
            stylesheetInHead: true, display: 'grid', position: 'fixed', background: 'rgb(255, 240, 210)',
            fillsViewport: true, imagesLoaded: true, fontLoaded: true,
          });
          await page.screenshot({ path: resolve(out, `loading-before-js-${mode}-${width}.png`) });
          console.log(`${mode} ${width}x${height}: styled loading screen with all JavaScript blocked`);
        } finally { await page.close(); }
      }
    } finally {
      if (mode === 'dev') await server.close();
      else await new Promise((r, reject) => server.httpServer.close(error => error ? reject(error) : r()));
    }
  }
} finally { await browser.close(); }
