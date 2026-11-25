// A* pathfinding on a 1 m grid around trees, the fountain and the stalls, with line-of-sight smoothing.
import { walkable } from '@mg/shared/world/village-layout';

const R = 0.42; // player clearance
const free = (x, z) => walkable(x, z, R, true);

/** True when the straight segment a->b is walkable (sampled every 0.4 m). */
export function clearLine(ax, az, bx, bz) {
  const d = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(d / 0.4));
  for (let i = 1; i <= n; i++) { const t = i / n; if (!free(ax + (bx - ax) * t, az + (bz - az) * t)) return false; }
  return true;
}

/**
 * Waypoints from a to b (excluding a), or null if no route was found.
 * @returns {{x:number,z:number}[]|null}
 */
export function findPath(ax, az, bx, bz, maxNodes = 90_000) {
  if (clearLine(ax, az, bx, bz)) return [{ x: bx, z: bz }];
  const margin = 24;
  const minX = Math.floor(Math.min(ax, bx) - margin), minZ = Math.floor(Math.min(az, bz) - margin);
  const W = Math.ceil(Math.max(ax, bx) + margin) - minX, H = Math.ceil(Math.max(az, bz) + margin) - minZ;
  if (W * H > maxNodes) return null;
  const idx = (x, z) => z * W + x;
  const sx = Math.round(ax - minX), sz = Math.round(az - minZ), gx = Math.round(bx - minX), gz = Math.round(bz - minZ);
  const g = new Float32Array(W * H).fill(Infinity), from = new Int32Array(W * H).fill(-1), closed = new Uint8Array(W * H);
  const blocked = new Uint8Array(W * H); // 0 unknown, 1 free, 2 blocked
  const isFree = (x, z) => { const k = idx(x, z); if (!blocked[k]) blocked[k] = free(x + minX, z + minZ) ? 1 : 2; return blocked[k] === 1; };
  const h = (x, z) => Math.hypot(x - gx, z - gz);
  // binary heap of [f, node]
  const heap = [];
  const push = (f, k) => { heap.push([f, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  const start = idx(sx, sz), goal = idx(gx, gz);
  g[start] = 0;
  push(h(sx, sz), start);
  let found = false;
  const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (heap.length) {
    const [, k] = pop();
    if (closed[k]) continue;
    closed[k] = 1;
    if (k === goal) { found = true; break; }
    const x = k % W, z = (k / W) | 0;
    for (const [dx, dz, c] of D) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
      const nk = idx(nx, nz);
      if (closed[nk] || !isFree(nx, nz)) continue;
      if (dx && dz && (!isFree(x + dx, z) || !isFree(x, z + dz))) continue; // no corner cutting
      const ng = g[k] + c;
      if (ng < g[nk]) { g[nk] = ng; from[nk] = k; push(ng + h(nx, nz), nk); }
    }
  }
  if (!found) return null;
  const raw = [];
  for (let k = goal; k !== -1 && k !== start; k = from[k]) raw.push({ x: (k % W) + minX, z: ((k / W) | 0) + minZ });
  raw.reverse();
  raw[raw.length - 1] = { x: bx, z: bz };
  // string pulling: keep only the waypoints needed for clear straight lines
  const out = [];
  let cx = ax, cz = az, i = 0;
  while (i < raw.length) {
    let j = raw.length - 1;
    while (j > i && !clearLine(cx, cz, raw[j].x, raw[j].z)) j--;
    out.push(raw[j]);
    cx = raw[j].x; cz = raw[j].z;
    i = j + 1;
  }
  return out;
}
