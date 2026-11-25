// Load test: starts a server in this process (temporary database), connects N rooms x 12 bots that
// walk, plant, harvest and chat, then reports event-loop delay, action latency and bandwidth per client.
// Usage: node tools/load/bots.mjs [rooms=5] [seconds=40]
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { createServer } from '../../server/src/app.js';
import { toWorld, PLOT } from '@mg/shared/world/village-layout';

const ROOMS = Number(process.argv[2] ?? 5);
const SECONDS = Number(process.argv[3] ?? 40);
const BOTS = ROOMS * 12;
const dir = mkdtempSync(join(tmpdir(), 'mg-load-'));
const srv = await createServer({ dbPath: join(dir, 'load.db'), secret: 'load', allowNoOrigin: true, guestRate: 1000, guestBurst: 1000 });
await srv.app.listen({ port: 0, host: '127.0.0.1' });
const base = `http://127.0.0.1:${srv.app.server.address().port}`;
const lag = monitorEventLoopDelay({ resolution: 10 });
lag.enable();

const latencies = [];
let bytes = 0, msgs = 0, acted = 0, failed = 0;

async function bot(i) {
  const g = await fetch(`${base}/api/guest`, { method: 'POST' });
  const cookie = g.headers.get('set-cookie').split(';')[0];
  const { ticket } = await (await fetch(`${base}/api/ws-ticket`, { method: 'POST', headers: { cookie } })).json();
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?ticket=${ticket}`);
  const pending = new Map();
  let seq = 0, slot = 0, pos = null, plants = [];
  await new Promise((r) => ws.on('open', r));
  ws.on('message', (d) => {
    bytes += d.length; msgs++;
    const m = JSON.parse(String(d));
    if (m.t === 'welcome') { slot = m.you.slot; seq = m.lastSeq; const g0 = toWorld(slot, 0, PLOT.gateZ + 1.6); pos = { x: g0.x, z: g0.z }; }
    if (m.t === 'res') { const t = pending.get(m.id); if (t) { latencies.push(performance.now() - t); pending.delete(m.id); } if (m.ok) acted++; else failed++; if (m.d?.plants) plants = m.d.plants; }
    if (m.t === 'fix') pos = { x: m.x, z: m.z };
  });
  ws.send(JSON.stringify({ t: 'hello', v: 1 }));
  while (!pos) await new Promise((r) => setTimeout(r, 20));
  const act = (a, p) => { const id = ++seq; pending.set(id, performance.now()); ws.send(JSON.stringify({ t: 'act', id, a, p })); };
  // walk into the garden
  const inside = toWorld(slot, 0, 1.5);
  // at a legal running speed (about 6 m/s), however far the gate is
  const steps = Math.ceil(Math.hypot(inside.x - pos.x, inside.z - pos.z) / 0.9);
  for (let k = 1; k <= steps; k++) { pos = { x: pos.x + (inside.x - pos.x) / (steps + 1 - k), z: pos.z + (inside.z - pos.z) / (steps + 1 - k) }; ws.send(JSON.stringify({ t: 'mv', x: pos.x, z: pos.z, ry: 0, an: 2 })); await new Promise((r) => setTimeout(r, 150)); }
  const end = Date.now() + SECONDS * 1000;
  let t = 0;
  while (Date.now() < end && ws.readyState === 1) {
    t++;
    const home = toWorld(slot, Math.sin(t / 10 + i) * 1.2, 1.5 + Math.cos(t / 10 + i) * 0.8);
    ws.send(JSON.stringify({ t: 'mv', x: home.x, z: home.z, ry: t / 10, an: 1 }));
    if (t % 20 === 0) act('plant', { crop: 'carrot', x: Math.round((Math.random() - 0.5) * 30) / 10, z: Math.round((Math.random() - 0.5) * 24) / 10 });
    if (t % 25 === 5 && plants.length) act('harvest', { id: plants[0].id });
    if (t % 30 === 7) act('buySeed', { id: 'carrot', n: 1 });
    if (t % 120 === i % 120) ws.send(JSON.stringify({ t: 'chat', text: `bot ${i} says hi` }));
    await new Promise((r) => setTimeout(r, 100));
  }
  ws.close();
}

console.log(`Starting ${BOTS} bots in ${ROOMS} rooms for ${SECONDS}s...`);
const t0 = Date.now();
await Promise.all(Array.from({ length: BOTS }, (_, i) => new Promise((r) => setTimeout(r, i * 25)).then(() => bot(i))));
const secs = (Date.now() - t0) / 1000;
lag.disable();
latencies.sort((a, b) => a - b);
const q = (p) => latencies[Math.floor(latencies.length * p)]?.toFixed(1) ?? '-';
console.log(`Rooms: ${srv.rooms.stats().rooms}, actions ok/failed: ${acted}/${failed}`);
console.log(`Event-loop delay: p50 ${(lag.percentile(50) / 1e6).toFixed(1)} ms, p95 ${(lag.percentile(95) / 1e6).toFixed(1)} ms, max ${(lag.max / 1e6).toFixed(1)} ms`);
console.log(`Action latency: p50 ${q(0.5)} ms, p95 ${q(0.95)} ms`);
console.log(`Downstream per client: ${(bytes / BOTS / secs / 1024).toFixed(2)} KB/s (${(msgs / BOTS / secs).toFixed(1)} msgs/s)`);
await srv.app.close();
rmSync(dir, { recursive: true, force: true });
const ok = lag.percentile(95) / 1e6 < 20;
console.log(ok ? 'Load test within targets.' : 'Load test over the 20 ms p95 event-loop target.');
process.exit(ok ? 0 : 1);
