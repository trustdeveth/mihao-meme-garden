// Browser check of the meme features with two players, on a throwaway server and database.
// Usage: npm run build && node e2e/memes.mjs   (screenshots and the saved photo go to e2e/out/meme-*.png)
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server/src/app.js';
import { STALLS } from '../shared/src/world/village-layout.js';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, 'out');
mkdirSync(OUT, { recursive: true });
const dir = join(tmpdir(), `mg-meme-e2e-${Date.now()}`);
mkdirSync(dir, { recursive: true });
const PORT = 8862;
const base = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const { app, rooms, db } = await createServer({ dbPath: join(dir, 'e2e.db'), secret: 'e2e', origins: [base], staticDir: resolve(here, '../client/dist') });
await app.listen({ port: PORT, host: '127.0.0.1' });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  protocolTimeout: 300_000,
});
const errors = [];
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`); };

async function player(tag) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 860, height: 560 });
  page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
  // capture downloads instead of writing them to disk
  await page.evaluateOnNewDocument(() => {
    window.__downloads = [];
    window.__seen = new Set(); // every speech bubble that ever appeared
    new MutationObserver(() => { for (const el of document.querySelectorAll('.bubble')) window.__seen.add(el.textContent); }).observe(document, { subtree: true, childList: true, characterData: true });
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function patched() { if (this.download) window.__downloads.push({ name: this.download, href: this.href }); else click.call(this); };
  });
  await page.goto(`${base}/?debug`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loading.done', { timeout: 180_000 });
  await page.evaluate(() => document.querySelector('#modal:not([hidden]) #okBtn')?.click());
  await wait(600);
  return page;
}
const slotOf = (page) => page.evaluate(() => window.__mg.store.you.slot);
const memberOf = (slot) => [...rooms.byPlayer.values()].find((e) => e.member.slot === slot).member;
const text = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent ?? '', sel);
const clickIn = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; el.click(); return true; }, sel);
/** Put a player somewhere, on both the server and the client. */
async function place(page, x, z) {
  const m = memberOf(await slotOf(page));
  Object.assign(m.pos, { x, z });
  m.moved = true; // tell the others
  await page.evaluate((px, pz) => window.__mg.player.fix(px, pz, true), x, z);
  await wait(400);
}

try {
  const a = await player('A');
  const b = await player('B');
  const sa = await slotOf(a), sb = await slotOf(b);

  await a.bringToFront();
  await clickIn(a, '#memeBtn');
  check('Cam bar opens with six poses', await a.evaluate(() => document.querySelectorAll('#memebar [data-pose]').length === 6));

  await clickIn(a, '#memebar [data-pose="point"]');
  await wait(900);
  check('pose is held', await a.evaluate(() => window.__mg.player.an === 9));
  await wait(500);
  check('the other player receives the pose', memberOf(sa).pos.an === 9);

  await clickIn(a, '#memebar [data-pose="dance"]');
  await wait(300);
  check('locked pose asks to be unlocked', (await text(a, '#modalCard')).includes('Meme Points'));
  await clickIn(a, '#modalCard .x');

  await clickIn(a, '#memebar [data-line="1"]');
  await wait(700);
  check('speech bubble shows for me', (await a.evaluate(() => window.__mg.bubbles())).includes('any last words?'));
  await b.bringToFront();
  await wait(700);
  await b.waitForFunction(() => window.__seen.has('any last words?'), { timeout: 20_000, polling: 200 }).catch(() => {});
  check('speech bubble shows for the neighbour', (await b.evaluate(() => window.__seen.has('any last words?'))));
  await a.bringToFront();

  await clickIn(a, '#memebar [data-do="selfie"]');
  await wait(1200);
  await a.screenshot({ path: `${OUT}/meme-01-bar.png` });

  const spot = await a.evaluate(() => {
    document.querySelector('#memebar [data-line="0"]').click();
    const r = document.querySelector('#labels .bubble').getBoundingClientRect();
    document.querySelector('#memebar [data-do="photo"]').click();
    return { x: r.left + r.width / 2, y: r.top };
  });
  check('the bubble is already over the head when the photo is taken', spot.x > 200 && spot.x < 660 && spot.y > 20, `${Math.round(spot.x)}, ${Math.round(spot.y)}`);
  await wait(1200);
  const photo = await a.evaluate(() => window.__downloads.at(-1) ?? null);
  check('photo is saved', !!photo && photo.name.startsWith('mihao-') && photo.href.startsWith('data:image/png'));
  if (photo) writeFileSync(`${OUT}/meme-02-photo.png`, Buffer.from(photo.href.split(',')[1], 'base64'));

  const fps = await a.evaluate(() => new Promise((done) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 4000) requestAnimationFrame(f); else done(Math.round((n / (performance.now() - t0)) * 10000) / 10); }; requestAnimationFrame(f); }));
  console.log(`     frame rate in this headless browser: ${fps} fps`);
  await clickIn(a, '#memebar [data-do="record"]');
  await wait(13_000);
  await clickIn(a, '#memebar [data-do="record"]');
  await a.waitForSelector('#modalCard video', { timeout: 20_000 }).catch(() => {});
  const clip = await a.evaluate(async () => {
    const v = document.querySelector('#modalCard video');
    if (!v) return null;
    const blob = await (await fetch(v.src)).blob();
    return { size: blob.size, type: blob.type };
  });
  check('clip is recorded', !!clip && clip.size > 10_000, clip ? `${clip.type}, ${Math.round(clip.size / 1024)} KB` : 'no video');
  await clickIn(a, '#mmDl');
  check('clip can be downloaded', await a.evaluate(() => /^mihao-clip-.*\.(mp4|webm)$/.test(window.__downloads.at(-1)?.name ?? '')));
  await clickIn(a, '#modalCard .x');

  await clickIn(a, '#memebar [data-do="clean"]');
  await wait(300);
  check('hide interface hides the HUD', await a.evaluate(() => getComputedStyle(document.querySelector('#hud')).display === 'none'));
  await a.screenshot({ path: `${OUT}/meme-03-clean.png` });
  await a.keyboard.press('KeyH');
  await wait(300);
  check('H brings it back', await a.evaluate(() => getComputedStyle(document.querySelector('#hud')).display !== 'none'));

  // two-player Beard Battle: B stands next to A and accepts
  const pa = memberOf(sa).pos;
  await place(b, pa.x + 1.6, pa.z);
  memberOf(sa).duelAt = 0;
  await a.bringToFront();
  await wait(500);
  await a.evaluate(() => { if (document.querySelector('#memebar').hidden) document.querySelector('#memeBtn').click(); });
  await a.bringToFront();
  await a.waitForFunction((other) => { const e = window.__mg.chars.avatars.get(other); return !!e && e.avatar.root.position.distanceTo(window.__mg.player.pos) < 3; }, { timeout: 30_000, polling: 200 }, sb).catch(() => {});
  await clickIn(a, '#memebar [data-do="beard"]');
  await b.bringToFront();
  await b.waitForSelector('#duelYes', { timeout: 14_000 }).catch(() => {});
  check('the other player is asked first', (await text(b, '#duelcard')).includes('challenges you'));
  await clickIn(b, '#duelYes');
  await b.waitForFunction(() => [...window.__seen].filter((t) => /my beard/.test(t)).length >= 2, { timeout: 30_000, polling: 200 }).catch(() => {});
  const lengths = await b.evaluate(() => [...window.__seen].filter((t) => /my beard: \d+ cm/.test(t)));
  check('Beard Battle shows both beards', lengths.length === 2, lengths.join(' vs '));
  await b.screenshot({ path: `${OUT}/meme-04-beard.png` });

  // Pointing Contest against Gus
  await a.bringToFront();
  const gus = STALLS.find((s) => s.id === 'market');
  await place(a, gus.x * 0.7, gus.z * 0.7);
  memberOf(sa).duelAt = 0;
  await clickIn(a, '#memebar [data-do="pointing"]');
  await a.waitForSelector('#duelTap', { timeout: 8000 }).catch(() => {});
  check('Pointing Contest starts against Gus', (await text(a, '#duelcard')).includes('Pointing Contest'));
  await a.waitForFunction(() => document.querySelector('#duelState')?.textContent === 'POINT NOW!', { timeout: 12_000, polling: 30 }).catch(() => {});
  await a.keyboard.press('KeyQ');
  await wait(1500);
  check('Pointing Contest ends with a result', await a.evaluate(() => document.querySelector('#duelcard').hidden && /wins|win|draw/i.test(document.querySelector('#toast').textContent)), await text(a, '#toast'));

  // Official Inspection
  await clickIn(a, '[data-travel="garden"]');
  await wait(1200);
  const me = memberOf(sa);
  me.state.meme.inspection = { x: 0, z: 8.5, until: Date.now() + 90_000 };
  me.state.meme.inspectAt = Date.now() + 3_600_000;
  me.state.surprise = null;
  me.state.surpriseAt = Date.now() + 3_600_000;
  me.ws.send(JSON.stringify({ t: 'sync', d: { meme: me.state.meme, surprise: null } }));
  await a.waitForFunction(() => !!window.__mg.meme.inspectorSpot(), { timeout: 90_000, polling: 300 }).catch(() => {});
  await wait(2500);
  await a.screenshot({ path: `${OUT}/meme-05-inspection.png` });
  const near = await a.evaluate(() => window.__mg.meme.inspectorSpot() && { x: window.__mg.meme.inspectorSpot().x, z: window.__mg.meme.inspectorSpot().z });
  check('the inspector walks in', !!near);
  if (near) {
    await place(a, near.x + 1.2, near.z);
    await a.waitForFunction(() => document.querySelector('#prompt').textContent.includes('Official Inspection'), { timeout: 40_000, polling: 300 }).catch(() => {});
    check('prompt offers the inspection', (await text(a, '#prompt')).includes('Official Inspection'));
    await a.keyboard.press('KeyE');
    await a.waitForFunction(() => /Inspection (passed|FAILED)/.test(document.querySelector('#toast').textContent), { timeout: 20_000, polling: 200 }).catch(() => {});
    check('inspection gives a verdict', /Inspection (passed|FAILED)/.test(await text(a, '#toast')), await text(a, '#toast'));
  }

  // weather and sale reactions
  await wait(4000);
  const reacted = await a.evaluate(() => window.__mg.meme.moment('rain', { force: true }));
  await a.waitForFunction(() => window.__seen.has('still mihao'), { timeout: 20_000, polling: 200 }).catch(() => {});
  check('a weather moment plays with an umbrella pose', reacted && (await a.evaluate(() => window.__seen.has('still mihao'))));
  // picture it with the game's own photo button, which renders at once (a screenshot is too slow here for a 3 s moment)
  await wait(8_000);
  const rain = await a.evaluate(() => { document.querySelector('#memebar').hidden = true; window.__mg.meme.moment('rain', { force: true }); window.__mg.meme.photo(); return window.__downloads.at(-1)?.href ?? ''; });
  if (rain.startsWith('data:image/png')) writeFileSync(`${OUT}/meme-06-rain.png`, Buffer.from(rain.split(',')[1], 'base64'));
  await a.keyboard.down('KeyW');
  await wait(500);
  await a.keyboard.up('KeyW');
  check('walking ends a pose at once (controls never locked)', await a.evaluate(() => window.__mg.player.pose === 0));

  await a.evaluate(() => window.__mg.meme.stampsPanel());
  await wait(800);
  check('stamps panel opens', (await text(a, '#modalCard')).includes('Mihao stamps'));
  await clickIn(a, '#modalCard .x');
  await a.evaluate(() => window.__mg.meme.challengePanel());
  await wait(800);
  check('weekly challenge panel opens', (await text(a, '#modalCard')).includes('#MihaoGarden'));
  await a.screenshot({ path: `${OUT}/meme-07-challenge.png` });
  // ---- instant replay: switch it on, play on, then keep what just happened with one click ----
  await a.evaluate(() => { document.querySelector('#modal .x')?.click(); if (document.querySelector('#memebar').hidden) document.querySelector('#memeBtn').click(); });
  check('instant replay starts switched off', await a.evaluate(() => !document.querySelector('#mmReplay').checked && document.querySelector('#replayBtn').hidden));
  await clickIn(a, '#mmReplay');
  await wait(1500);
  check('switching it on shows the Save last moment button', await a.evaluate(() => !document.querySelector('#replayBtn').hidden && window.__mg.meme.replay.active));
  await wait(26_000); // long enough for the two recordings to take turns
  const rolling = await a.evaluate(() => ({ seconds: window.__mg.meme.replay.seconds, recorders: window.__mg.meme.replay.segs.length }));
  check('it keeps a rolling window of the recent past', rolling.recorders <= 2 && rolling.seconds >= 6 && rolling.seconds <= 20, `${rolling.seconds.toFixed(1)}s held, ${rolling.recorders} recorders`);
  const videoSize = () => a.evaluate(async () => { const v = document.querySelector('#modalCard video'); return v ? (await (await fetch(v.src)).blob()).size : 0; });
  for (const round of [1, 2]) {
    await clickIn(a, '#replayBtn'); // one click
    await a.waitForSelector('#modalCard video', { timeout: 30_000 }).catch(() => {});
    const size = await videoSize();
    check(`one click saves a replay (${round})`, size > 10_000, `${Math.round(size / 1024)} KB`);
    // a big file is not enough: the browser must be able to open it and decode a picture
    const play = await a.evaluate(() => new Promise((done) => {
      const src = document.querySelector('#modalCard video')?.src;
      if (!src) return done({ w: 0 });
      const v = document.createElement('video');
      v.muted = true;
      v.onloadeddata = () => done({ w: v.videoWidth, h: v.videoHeight, ready: v.readyState });
      v.onerror = () => done({ w: 0, error: v.error?.message });
      v.src = src;
      setTimeout(() => done({ w: v.videoWidth, h: v.videoHeight, ready: v.readyState }), 20_000);
    }));
    check(`the saved replay plays (${round})`, play.w > 0 && play.ready >= 2, JSON.stringify(play));
    await clickIn(a, '#modalCard .x');
    if (round === 1) await wait(10_000);
  }
  check('replay keeps running after a save', await a.evaluate(() => window.__mg.meme.replay.active));
  await a.evaluate(() => { if (document.querySelector('#memebar').hidden) document.querySelector('#memeBtn').click(); });
  await clickIn(a, '#mmReplay');
  await wait(600);
  check('switching it off stops recording', await a.evaluate(() => !window.__mg.meme.replay.active && document.querySelector('#replayBtn').hidden));

  // ---- challenge entry: send in the game, approve with the real admin command ----
  await a.evaluate(() => window.__mg.meme.challengePanel());
  await a.waitForSelector('#chUrl', { timeout: 15_000 });
  const submit = (url, title) => a.evaluate((u, t) => { document.querySelector('#chUrl').value = u; document.querySelector('#chTitle').value = t; document.querySelector('#chForm button').click(); }, url, title);
  await submit('https://x.com/mihaofan/status/1234567890', ''); // no title: the challenge name is used
  await a.waitForFunction(() => document.querySelector('#modalCard').textContent.includes('Waiting for a moderator'), { timeout: 20_000, polling: 200 }).catch(() => {});
  check('an entry is sent from the game and waits for review', (await text(a, '#modalCard')).includes('Waiting for a moderator'));
  check('a waiting entry is not public', (await text(a, '#modalCard')).includes('Nothing featured yet'));
  const admin = async (...args) => (await promisify(execFile)(process.execPath, [resolve(here, '../tools/challenge-admin.mjs'), ...args, '--db', join(dir, 'e2e.db')])).stdout;
  const listed = await admin('list');
  const id = /#(\d+)/.exec(listed)?.[1];
  check('the admin command lists it', !!id && listed.includes('https://x.com/mihaofan/status/1234567890'));
  await admin('feature', id ?? '0');
  await a.evaluate(() => window.__mg.meme.challengePanel());
  await a.waitForFunction(() => document.querySelector('#modalCard').textContent.includes('Featured this week. mihao!'), { timeout: 20_000, polling: 200 }).catch(() => {});
  check('after approval it is featured in the game', await a.evaluate(() => !!document.querySelector('#modalCard a[href="https://x.com/mihaofan/status/1234567890"]') && !document.querySelector('#chForm')));
  await a.screenshot({ path: `${OUT}/meme-08-entry.png` });
  await clickIn(a, '#modalCard .x');

  // ---- the new names reach the screen ----
  const names = await a.evaluate(() => [...document.querySelectorAll('#hotbar [title]')].map((x) => x.title).join(', '));
  check('crops show their mihao names', names.includes('Mihao Carrot seed'), names);
  await a.evaluate(() => window.__mg.F.rebirth());
  await wait(900);
  const promo = await text(a, '#modalCard');
  check('Rebirth is now Promotion, with the new home name', promo.includes('Promotion') && promo.includes('Rank Star') && promo.includes("Magistrate's Treehouse") && !promo.includes('Rebirth'));
  await a.screenshot({ path: `${OUT}/meme-09-promotion.png` });
  await clickIn(a, '#modalCard .x');
  check('no page errors', !errors.length, errors.join(' | '));
} finally {
  await browser.close();
  await app.close();
}
const failed = results.filter((r) => !r).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
