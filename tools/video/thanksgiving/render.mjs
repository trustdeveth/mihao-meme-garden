// Renders the Happy Thanksgiving video to output/video/mihao-thanksgiving.mp4.
//   node tools/video/thanksgiving/render.mjs            the full video, with music
//   node tools/video/thanksgiving/render.mjs --preview  one still per shot, to check the pictures
// Needs: Chrome, and Python with numpy and imageio-ffmpeg (the music is synthesized by music.py).
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const outDir = resolve(root, 'output/video');
const out = join(outDir, 'mihao-thanksgiving.mp4');
const preview = process.argv.includes('--preview');
mkdirSync(outDir, { recursive: true });

const vite = await createServer({ configFile: false, root: resolve(root, 'client'), logLevel: 'error', server: { host: '127.0.0.1', port: 5333, fs: { allow: [root] } } });
await vite.listen();
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--no-sandbox'],
  protocolTimeout: 600_000,
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) errors.push(`${r.status()} ${r.url()}`); });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto(`http://127.0.0.1:5333/@fs/${here.replace(/\\/g, '/')}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.video, { timeout: 60_000 }).catch((e) => { console.log(errors); throw e; });
  await page.evaluate(() => window.video.build()).catch((e) => { console.log(errors); throw e; });
  const { SHOTS, DURATION, FPS } = await page.evaluate(() => ({ SHOTS: window.video.SHOTS, DURATION: window.video.DURATION, FPS: window.video.FPS }));
  const total = Math.round(DURATION * FPS);
  const grab = async (n) => Buffer.from(await page.evaluate((n) => { window.video.frame(n); return window.video.jpeg(); }, n), 'base64');

  if (preview) {
    const stills = SHOTS.map((s) => Math.round((s.at + s.len * 0.82) * FPS));
    for (let n = 0, i = 0; n < total && i < stills.length; n++) {
      // every frame is stepped (the animations build on each other); only the chosen ones are saved
      if (n === stills[i]) writeFileSync(join(outDir, `thanks-preview-${i++}.jpg`), await grab(n));
      else await page.evaluate((n) => window.video.frame(n), n);
    }
    console.log('previews written to', outDir);
  } else {
    const ff = execFileSync('python', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim();
    const wav = join(outDir, 'thanks-music.wav'), silent = join(outDir, 'thanks-silent.mp4');
    execFileSync('python', [join(here, 'music.py'), wav, JSON.stringify(SHOTS.map((s) => ({ id: s.id, at: s.at, len: s.len })))], { stdio: 'inherit' });
    const enc = spawn(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-', '-vf', 'scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-maxrate', '12M', '-bufsize', '24M', '-pix_fmt', 'yuv420p', silent], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = once(enc, 'close');
    for (let n = 0; n < total; n++) {
      if (!enc.stdin.write(await grab(n))) await once(enc.stdin, 'drain');
      if (n % 90 === 0) console.log(`frame ${n}/${total}`);
    }
    enc.stdin.end();
    const [code] = await done;
    if (code) throw new Error('video encoding failed');
    execFileSync(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-i', silent, '-i', wav, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-shortest', '-movflags', '+faststart', out]);
    rmSync(silent); rmSync(wav);
    console.log(out, `${DURATION}s`);
  }
  if (errors.length) console.log('page errors:', errors.slice(0, 10));
} finally {
  await browser.close();
  await vite.close();
}
