// Screen effects: popups that bounce in and out, flying coins and items, counting balances,
// confetti and big stamp banners. Purely visual: nothing here waits before the game acts.
import { reducedMotion } from './world-fx.js';

const still = () => reducedMotion();
let layer = null;
function fxLayer() {
  if (!layer) { layer = document.createElement('div'); layer.id = 'fxlayer'; layer.setAttribute('aria-hidden', 'true'); document.body.appendChild(layer); }
  return layer;
}
const anim = (el, frames, opts) => (still() || !el?.animate ? null : el.animate(frames, opts));

/** Where the player last pressed, so effects start from the button they used. */
export const pointer = { x: innerWidth / 2, y: innerHeight / 2, at: 0 };
addEventListener('pointerdown', (e) => {
  Object.assign(pointer, { x: e.clientX, y: e.clientY, at: performance.now() });
  const b = e.target.closest?.('button');
  if (b && !b.disabled) ripple(e.clientX, e.clientY);
}, { capture: true });
export const origin = () => (performance.now() - pointer.at < 1500 ? { x: pointer.x, y: pointer.y } : { x: innerWidth / 2, y: innerHeight / 2 });

function spawn(cls, html, x, y) {
  const el = document.createElement('div');
  el.className = cls;
  el.innerHTML = html;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  fxLayer().appendChild(el);
  return el;
}
// the timer is a backstop: a slow or hidden tab may report the end of an animation very late
const bye = (el, a) => {
  if (!a) { el.remove(); return; }
  const gone = () => el.remove();
  a.finished.then(gone, gone);
  setTimeout(gone, a.effect.getComputedTiming().endTime + 250);
};

function ripple(x, y) {
  if (still()) return;
  const el = spawn('fx-ripple', '', x, y);
  bye(el, anim(el, [{ transform: 'translate(-50%,-50%) scale(.2)', opacity: 0.9 }, { transform: 'translate(-50%,-50%) scale(1.5)', opacity: 0 }], { duration: 380, easing: 'ease-out' }));
}

export function pop(el, strength = 1) {
  anim(el, [{ scale: '1' }, { scale: `${1 + 0.28 * strength}`, offset: 0.35 }, { scale: `${1 - 0.08 * strength}`, offset: 0.65 }, { scale: '1' }], { duration: 420, easing: 'ease-out' });
}
export function shake(el) {
  anim(el, [0, -12, 11, -8, 6, -3, 0].map((x) => ({ translate: `${x}px 0` })), { duration: 420 });
}

/** Copies of an icon that leap from one point and fly into an element. */
export function flyTo(from, target, html, { n = 1, cls = 'fx-fly', stagger = 55, onLand } = {}) {
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  const r = el?.getBoundingClientRect();
  if (still() || !r || !r.width) { onLand?.(); return; }
  const to = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  for (let i = 0; i < n; i++) {
    const node = spawn(cls, html, from.x, from.y);
    const sx = (Math.random() - 0.5) * 160, sy = -40 - Math.random() * 90;
    const a = node.animate([
      { transform: 'translate(-50%,-50%) scale(.3)', opacity: 0 },
      { transform: `translate(calc(-50% + ${sx}px), calc(-50% + ${sy}px)) scale(1.25) rotate(${sx}deg)`, opacity: 1, offset: 0.3 },
      { transform: `translate(calc(-50% + ${to.x - from.x}px), calc(-50% + ${to.y - from.y}px)) scale(.65) rotate(360deg)`, opacity: 1 },
    ], { duration: 720, delay: i * stagger, easing: 'cubic-bezier(.35,.1,.45,1)', fill: 'backwards' });
    a.finished.then(() => { node.remove(); pop(el, 0.55); if (i === n - 1) onLand?.(); }, () => node.remove());
    setTimeout(() => node.remove(), 1000 + i * stagger);
  }
}

export function confetti(x = innerWidth / 2, y = innerHeight * 0.4, n = 60) {
  if (still()) return;
  const colors = ['#E4333B', '#FFD84A', '#5DBB46', '#2F80ED', '#FF7AB6', '#FFFFFF'];
  for (let i = 0; i < n; i++) {
    const el = spawn('fx-confetti', '', x, y);
    el.style.background = colors[i % colors.length];
    const a = Math.random() * Math.PI * 2, d = 80 + Math.random() * 260;
    const dx = Math.cos(a) * d, dy = Math.sin(a) * d * 0.7 - 120;
    bye(el, el.animate([
      { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) rotate(${Math.random() * 540}deg)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${dx * 1.15}px, ${dy + 340}px) rotate(${Math.random() * 1080}deg)`, opacity: 0 },
    ], { duration: 1200 + Math.random() * 700, easing: 'cubic-bezier(.2,.6,.4,1)' }));
  }
}

/** A big stamp across the screen for the big moments. One at a time. */
let stamp = null;
export function banner(title, sub = '') {
  if (still()) return;
  stamp?.remove();
  const el = spawn('fx-banner', '<i></i><b></b><span></span>', innerWidth / 2, innerHeight * 0.3);
  el.querySelector('b').textContent = title;
  el.querySelector('span').textContent = sub;
  stamp = el;
  bye(el, el.animate([
    { transform: 'translate(-50%,-50%) scale(3.2) rotate(-18deg)', opacity: 0 },
    { transform: 'translate(-50%,-50%) scale(.92) rotate(-5deg)', opacity: 1, offset: 0.14 },
    { transform: 'translate(-50%,-50%) scale(1.07) rotate(-3deg)', offset: 0.21 },
    { transform: 'translate(-50%,-50%) scale(1) rotate(-4deg)', offset: 0.28 },
    { transform: 'translate(-50%,-50%) scale(1) rotate(-4deg)', opacity: 1, offset: 0.82 },
    { transform: 'translate(-50%,-80%) scale(.85) rotate(-4deg)', opacity: 0 },
  ], { duration: 2000, easing: 'ease-out' }));
}

/** Count a balance up or down instead of jumping, and show what changed. */
const counting = new WeakMap();
export function countTo(el, from, to, format) {
  cancelAnimationFrame(counting.get(el));
  if (still() || from == null || from === to) { el.textContent = format(to); return; }
  const t0 = performance.now(), dur = 650;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    el.textContent = format(Math.round(from + (to - from) * (1 - (1 - k) ** 3)));
    if (k < 1) counting.set(el, requestAnimationFrame(step));
  };
  counting.set(el, requestAnimationFrame(step));
  // the last frame can be skipped in a hidden tab: always end on the true balance
  setTimeout(() => { cancelAnimationFrame(counting.get(el)); el.textContent = format(to); }, dur + 80);
}

const coinIcon = (id) => `<svg class="i"><use href="/icons/sprite.svg#${id}"/></svg>`;
/** The wallet changed: coins fly in when you earn and spill out when you spend. */
export function walletChange(pill, delta, iconId, format) {
  if (still() || !delta || !pill?.getBoundingClientRect().width) return;
  const r = pill.getBoundingClientRect();
  const chip = spawn(`fx-delta ${delta > 0 ? 'up' : 'down'}`, '', r.left + r.width / 2, r.bottom + 6);
  chip.textContent = `${delta > 0 ? '+' : '-'}${format(Math.abs(delta))}`;
  bye(chip, chip.animate([
    { transform: 'translate(-50%,-14px) scale(.4)', opacity: 0 },
    { transform: 'translate(-50%,0) scale(1.2)', opacity: 1, offset: 0.2 },
    { transform: 'translate(-50%,4px) scale(1)', opacity: 1, offset: 0.7 },
    { transform: 'translate(-50%,34px) scale(.9)', opacity: 0 },
  ], { duration: 1500, easing: 'ease-out' }));
  const n = Math.min(12, 3 + Math.floor(Math.log10(Math.abs(delta) + 1) * 3));
  if (delta > 0) flyTo(origin(), pill, coinIcon(iconId), { n });
  else {
    pop(pill, 0.7);
    for (let i = 0; i < Math.min(6, n); i++) {
      const c = spawn('fx-fly', coinIcon(iconId), r.left + 22, r.top + r.height / 2);
      const dx = (Math.random() - 0.3) * 90;
      bye(c, c.animate([{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }, { transform: `translate(calc(-50% + ${dx * 0.6}px), calc(-50% - 24px)) rotate(180deg)`, opacity: 1, offset: 0.35 }, { transform: `translate(calc(-50% + ${dx}px), calc(-50% + 90px)) rotate(420deg) scale(.6)`, opacity: 0 }], { duration: 700, delay: i * 45, easing: 'ease-in', fill: 'backwards' }));
    }
  }
}

/** A popup opens: the card slams in and its rows drop in one after another. */
export function modalIn(modal, card) {
  anim(modal, [{ backgroundColor: 'rgba(43,26,14,0)' }, { backgroundColor: 'rgba(43,26,14,.45)' }], { duration: 200 });
  anim(card, [
    { scale: '.3', rotate: '-7deg', translate: '0 60px', opacity: 0 },
    { scale: '1.07', rotate: '2deg', translate: '0 -8px', opacity: 1, offset: 0.55 },
    { scale: '.97', rotate: '-1deg', translate: '0 2px', offset: 0.78 },
    { scale: '1', rotate: '0deg', translate: '0 0', opacity: 1 },
  ], { duration: 460, easing: 'ease-out' });
  stagger(card, 90);
  const title = card.querySelector('h2 .i');
  anim(title, [{ rotate: '-35deg', scale: '.2' }, { rotate: '20deg', scale: '1.35', offset: 0.6 }, { rotate: '0deg', scale: '1' }], { duration: 560, delay: 120, easing: 'ease-out', fill: 'backwards' });
}
export function stagger(card, start = 0) {
  const items = card.querySelectorAll('.list > .row, .wear > .wearcard, .swatches > .swatch, .menugrid > *, .stickers > *, .checklist .ck, .tabsmall > button, h3');
  [...items].slice(0, 24).forEach((el, i) => anim(el, [{ translate: '0 22px', scale: '.92', opacity: 0 }, { translate: '0 -3px', scale: '1.02', opacity: 1, offset: 0.7 }, { translate: '0 0', scale: '1', opacity: 1 }], { duration: 300, delay: start + i * 38, easing: 'ease-out', fill: 'backwards' }));
}
/** A popup closes: a harmless copy spins away while the real one is already gone. */
export function modalOut(card) {
  const r = card.getBoundingClientRect();
  if (still() || !r.width) return;
  const ghost = card.cloneNode(true);
  ghost.querySelectorAll('video, iframe, canvas').forEach((x) => x.remove());
  // no ids or names: the copy must never be found by the game's own lookups
  for (const x of [ghost, ...ghost.querySelectorAll('*')]) { x.removeAttribute('id'); x.removeAttribute('name'); for (const k of Object.keys(x.dataset ?? {})) delete x.dataset[k]; }
  ghost.className = 'card fx-ghost';
  ghost.inert = true;
  Object.assign(ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  fxLayer().appendChild(ghost);
  bye(ghost, ghost.animate([{ scale: '1', rotate: '0deg', translate: '0 0', opacity: 1 }, { scale: '1.05', rotate: '-2deg', offset: 0.25 }, { scale: '.35', rotate: '9deg', translate: '0 90px', opacity: 0 }], { duration: 260, easing: 'ease-in' }));
}

export function slideIn(el, from = '0 -40px', delay = 0) {
  anim(el, [{ translate: from, scale: '.7', opacity: 0 }, { translate: '0 0', scale: '1.08', opacity: 1, offset: 0.65 }, { translate: '0 0', scale: '1', opacity: 1 }], { duration: 340, delay, easing: 'ease-out', fill: 'backwards' });
}
