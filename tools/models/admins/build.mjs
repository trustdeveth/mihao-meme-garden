// Builds the ten Mihao admin models into output/models/admins.
//   node tools/models/admins/build.mjs              .glb files, portraits and full-body pictures
//   node tools/models/admins/build.mjs --pictures   pictures only (a quick check)
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization, KHRMaterialsClearcoat, KHRMaterialsUnlit, KHRMaterialsEmissiveStrength } from '@gltf-transform/extensions';
import { dedup, join as joinMeshes } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import { compressGLB } from '../compress.mjs';
import { ADMIN_CATS } from '../../../shared/src/data/admin-cats.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const out = resolve(root, 'output/models/admins');
const picturesOnly = process.argv.includes('--pictures');
mkdirSync(join(out, 'pictures'), { recursive: true });
const game = resolve(root, 'client/public/models/admins');
mkdirSync(game, { recursive: true });

const vite = await createServer({ configFile: false, root: resolve(root, 'client'), logLevel: 'error', server: { host: '127.0.0.1', port: 5334, fs: { allow: [root] } } });
await vite.listen();
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--no-sandbox'], protocolTimeout: 600_000 });
const messages = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => messages.push(e.message));
  page.on('console', (m) => { if (['error', 'warn', 'warning'].includes(m.type()) && !m.text().includes('404')) messages.push(m.text()); });
  await page.goto(`http://127.0.0.1:5334/@fs/${here.replace(/\\/g, '/')}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.admins, { timeout: 60_000 }).catch((e) => { console.log(messages); throw e; });
  await page.evaluate(() => window.admins.init());
  const list = await page.evaluate(() => window.admins.list);
  if (list.map((l) => l.id).join() !== ADMIN_CATS.map((c) => c.id).join()) throw new Error('shared/src/data/admin-cats.js and looks.js list different cats');
  for (const [i, { id }] of list.entries()) {
    const file = `${String(i + 1).padStart(2, '0')}-${id}`;
    try {
      for (const [view, w, h] of [['portrait', 800, 800], ['full', 800, 1000]]) {
        writeFileSync(join(out, 'pictures', `${file}-${view}.png`), Buffer.from(await page.evaluate((...a) => window.admins.shot(...a), id, view, w, h), 'base64'));
      }
      if (picturesOnly) { console.log(file, 'pictures done'); continue; }
      const g = await page.evaluate((id) => window.admins.exportGLB(id), id);
      const bytes = Buffer.from(g.data, 'base64');
      writeFileSync(join(out, `${file}.glb`), bytes);
      console.log(`${file}.glb  ${(bytes.length / 1048576).toFixed(2)} MB  meshes ${g.meshes}  triangles ${g.tris}  animations ${g.clips.length}`);
      // the copy the game loads: parts on the same bone joined into one (fewer draw calls), then compressed
      const small = join(game, `${id}.glb`);
      writeFileSync(small, Buffer.from((await page.evaluate((i) => window.admins.exportGLB(i, { forGame: true }), id)).data, 'base64'));
      await MeshoptDecoder.ready;
      const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization, KHRMaterialsClearcoat, KHRMaterialsUnlit, KHRMaterialsEmissiveStrength]).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
      const doc = await io.read(small);
      await doc.transform(dedup(), joinMeshes({ keepNamed: false }));
      await io.write(small, doc);
      const [, after] = await compressGLB(small);
      const meshes = doc.getRoot().listNodes().filter((n) => n.getMesh()).length;
      console.log(`    game copy ${(after / 1048576).toFixed(2)} MB, ${meshes} mesh nodes`);
    } catch (e) { console.log(file, 'FAILED', e.message.slice(0, 600)); process.exitCode = 1; }
  }
} finally {
  if (messages.length) console.log('page messages:', [...new Set(messages)].slice(0, 12));
  await browser.close();
  await vite.close();
}
