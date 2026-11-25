// Builds all models/textures in headless Chrome and writes them to client/public.
// Usage: node tools/models/run.mjs [--only carrot,tomato|crops|characters|props] [--no-review] [--no-textures]
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { compressGLB } from './compress.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const only = opt('--only')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null;
const skip = opt('--skip')?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.glb': 'model/gltf-binary' };
const server = http.createServer(async (req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = normalize(resolve(ROOT, `.${url}`));
  if (!file.startsWith(ROOT + sep) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(await readFile(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

// Only these folders may be written by the page.
const ALLOWED = ['client/public/models/', 'client/public/textures/', 'client/public/icons/', 'tools/review/out/'];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
  protocolTimeout: 600_000,
});
try {
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[page ${m.type()}]`, m.text()); });
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  let written = 0;
  const glbs = [];
  await page.exposeFunction('mgSave', async (rel, b64) => {
    const clean = rel.replace(/\\/g, '/');
    if (clean.includes('..') || !ALLOWED.some((a) => clean.startsWith(a))) throw new Error(`write not allowed: ${rel}`);
    const out = resolve(ROOT, clean);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, Buffer.from(b64, 'base64'));
    if (out.endsWith('.glb')) glbs.push(out);
    written++;
    return true;
  });
  await page.goto(`http://127.0.0.1:${port}/tools/models/page/index.html`);
  await page.waitForFunction('window.mgReady === true', { timeout: 60_000 });
  const t0 = Date.now();
  if (opt('--film')) {
    const [ch, clip] = opt('--film').split(':');
    if (flag('--close')) await page.evaluate(() => { window.mgCloseHand = true; });
    await page.evaluate((c, k) => window.mgFilmstrip(c, k), ch, clip);
    console.log(`Filmstrip written for ${ch}:${clip}`);
  } else if (flag('--farmer-debug')) {
    console.log(JSON.stringify(await page.evaluate(() => window.mgFarmerDebug())));
  } else if (flag('--farmer-probe')) {
    console.log(JSON.stringify(await page.evaluate(() => window.mgFarmerProbe()), null, 1));
  } else if (flag('--icons')) {
    const n = await page.evaluate(() => window.mgIcons());
    console.log(`Rendered ${n} crop icons in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } else {
  const manifest = await page.evaluate((o) => window.mgBuild(o), { only, review: !flag('--no-review'), textures: !flag('--no-textures'), skip, portrait: flag('--portrait') });
  // compress every exported model (quantize + meshopt)
  let before = 0, after = 0;
  const sizes = {};
  for (const f of glbs) {
    const [b, a] = await compressGLB(f);
    before += b; after += a;
    sizes[f.split(sep).join('/').split('/client/public/')[1]] = a;
  }
  if (glbs.length) console.log(`Compressed ${glbs.length} models: ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB`);
  for (const group of [manifest.crops, manifest.characters, manifest.props]) for (const e of Object.values(group)) if (sizes[e.file]) e.bytes = sizes[e.file];
  // merge with an existing manifest so partial builds keep other entries
  const mPath = resolve(ROOT, 'client/public/models/manifest.json');
  const old = existsSync(mPath) ? JSON.parse(readFileSync(mPath, 'utf8')) : { crops: {}, characters: {}, props: {}, textures: [] };
  const merged = {
    version: 1,
    crops: { ...old.crops, ...manifest.crops },
    characters: { ...old.characters, ...manifest.characters },
    props: { ...old.props, ...manifest.props },
    textures: manifest.textures.length ? manifest.textures : old.textures,
  };
  await writeFile(mPath, JSON.stringify(merged, null, 2));
  console.log(`Wrote ${written} files in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  for (const [id, c] of Object.entries(manifest.crops)) console.log(`  ${id.padEnd(14)} lod0 ${c.lod0.join('/')}  lod1 ${c.lod1.join('/')}  fruit ${c.fruit}  anchors ${c.anchors}  ${(c.bytes / 1024).toFixed(0)} KB`);
  for (const [id, c] of Object.entries({ ...manifest.characters, ...manifest.props })) console.log(`  ${id.padEnd(14)} tris ${c.tris}  ${(c.bytes / 1024).toFixed(0)} KB`);
  }
} finally {
  await browser.close();
  server.close();
}
