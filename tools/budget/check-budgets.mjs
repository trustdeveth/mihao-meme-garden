// Fails if any exported model is over its triangle budget, or a referenced file is missing.
// Reads triangle counts from each GLB's JSON chunk (index accessor counts), so it checks the real files.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PUB = resolve(ROOT, 'client/public');
const mPath = resolve(PUB, 'models/manifest.json');
if (!existsSync(mPath)) { console.log('No models built yet (run npm run models). Skipping budget check.'); process.exit(0); }
const manifest = JSON.parse(readFileSync(mPath, 'utf8'));

const BUDGET = { cropStage: 6000, cropStageL1: 1800, fruit: 1200, character: 14000, prop: 8000, cropFileKB: 400, farmer: 56000 }; // farmer counts every wardrobe item, hood and beard; only about 12k-16k are visible at once

/** Triangles per top-level node prefix, from the GLB's JSON chunk. */
function trianglesByNode(file) {
  const buf = readFileSync(file);
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const meshTris = (mi) => gltf.meshes[mi].primitives.reduce((a, p) => a + (p.indices != null ? gltf.accessors[p.indices].count : gltf.accessors[p.attributes.POSITION].count) / 3, 0);
  const sumNode = (ni) => { const n = gltf.nodes[ni]; return (n.mesh != null ? meshTris(n.mesh) : 0) + (n.children ?? []).reduce((a, c) => a + sumNode(c), 0); };
  const out = { _materials: (gltf.materials ?? []).map((m) => m.name) };
  for (const ni of gltf.scenes[gltf.scene ?? 0].nodes) {
    const root = gltf.nodes[ni];
    for (const c of root.children ?? [ni]) out[gltf.nodes[c].name ?? `node${c}`] = Math.round(sumNode(c));
  }
  return out;
}

const errors = [];
let checked = 0;
for (const [id, e] of Object.entries(manifest.crops ?? {})) {
  const file = resolve(PUB, e.file);
  if (!existsSync(file)) { errors.push(`${id}: missing ${e.file}`); continue; }
  const t = trianglesByNode(file);
  for (let s = 0; s <= 4; s++) {
    if ((t[`stage${s}`] ?? 0) > BUDGET.cropStage) errors.push(`${id} stage${s}: ${t[`stage${s}`]} tris > ${BUDGET.cropStage}`);
    if ((t[`stage${s}_l1`] ?? 0) > BUDGET.cropStageL1) errors.push(`${id} stage${s}_l1: ${t[`stage${s}_l1`]} tris > ${BUDGET.cropStageL1}`);
  }
  if ((t.fruit ?? 0) > BUDGET.fruit) errors.push(`${id} fruit: ${t.fruit} tris > ${BUDGET.fruit}`);
  // guard: compression must keep the named placeholder materials (the client maps materials by name)
  if (t._materials.length < 3 || !t._materials.some((n) => /leaf|foliage|petal|stem/.test(n))) errors.push(`${id}: materials were merged (${t._materials.join(',')})`);
  if (e.bytes / 1024 > BUDGET.cropFileKB) errors.push(`${id}: ${(e.bytes / 1024).toFixed(0)} KB > ${BUDGET.cropFileKB} KB`);
  checked++;
}
for (const [group, limit] of [['characters', BUDGET.character], ['props', BUDGET.prop]]) {
  for (const [id, e] of Object.entries(manifest[group] ?? {})) {
    if (!existsSync(resolve(PUB, e.file))) { errors.push(`${id}: missing ${e.file}`); continue; }
    const max = id === 'farmer' ? BUDGET.farmer : limit;
    if (e.tris > max) errors.push(`${id}: ${e.tris} tris > ${max}`);
    checked++;
  }
}
if (errors.length) {
  console.error(`Model budget check failed (${errors.length}):\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.log(`Model budgets OK (${checked} models).`);
