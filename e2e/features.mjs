// End-to-end: open every feature panel, play the daily challenge, change the avatar, visit the board and the
// balloon, and check friends. Screenshots go to e2e/out/feat-*.png.
// Usage: node e2e/features.mjs [url]   (server must be running and serving the built client)
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(OUT, { recursive: true });
const base = process.argv[2] ?? 'http://127.0.0.1:8850';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
  protocolTimeout: 300_000,
});

async function open(name) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1100, height: 680 });
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  await page.goto(`${base}/?debug`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loading.done', { timeout: 180_000 });
  await page.evaluate(() => document.querySelector('#modal:not([hidden]) #okBtn')?.click());
  await wait(600);
  console.log(`${name}: room ${await page.evaluate(() => window.__mg.store.roomId)}, plot ${await page.evaluate(() => window.__mg.store.you.slot)}`);
  return page;
}
const shot = (page, n) => page.screenshot({ path: `${OUT}/feat-${n}.png` });
const modalText = (page) => page.evaluate(() => document.querySelector('#modal:not([hidden]) #modalCard')?.innerText ?? '');

try {
  const a = await open('A');
  // menu grid opens and lists every feature
  await a.click('[data-panel="more"]');
  await wait(300);
  const menu = await modalText(a);
  for (const w of ['Album', 'Village Board', 'Season', 'Challenge', 'Decor', 'Home', 'Pets', 'Avatar', 'Friends', 'Postcard', 'Promotion', 'Settings']) assert.ok(menu.includes(w), `menu has ${w}`);
  await shot(a, '01-menu');

  // every panel renders
  for (const [fn, want] of [['album', 'sticker'], ['board', 'Reputation'], ['season', 'Tier'], ['festival', 'festival'], ['pets', 'Incubators'], ['home', 'home'], ['decor', 'Decorations'], ['rebirth', 'Promotion'], ['avatar', 'Skin']]) {
    await a.evaluate((f) => window.__mg.F[f](), fn);
    await wait(250);
    const txt = await modalText(a);
    assert.ok(txt.toLowerCase().includes(want.toLowerCase()), `${fn} panel shows "${want}"`);
    await shot(a, `02-${fn}`);
  }
  await a.evaluate(() => window.__mg.F.album('badges'));
  await wait(200);
  assert.ok((await modalText(a)).includes('Green Thumb') || (await modalText(a)).includes('Claim'), 'badges tab');
  await shot(a, '02-badges');

  // avatar: pick a new free shirt colour and see it in the profile
  // avatar: a free skin and hair colour, then a wardrobe item that costs coins (a new player cannot afford it)
  const r1 = await a.evaluate(() => window.__mg.act('setAvatar', { skin: '#c98e6a', hair: '#e8c070', height: 1.06 }));
  assert.ok(r1.ok, `setAvatar ${r1.msg}`);
  assert.equal(await a.evaluate(() => window.__mg.store.me.avatar.skin), '#c98e6a');
  const r2 = await a.evaluate(() => window.__mg.act('setAvatar', { shirt: 'plaid_blue' }, { quiet: true }));
  assert.equal(r2.code, 'not_owned');
  await a.evaluate(() => window.__mg.F.avatar('shirt'));
  await wait(300);
  assert.ok((await modalText(a)).includes('Blue Plaid Shirt'), 'wardrobe lists shirts');
  await shot(a, '02-wardrobe');

  // daily challenge: start and play it through
  await a.evaluate(() => window.__mg.act('trialStart'));
  let won = false;
  for (let step = 0; step < 40 && !won; step++) {
    const t = await a.evaluate(() => window.__mg.store.me.trial);
    if (t.done) break;
    const now = await a.evaluate(() => window.__mg.store.now());
    for (let i = 0; i < t.beds.length; i++) {
      const b = t.beds[i];
      if (b && now >= b.ready) { const r = await a.evaluate((bed) => window.__mg.act('trialAct', { a: 'harvest', bed }, { quiet: true }), i); if (r.x?.won || /complete/.test(r.msg)) won = true; }
      else if (!b) {
        const seeds = Object.entries(t.seeds).filter(([, n]) => n > 0);
        if (seeds.length) await a.evaluate((bed, crop) => window.__mg.act('trialAct', { a: 'plant', bed, crop }, { quiet: true }), i, seeds[0][0]);
        else if (t.id === 'market' && t.coins >= 10) await a.evaluate(() => window.__mg.act('trialAct', { a: 'buy' }, { quiet: true }));
      }
    }
    if (step === 1) { await a.evaluate(() => window.__mg.F.challenge()); await wait(200); await shot(a, '03-challenge'); }
    await wait(2000);
  }
  const me = await a.evaluate(() => ({ medals: window.__mg.store.me.medals, rep: window.__mg.store.me.rep }));
  console.log(`challenge: won=${won} medals=${me.medals} rep=${JSON.stringify(me.rep)}`);
  assert.ok(won && me.medals >= 1, 'won the daily challenge');
  await a.evaluate(() => window.__mg.hud.modal(null));

  // board and balloon: travel there, E opens them
  await a.evaluate(() => window.__mg.act('travel', { to: 'board' }, { quiet: true }));
  await wait(1500);
  await a.keyboard.press('KeyE');
  await wait(400);
  assert.ok((await modalText(a)).includes('Villager orders'), 'board opens with E');
  await shot(a, '04-board');
  await a.evaluate(() => window.__mg.hud.modal(null));
  await a.evaluate(() => window.__mg.act('travel', { to: 'balloon' }, { quiet: true }));
  await wait(1500);
  await a.keyboard.press('KeyE');
  await wait(400);
  assert.ok(await a.evaluate(() => document.querySelector('#dialogue').innerText.includes('Captain Puff')), 'balloon dialogue');
  await shot(a, '05-balloon');
  await a.keyboard.press('Escape');

  // the separate Pet Shop sells the eggs
  await a.evaluate(() => window.__mg.act('travel', { to: 'pets' }, { quiet: true }));
  await wait(1200);
  await a.keyboard.press('KeyE'); await wait(300); await a.keyboard.press('Digit1'); await wait(300);
  assert.ok((await modalText(a)).includes('Legendary Egg'), 'egg shop');
  await shot(a, '06-eggs');
  await a.evaluate(() => window.__mg.hud.modal(null));

  // friends: a second player adds the first by code
  const b = await open('B');
  const codeA = await a.evaluate(async () => (await (await fetch('/api/me')).json()).friendCode);
  const add = await b.evaluate(async (code) => { const r = await fetch('/api/friends/add', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) }); return r.json(); }, codeA);
  assert.ok(add.name, `friend added ${JSON.stringify(add)}`);
  await b.evaluate(() => window.__mg.F.friends());
  await wait(500);
  assert.ok((await modalText(b)).includes(add.name), 'friend listed');
  await shot(b, '07-friends');
  // B sees A's new title/avatar via profile broadcasts
  await a.evaluate(() => window.__mg.act('setAvatar', { hair: '#c0392b' }));
  await wait(800);
  await b.waitForFunction(() => [...window.__mg.store.members.values()].some((m) => m.avatar?.hair === '#c0392b'), { timeout: 10_000 });
  console.log('B sees the new hair colour of A');

  // village list with mute/report
  await b.click('#modal .x').catch(() => {});
  await b.click('[data-panel="room"]'); await wait(300);
  await shot(b, '08-village');

  const errs = [...a.errors, ...b.errors].filter((e) => !/favicon|404|401/.test(e));
  console.log('page errors:', errs.length ? errs : 'none');
  assert.equal(errs.length, 0, 'no page errors');
  console.log('FEATURES E2E OK');
} finally {
  await browser.close();
}
