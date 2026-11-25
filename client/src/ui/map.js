// The Mihao village map: the round one in the corner and the big one that opens when you click it.
// It only reads the game state. Travel buttons use the same travel the top bar already offers.
import { PLOT_SLOTS, STALLS, WORLD_RADIUS, PLOT, FOREST, PATHS, PLAZA_RADIUS, BALLOON, BOARD } from '@mg/shared/world/village-layout';

const INK = '#17120F', CREAM = '#FFF4DC', GOLD = '#F2B632', RED = '#C8202A';
const STALL = { seeds: { icon: 'seeds', color: '#C8202A', name: 'Seeds' }, market: { icon: 'sell', color: '#F2B632', name: 'Market' }, gadgets: { icon: 'shop', color: '#2A4FA0', name: 'Gadgets' }, pets: { icon: 'paw', color: '#E0479E', name: 'Pets' } };
const EXTRA = [{ ...BALLOON, icon: 'balloon', color: '#7C3AED', name: 'Sky Balloon' }, { ...BOARD, icon: 'board', color: '#2E9B5E', name: 'Notice Board' }];

const images = new Map(); // icon id -> picture, taken from the same sprite the interface uses
async function loadIcons(ids) {
  try {
    const text = await (await fetch('/icons/sprite.svg')).text();
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    for (const id of ids) {
      const symbol = doc.getElementById(id);
      if (!symbol) continue;
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="96" height="96">${symbol.innerHTML}</svg>`)}`;
      images.set(id, img);
    }
  } catch { /* the map still works with plain dots */ }
}

export class MapView {
  constructor(store) {
    this.store = store;
    this.layers = new Map(); // size -> the unchanging picture of the land
    loadIcons([...Object.values(STALL).map((s) => s.icon), ...EXTRA.map((s) => s.icon), 'user']);
  }

  /** Grass, woods, paths and plaza, painted once for each map size. */
  land(S) {
    let layer = this.layers.get(S);
    if (layer) return layer;
    layer = document.createElement('canvas');
    layer.width = layer.height = S;
    const c = layer.getContext('2d');
    const k = S / (WORLD_RADIUS * 2.06), mid = S / 2, X = (x) => mid + x * k, U = k;
    const grass = c.createRadialGradient(mid, mid, 10, mid, mid, mid);
    grass.addColorStop(0, '#A9E06A'); grass.addColorStop(0.75, '#7CC84E'); grass.addColorStop(1, '#4E9E3C');
    c.fillStyle = grass; c.fillRect(0, 0, S, S);
    // Roblox studs
    c.fillStyle = 'rgba(255,255,255,.13)';
    for (let x = 0; x < S; x += S / 34) for (let y = 0; y < S; y += S / 34) { c.beginPath(); c.arc(x, y, S / 190, 0, 7); c.fill(); }
    // paths with a darker edge
    for (const [width, color] of [[9, '#9A6E3C'], [6.2, '#EBCB98']]) {
      c.strokeStyle = color; c.lineWidth = width * U; c.lineCap = 'round';
      for (const { a, b } of PATHS) { c.beginPath(); c.moveTo(X(a.x), X(a.z)); c.lineTo(X(b.x), X(b.z)); c.stroke(); }
    }
    // woods: shadow, crown and a highlight; some are blossom trees
    FOREST.trees.forEach((t, i) => {
      const r = Math.max(1.4, 2.1 * t.s * U), x = X(t.x), y = X(t.z);
      c.fillStyle = 'rgba(20,50,15,.28)'; c.beginPath(); c.arc(x + r * 0.35, y + r * 0.4, r, 0, 7); c.fill();
      c.fillStyle = i % 13 === 0 ? '#F48FB4' : t.type === 3 ? '#2C6B34' : i % 3 ? '#3D8E36' : '#54A83E';
      c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
      c.fillStyle = 'rgba(255,255,255,.25)'; c.beginPath(); c.arc(x - r * 0.3, y - r * 0.35, r * 0.38, 0, 7); c.fill();
    });
    // the plaza: an eight-sided court with the fountain pond
    const eight = (r) => { c.beginPath(); for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 8; c[i ? 'lineTo' : 'moveTo'](mid + Math.cos(a) * r * U, mid + Math.sin(a) * r * U); } c.closePath(); };
    eight(PLAZA_RADIUS + 4); c.fillStyle = RED; c.fill(); c.lineWidth = S / 190; c.strokeStyle = INK; c.stroke();
    eight(PLAZA_RADIUS + 1.8); c.fillStyle = '#F6DFAF'; c.fill();
    c.fillStyle = '#4BB4F0'; c.beginPath(); c.arc(mid, mid, 5 * U, 0, 7); c.fill(); c.strokeStyle = GOLD; c.lineWidth = 1.8 * U; c.stroke();
    this.layers.set(S, layer);
    return layer;
  }

  badge(c, icon, x, y, r, color) {
    c.fillStyle = INK; c.beginPath(); c.arc(x, y + r * 0.14, r * 1.12, 0, 7); c.fill();
    c.fillStyle = color; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
    c.lineWidth = r * 0.16; c.strokeStyle = CREAM; c.stroke();
    const img = images.get(icon);
    if (img?.complete && img.naturalWidth) c.drawImage(img, x - r * 0.78, y - r * 0.78, r * 1.56, r * 1.56);
  }

  label(c, text, x, y, size, fill = '#fff') {
    c.font = `400 ${size}px Impact, "Arial Black", sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineJoin = 'round'; c.lineWidth = size * 0.28; c.strokeStyle = INK;
    c.strokeText(text, x, y); c.fillStyle = fill; c.fillText(text, x, y);
  }

  draw(canvas, { pos, ry, members, mySlot, labels = false }) {
    const S = canvas.width, c = canvas.getContext('2d');
    const k = S / (WORLD_RADIUS * 2.06), mid = S / 2, X = (v) => mid + v * k;
    const unit = labels ? S / 640 : S / 380; // size of markers and text
    const now = performance.now() / 1000;
    c.clearRect(0, 0, S, S);
    c.drawImage(this.land(S), 0, 0);

    // gardens: a fenced square with a green tiled roof at the back
    const byslot = new Map(members.map((m) => [m.slot, m]));
    for (const s of PLOT_SLOTS) {
      const mine = s.index === mySlot, taken = byslot.has(s.index), g = this.store.gardens.get(s.index);
      const plants = g ? [...g.plants.values()] : [];
      const ripe = plants.some((p) => p.fruit);
      const w = PLOT.w * k * 0.86, d = PLOT.d * k * 0.86;
      c.save(); c.translate(X(s.x), X(s.z)); c.rotate(-s.rotY);
      if (mine) { const glow = 1 + Math.sin(now * 4) * 0.5; c.strokeStyle = `rgba(255,226,74,${0.55 + glow * 0.2})`; c.lineWidth = (6 + glow * 3) * unit; c.strokeRect(-w / 2 - 3 * unit, -d / 2 - 3 * unit, w + 6 * unit, d + 6 * unit); }
      c.fillStyle = taken ? '#A9703F' : '#8FBF5C'; c.fillRect(-w / 2, -d / 2, w, d);
      c.strokeStyle = taken ? RED : '#4F7A34'; c.lineWidth = 3 * unit; c.strokeRect(-w / 2, -d / 2, w, d);
      if (taken) { // little rows, greener the more is planted
        c.fillStyle = plants.length ? '#59C447' : '#8A5A32';
        const rows = Math.min(9, plants.length || 6);
        for (let i = 0; i < rows; i++) c.fillRect(-w * 0.34 + (i % 3) * w * 0.27, -d * 0.12 + ((i / 3) | 0) * d * 0.18, w * 0.15, d * 0.09);
        c.fillStyle = mine ? GOLD : '#1F7A4A';
        c.beginPath(); c.moveTo(-w * 0.46, -d * 0.24); c.lineTo(-w * 0.28, -d * 0.52); c.lineTo(w * 0.28, -d * 0.52); c.lineTo(w * 0.46, -d * 0.24); c.closePath(); c.fill(); c.strokeStyle = INK; c.lineWidth = 1.6 * unit; c.stroke();
      }
      c.restore();
      if (ripe) for (let i = 0; i < 2; i++) { // sparkles: something is ready to pick
        const a = now * 2 + i * Math.PI, x = X(s.x) + Math.cos(a) * w * 0.55, y = X(s.z) + Math.sin(a) * d * 0.55, r = (6 + Math.sin(now * 7 + i) * 2.5) * unit;
        c.fillStyle = '#FFF3A0'; c.strokeStyle = INK; c.lineWidth = 1.4 * unit; c.beginPath();
        for (let j = 0; j < 8; j++) { const q = (j / 8) * Math.PI * 2, rr = j % 2 ? r * 0.38 : r; c[j ? 'lineTo' : 'moveTo'](x + Math.cos(q) * rr, y + Math.sin(q) * rr); }
        c.closePath(); c.fill(); c.stroke();
      }
      if (labels && taken) this.label(c, mine ? 'MY GARDEN' : byslot.get(s.index).name.slice(0, 16), X(s.x), X(s.z) + d * 0.78, 15 * unit, mine ? '#FFE24A' : '#fff');
      else if (!labels && mine) this.label(c, 'HOME', X(s.x), X(s.z) + d * 0.86, 22 * unit, '#FFE24A');
    }

    // shops and landmarks (pushed out a little so they do not sit on each other)
    for (const s of STALLS) {
      const info = STALL[s.id], x = mid + s.x * k * 3, y = mid + s.z * k * 3;
      this.badge(c, info.icon, x, y, (labels ? 19 : 17) * unit, info.color);
      if (labels) this.label(c, info.name.toUpperCase(), x, y + 30 * unit, 15 * unit);
    }
    if (labels) for (const s of EXTRA) { const x = mid + s.x * k * 3.5, y = mid + s.z * k * 3.5; this.badge(c, s.icon, x, y, 15 * unit, s.color); this.label(c, s.name.toUpperCase(), x, y - 26 * unit, 14 * unit); }

    // neighbours as little cats
    for (const m of members) if (m.slot !== mySlot) this.badge(c, 'user', X(m.x), X(m.z), 11 * unit, '#FFF4DC');
    // me: a bigger cat with a beam showing which way I face (clamped to the rim when off the map, e.g. on Sky Island)
    const far = Math.hypot(pos.x, pos.z) * k / (mid - 20 * unit);
    const px = X(pos.x / Math.max(1, far)), py = X(pos.z / Math.max(1, far));
    c.save(); c.translate(px, py); c.rotate(-ry);
    const beam = c.createLinearGradient(0, 0, 0, 46 * unit);
    beam.addColorStop(0, 'rgba(255,255,255,.85)'); beam.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = beam; c.beginPath(); c.moveTo(0, 0); c.lineTo(22 * unit, 46 * unit); c.lineTo(-22 * unit, 46 * unit); c.closePath(); c.fill();
    c.restore();
    const ping = (now % 1.4) / 1.4;
    c.strokeStyle = `rgba(255,255,255,${1 - ping})`; c.lineWidth = 3 * unit; c.beginPath(); c.arc(px, py, (14 + ping * 22) * unit, 0, 7); c.stroke();
    this.badge(c, 'user', px, py, 16 * unit, RED);
    this.label(c, 'N', mid, 20 * unit, 24 * unit, '#FFE24A');
  }

  /** The big map, with travel shortcuts. */
  open(hud, getState) {
    const buttons = [['garden', 'My Garden'], ['seeds', 'Seeds'], ['market', 'Market'], ['gadgets', 'Gadgets'], ['pets', 'Pets']];
    hud.modal(`<h2><svg class="i big"><use href="/icons/sprite.svg#map"/></svg>Village Map</h2><canvas id="bigmap" width="1100" height="1100" aria-label="Map of the whole village"></canvas><p class="maptravel">${buttons.map(([id, name]) => `<button class="btn ${id === 'garden' ? 'gold' : 'blue'}" data-go="${id}">${name}</button>`).join('')}</p><p class="soft">Gardens with sparkles have crops ready to pick.</p>`, (card) => {
      const canvas = card.querySelector('#bigmap');
      card.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { hud.modal(null); document.querySelector(`.tabs [data-travel="${b.dataset.go}"]`)?.click(); }));
      const paint = () => {
        if (!canvas.isConnected || !hud.modalOpen) return;
        this.draw(canvas, { ...getState(), labels: true });
        setTimeout(paint, 100);
      };
      paint();
    });
  }
}
