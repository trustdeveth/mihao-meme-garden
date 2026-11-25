// Graphics quality. "Auto" starts sharp and only turns things down when the device is really struggling.
const KEY = 'mg-gfx';

/** From best to lightest. Pixel ratio is the biggest cost on sharp screens, shadows come next. */
const LEVELS = [
  { ratio: 1.5, shadow: 2048, detail: 1, ambient: true },
  { ratio: 1.15, shadow: 1024, detail: 0.7, ambient: true },
  { ratio: 1, shadow: 1024, detail: 0.4, ambient: false },
  { ratio: 0.85, shadow: 0, detail: 0.3, ambient: false },
];
export const QUALITY_CHOICES = [['auto', 'Auto'], ['high', 'Best looking'], ['low', 'Fastest']];

export function createQuality({ world, sky }) {
  const read = () => { try { return localStorage.getItem(KEY) ?? 'auto'; } catch { return 'auto'; } };
  const lofi = new URLSearchParams(location.search).has('lofi');
  const touch = matchMedia('(pointer: coarse)').matches;
  let mode = read();
  let level = -1;
  let last = 0, spent = 0, frames = 0, goodRuns = 0, floor = 0;

  const q = {
    ambient: true,
    get mode() { return mode; },
    get level() { return level; },
    apply(next) {
      if (next === level) return;
      level = next;
      const L = LEVELS[next];
      if (!lofi) { world.renderer.setPixelRatio(Math.min(devicePixelRatio, L.ratio)); world.renderer.setSize(innerWidth, innerHeight); }
      const sun = world.sun;
      sun.castShadow = L.shadow > 0;
      if (L.shadow && sun.shadow.mapSize.x !== L.shadow) { sun.shadow.mapSize.set(L.shadow, L.shadow); sun.shadow.map?.dispose(); sun.shadow.map = null; }
      sky.setDetail(L.detail);
      q.ambient = L.ambient;
    },
    set(value) {
      mode = value;
      try { localStorage.setItem(KEY, value); } catch { /* private mode */ }
      goodRuns = 0; floor = 0;
      q.apply(value === 'low' ? LEVELS.length - 1 : value === 'high' ? 0 : touch ? 1 : 0);
    },
    /** Call once a frame with the frame's time stamp. */
    tick(now) {
      const gap = now - last;
      last = now;
      // long gaps are a hidden tab or a pause, not a slow device
      if (mode !== 'auto' || document.hidden || gap <= 0 || gap > 600) return;
      spent += gap; frames++;
      if (spent < 4000) return;
      const fps = (frames * 1000) / spent;
      spent = 0; frames = 0;
      if (fps < 32 && level < LEVELS.length - 1) {
        if (goodRuns < 0) floor = level + 1; // it was just stepped up and could not keep up: stay below
        goodRuns = 0;
        q.apply(level + 1);
      } else if (fps > 56 && level > floor) {
        if (++goodRuns >= 4) { goodRuns = -1; q.apply(level - 1); }
      } else if (goodRuns < 0) goodRuns = 0;
    },
  };
  q.set(mode);
  return q;
}
