// Photos and clips. The speech bubbles and name tags are HTML on top of the 3D view, so they are drawn again onto
// the picture here: what you see is what you save. drawImage must run right after the 3D render (same frame).
const WATERMARK = 'mihao  #MihaoGarden';
export const CLIP_MAX_MS = 15_000;
const CLIP_WIDTH = 1280;

function wrap(g, text, max) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && g.measureText(next).width > max) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Draw the visible bubbles and name tags. k = picture pixels per screen pixel. */
export function drawOverlay(g, k, { names = true } = {}) {
  const sel = names ? '#labels .bubble, #labels .nametag, #labels .stamp' : '#labels .bubble, #labels .stamp';
  for (const el of document.querySelectorAll(sel)) {
    if (el.style.display === 'none') continue;
    const css = getComputedStyle(el);
    if (css.display === 'none' || css.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (!r.width || r.right < 0 || r.left > innerWidth || r.bottom < 0 || r.top > innerHeight) continue;
    const scale = (r.width / (el.offsetWidth || r.width)) * k; // labels shrink with distance
    const size = parseFloat(css.fontSize) * scale;
    const x = r.left * k, y = r.top * k, w = r.width * k, h = r.height * k;
    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (el.classList.contains('bubble')) {
      g.font = `600 ${size}px "Source Sans Pro", "Segoe UI", Arial, sans-serif`;
      const rad = 7 * scale, tail = 9 * scale;
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.roundRect(x, y, w, h, rad);
      g.fill();
      g.beginPath(); g.moveTo(x + w / 2 - tail, y + h - 1); g.lineTo(x + w / 2 + tail, y + h - 1); g.lineTo(x + w / 2, y + h + tail); g.closePath(); g.fill();
      g.fillStyle = '#393B3D';
      const lines = wrap(g, el.textContent, w - 8 * scale);
      lines.forEach((line, i) => g.fillText(line, x + w / 2, y + h / 2 + (i - (lines.length - 1) / 2) * size * 1.15));
    } else {
      const stamp = el.classList.contains('stamp');
      g.font = `${stamp ? '400' : '800'} ${size}px ${stamp ? 'Impact, "Arial Black", sans-serif' : '"Baloo 2", sans-serif'}`;
      if (stamp) { g.fillStyle = '#B3181B'; g.fillRect(x, y, w, h); }
      g.lineJoin = 'round';
      g.lineWidth = size / 5;
      g.strokeStyle = '#000000';
      g.strokeText(el.textContent, x + w / 2, y + h / 2);
      g.fillStyle = '#ffffff';
      g.fillText(el.textContent, x + w / 2, y + h / 2);
    }
    g.restore();
  }
}

function watermark(g, w, h) {
  const size = Math.max(16, Math.round(w / 48));
  g.save();
  g.font = `400 ${size}px Impact, "Arial Black", sans-serif`;
  g.textAlign = 'right';
  g.lineJoin = 'round';
  g.lineWidth = size / 5;
  g.strokeStyle = '#17120F';
  g.strokeText(WATERMARK, w - size * 0.7, h - size * 0.7);
  g.fillStyle = '#FFD24A';
  g.fillText(WATERMARK, w - size * 0.7, h - size * 0.7);
  g.restore();
}

/** The current view with bubbles, as a canvas. Call render() first (this does). */
export function snapshot(world) {
  world.renderer.render(world.scene, world.camera);
  const src = world.renderer.domElement;
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  drawOverlay(g, src.width / innerWidth);
  watermark(g, c.width, c.height);
  return c;
}

export function download(url, name) {
  const a = document.createElement('a');
  a.download = name;
  a.href = url;
  a.click();
}

const TYPES = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

/** Records what you see (without the interface) for up to 15 seconds. No sound. */
export class ClipRecorder {
  constructor(world) {
    this.world = world;
    this.rec = null;
    this.bad = new Set();
    this.type = typeof MediaRecorder === 'function' && HTMLCanvasElement.prototype.captureStream
      ? TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null : null;
  }
  get supported() { return !!this.type; }
  /** A format that recorded nothing is not used again. */
  reject(type) {
    this.bad.add(type);
    this.type = TYPES.find((t) => !this.bad.has(t) && MediaRecorder.isTypeSupported(t)) ?? null;
  }
  get active() { return !!this.rec; }
  get seconds() { return this.rec ? (performance.now() - this.started) / 1000 : 0; }

  start(onDone) {
    if (!this.supported || this.rec) return false;
    const src = this.world.renderer.domElement;
    const w = Math.min(CLIP_WIDTH, src.width), h = Math.round((w * src.height) / src.width);
    this.canvas = document.createElement('canvas');
    this.canvas.width = w - (w % 2); this.canvas.height = h - (h % 2);
    this.g = this.canvas.getContext('2d');
    this.compose();
    const stream = this.canvas.captureStream(30);
    const chunks = [];
    try { this.rec = new MediaRecorder(stream, { mimeType: this.type, videoBitsPerSecond: 5_000_000 }); } catch { return false; }
    this.rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    this.rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      this.rec = null;
      const type = this.type.split(';')[0];
      const blob = new Blob(chunks, { type });
      // a format that recorded nothing is not used again: the next try takes the next one the browser offers
      if (!blob.size) this.reject(this.type);
      onDone(blob, type.endsWith('mp4') ? 'mp4' : 'webm');
    };
    this.started = performance.now();
    this.rec.start(500);
    return true;
  }
  /** Copy the frame that was just rendered. Call from the game loop, right after the 3D render. */
  compose() {
    if (!this.g) return;
    const { width: w, height: h } = this.canvas;
    this.g.drawImage(this.world.renderer.domElement, 0, 0, w, h);
    drawOverlay(this.g, w / innerWidth);
    watermark(this.g, w, h);
  }
  frame() {
    if (!this.rec) return;
    this.compose();
    if (performance.now() - this.started >= CLIP_MAX_MS) this.stop();
  }
  stop() { if (this.rec && this.rec.state !== 'inactive') this.rec.stop(); }
}

export const REPLAY_HALF_MS = CLIP_MAX_MS / 2;

/**
 * Instant replay: "save what just happened". A browser cannot cut the start off a recording (only the first piece
 * has the video header), so two recordings run staggered: a new one starts every 7.5 s and the oldest of three is
 * thrown away. The older one therefore always holds the last 7.5 to 15 seconds (less just after switching on).
 */
export class InstantReplay {
  /** @param {ClipRecorder} clip shares its format choice (and its list of formats that recorded nothing) */
  constructor(world, clip) {
    this.world = world;
    this.clip = clip;
    this.segs = []; // oldest first
    this.stream = null;
    this.saving = false;
  }
  get active() { return !!this.stream; }
  /** Seconds the next save would hold. */
  get seconds() { return this.segs.length ? (performance.now() - this.segs[0].started) / 1000 : 0; }

  start() {
    if (this.stream || !this.clip.supported) return false;
    const src = this.world.renderer.domElement;
    const w = Math.min(CLIP_WIDTH, src.width), h = Math.round((w * src.height) / src.width);
    this.canvas = document.createElement('canvas');
    this.canvas.width = w - (w % 2); this.canvas.height = h - (h % 2);
    this.g = this.canvas.getContext('2d');
    this.size = `${src.width}x${src.height}`;
    this.compose();
    this.stream = this.canvas.captureStream(30);
    if (!this.add()) { this.stop(); return false; }
    return true;
  }
  add() {
    let rec;
    try { rec = new MediaRecorder(this.stream, { mimeType: this.clip.type, videoBitsPerSecond: 4_000_000 }); } catch { return false; }
    const seg = { rec, chunks: [], started: performance.now(), type: this.clip.type };
    rec.ondataavailable = (e) => { if (e.data.size) seg.chunks.push(e.data); };
    rec.start(500);
    this.segs.push(seg);
    return true;
  }
  drop(seg) {
    this.segs = this.segs.filter((x) => x !== seg);
    seg.rec.ondataavailable = null;
    seg.rec.onstop = null;
    if (seg.rec.state !== 'inactive') seg.rec.stop();
  }
  compose() {
    const { width: w, height: h } = this.canvas;
    this.g.drawImage(this.world.renderer.domElement, 0, 0, w, h);
    drawOverlay(this.g, w / innerWidth);
    watermark(this.g, w, h);
  }
  /** Call from the game loop, right after the 3D render. */
  frame() {
    if (!this.stream) return;
    const src = this.world.renderer.domElement;
    if (this.size !== `${src.width}x${src.height}`) { this.stop(); this.start(); return; } // the window changed shape
    this.compose();
    const newest = this.segs.at(-1);
    if (newest && performance.now() - newest.started >= REPLAY_HALF_MS) {
      this.add();
      while (this.segs.length > 2) this.drop(this.segs[0]);
    }
  }
  /** Finish the older recording and hand it over; replay keeps running. */
  save(onDone) {
    const seg = this.segs[0];
    if (!this.stream || !seg || this.saving) return false;
    this.saving = true;
    this.segs.shift();
    if (!this.segs.length) this.add(); // keep something recording
    seg.rec.onstop = () => {
      this.saving = false;
      const type = seg.type.split(';')[0];
      const blob = new Blob(seg.chunks, { type });
      if (!blob.size) { this.clip.reject(seg.type); this.stop(); this.start(); }
      onDone(blob, type.endsWith('mp4') ? 'mp4' : 'webm');
    };
    seg.rec.stop();
    return true;
  }
  stop() {
    for (const seg of [...this.segs]) this.drop(seg);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.saving = false;
  }
}
