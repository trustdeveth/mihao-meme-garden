// Heads-up display: wallet, weather, restock, goals, hotbar, toasts, prompt, dialogue, modals, chat, minimap.
import { CROP, CROPS } from '@mg/shared/data/crops';
import { GADGETS, WEATHER_BY_ID, WINDOW_MS } from '@mg/shared/data/tables';
import { forecast } from '@mg/shared/rules/weather';
import { restockIndex, restockEnds } from '@mg/shared/rules/economy';

import { modalIn, modalOut, stagger, slideIn, pop, shake, countTo, walletChange } from '../fx/ui-fx.js';

import { MapView } from './map.js';

const $ = (id) => document.getElementById(id);
export const icon = (id, cls = 'i') => `<svg class="${cls}"><use href="/icons/sprite.svg#${id}"/></svg>`;
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 1,234 / 12.3K / 4.56M / 7.8B */
export function short(n) {
  n = Math.floor(n ?? 0);
  const a = Math.abs(n);
  const f = (v, s) => `${v >= 100 ? Math.floor(v) : (Math.floor(v * 10) / 10)}${s}`;
  if (a >= 1e12) return f(n / 1e12, 'T');
  if (a >= 1e9) return f(n / 1e9, 'B');
  if (a >= 1e6) return f(n / 1e6, 'M');
  if (a >= 1e4) return f(n / 1e3, 'K');
  return n.toLocaleString('en-US');
}
export const full = (n) => Math.floor(n ?? 0).toLocaleString('en-US');

/**
 * Requirement checklist: every line shows a tick when done (or an empty box), the progress "have / need"
 * and a small bar, plus a header with how many are done. items: [{label, have, need, money?}]
 */
export function checklist(items, title = 'Requirements') {
  const done = items.filter((i) => i.have >= i.need).length;
  const all = done === items.length;
  const amt = (i, v) => (i.money ? short(v) : full(v));
  return `<div class="checklist ${all ? 'all' : ''}"><div class="ckhead"><b>${esc(title)}</b><span>${all ? `${icon('check')}All done!` : `${done} of ${items.length} done`}</span></div>${items.map((i) => {
    const ok = i.have >= i.need;
    const pct = Math.round(Math.min(1, i.need ? i.have / i.need : 1) * 100);
    return `<div class="ck ${ok ? 'ok' : ''}"><span class="box">${ok ? icon('check') : ''}</span><div class="ckm"><b>${esc(i.label)}</b><div class="pbar"><i style="width:${pct}%"></i></div></div><span class="amt">${amt(i, Math.min(i.have, i.need * 100))} / ${amt(i, i.need)}</span></div>`;
  }).join('')}</div>`;
}
/** One small inline tick or box with text, for list rows. */
export const tick = (ok, text) => `<em class="tk ${ok ? 'ok' : ''}"><i class="box">${ok ? icon('check') : ''}</i>${esc(text)}</em>`;
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export const TOOLS = [
  { id: 'hand', name: 'Hands', icon: 'harvest' },
  { id: 'water', name: 'Watering Can', icon: 'water' },
  { id: 'trowel', name: 'Trowel', icon: 'trowel' },
  { id: 'shovel', name: 'Shovel', icon: 'shovel' },
];

export class Hud {
  constructor(store, assets) {
    this.store = store;
    this.assets = assets;
    this.selected = 'hand';
    this.onSelect = () => {};
    this.toastTimer = 0;
    this.toastQueue = [];
    this.root = $('hud');
    this.map = new MapView(store);
    const mini = $('minimap');
    mini.width = mini.height = 380; // drawn at double size so it stays sharp
    mini.title = 'Open the village map';
    mini.setAttribute('role', 'button');
    mini.tabIndex = 0;
    const openMap = () => { if (this.mapState) this.map.open(this, () => this.mapState); };
    mini.addEventListener('click', openMap);
    mini.addEventListener('keydown', (e) => { if (e.key === 'Enter') openMap(); });
    $('hotbar').addEventListener('click', (e) => { const b = e.target.closest('.slot'); if (b) this.select(b.dataset.id); });
    addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      const n = Number(e.key);
      if (n >= 1 && n <= 9) { const ids = this.hotbarIds(); if (ids[n - 1]) this.select(ids[n - 1]); }
    });
  }

  show() { this.root.hidden = false; }

  // ---- wallet, badges --------------------------------------------------------------
  refresh() {
    const me = this.store.me;
    if (!me) return;
    for (const [id, iconId] of [['coins', 'coin'], ['gems', 'gem']]) {
      const was = this.wallet?.[id];
      if (was === me[id]) continue;
      countTo($(id), was, me[id], short);
      if (was != null) walletChange($(id).parentElement, me[id] - was, iconId, short);
    }
    this.wallet = { coins: me.coins, gems: me.gems };
    $('coins').parentElement.title = `${full(me.coins)} Garden Coins`;
    const ready = [...me.daily.quests, ...me.weekly.quests].filter((q) => !q.claimed && q.progress >= q.target).length;
    if (ready > Number($('questBadge').textContent)) pop($('questBadge').parentElement);
    $('questBadge').hidden = !ready; $('questBadge').textContent = ready;
    const today = new Date(this.store.now()).toISOString().slice(0, 10);
    $('giftBadge').hidden = me.gift.last === today;
    if (me.basket.length > Number($('basketBadge').textContent)) pop($('basketBadge').parentElement);
    this.sellTab(me.basket.length);
    $('basketBadge').hidden = !me.basket.length; $('basketBadge').textContent = me.basket.length;
    this.renderHotbar();
    this.renderGoals();
  }

  /** The Sell button shows how many crops are waiting, and calls for attention when there are some. */
  sellTab(count) {
    const tab = document.querySelector('.tab-sell');
    if (!tab) return;
    let chip = tab.querySelector('.sellcount');
    if (!chip) { chip = document.createElement('em'); chip.className = 'sellcount'; tab.appendChild(chip); }
    if (count > Number(chip.textContent)) pop(tab, 0.5);
    chip.textContent = count;
    chip.hidden = !count;
    tab.classList.toggle('ready', count > 0);
    tab.title = count ? `Sell: ${count} crop${count > 1 ? 's' : ''} in your basket` : 'Go to the market';
  }

  // ---- hotbar ------------------------------------------------------------------------
  hotbarIds() {
    const me = this.store.me;
    const seeds = Object.entries(me.seeds).filter(([, n]) => n > 0).sort((a, b) => CROP[a[0]].seed - CROP[b[0]].seed).map(([id]) => `seed:${id}`);
    const gadgets = Object.entries(me.gadgets).filter(([, n]) => n > 0).map(([id]) => `gadget:${id}`);
    return [...TOOLS.map((t) => `tool:${t.id}`), ...seeds, ...gadgets];
  }
  renderHotbar() {
    const me = this.store.me;
    const ids = this.hotbarIds();
    if (!ids.includes(this.selected)) this.selected = 'tool:hand';
    const html = ids.map((id, i) => {
      const [kind, key] = id.split(':');
      const on = id === this.selected ? ' on' : '';
      const k = i < 9 ? `<span class="k">${i + 1}</span>` : '';
      if (kind === 'tool') { const t = TOOLS.find((x) => x.id === key); return `<button class="slot${on}" data-id="${id}" title="${t.name}">${k}${icon(t.icon)}</button>`; }
      if (kind === 'seed') { const c = CROP[key]; return `<button class="slot tier-${c.tier}${on}" data-id="${id}" title="${c.name} seed">${k}<div class="crop" style="${this.assets.cropIconStyle(key, 48)}"></div><span class="n">${me.seeds[key]}</span></button>`; }
      const g = GADGETS[key];
      return `<button class="slot${on}" data-id="${id}" title="${g.name}">${k}${icon(key)}<span class="n">${me.gadgets[key]}</span></button>`;
    });
    const sepAt = TOOLS.length;
    html.splice(sepAt, 0, '<span class="sep"></span>');
    $('hotbar').innerHTML = html.join('');
    // a slot bounces when its stack grows or it appears for the first time
    const counts = new Map(ids.map((id) => { const [kind, key] = id.split(':'); return [id, kind === 'seed' ? me.seeds[key] : kind === 'gadget' ? me.gadgets[key] : 0]; }));
    if (this.counts) for (const [id, n] of counts) if (!this.counts.has(id) || n > this.counts.get(id)) pop($('hotbar').querySelector(`[data-id="${id}"]`), 1);
    this.counts = counts;
  }
  select(id) { this.selected = id; this.renderHotbar(); this.onSelect(id); pop($('hotbar').querySelector('.slot.on'), 0.9); }

  // ---- goals (quests summary) ----------------------------------------------------------
  renderGoals() {
    const me = this.store.me;
    const qs = [...me.daily.quests, ...me.weekly.quests].filter((q) => !q.claimed).slice(0, 3);
    $('goalList').innerHTML = qs.map((q) => `<li>${esc(questText(q))}<div class="bar"><i style="width:${Math.round((q.progress / q.target) * 100)}%"></i></div></li>`).join('') || '<li>All quests done today!</li>';
  }

  // ---- per-frame widgets ---------------------------------------------------------------
  tick() {
    const now = this.store.now();
    const f = forecast(this.store.seed, now, 2);
    const w = WEATHER_BY_ID[f[0].kind];
    if ($('weatherName').textContent !== w.name) {
      $('weatherName').textContent = w.name;
      $('weatherIcon').setAttribute('href', `/icons/sprite.svg#${w.id === 'night' ? 'night' : w.id}`);
      $('weather').title = `${w.name}. Next: ${WEATHER_BY_ID[f[1].kind].name}`;
      slideIn($('weather'), '-60px 0');
    }
    $('weatherTime').textContent = `${mmss(f[0].end - now)} left`;
    $('weatherRing').style.strokeDashoffset = String(119.4 * ((f[0].end - now) / WINDOW_MS));
    $('restockTime').textContent = mmss(restockEnds(restockIndex(now)) - now);
  }

  // ---- toasts / prompt -------------------------------------------------------------------
  toast(msg, kind = 'good', ms = 2600) {
    if (!msg) return;
    const el = $('toast');
    el.className = `toast ${kind === 'good' ? '' : kind}`;
    el.innerHTML = `${icon(kind === 'bad' ? 'warning' : kind === 'gold' ? 'coin' : kind === 'info' ? 'sparkle' : 'check')}<span>${esc(msg)}</span>`;
    el.hidden = false;
    slideIn(el, '0 -70px');
    if (kind === 'bad') shake(el.querySelector('.i'));
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  }
  prompt(title, sub = '') {
    const el = $('prompt');
    if (!title) { el.hidden = true; return; }
    if (el.hidden || $('promptTitle').textContent !== title) slideIn(el, '0 40px');
    el.hidden = false;
    $('promptTitle').textContent = title;
    $('promptSub').innerHTML = sub;
  }

  // ---- vendor dialogue --------------------------------------------------------------------
  dialogue(who, line, options) {
    const el = $('dialogue');
    if (!who) { el.hidden = true; this.dialogueOpen = null; return; }
    el.hidden = false;
    el.innerHTML = `<div class="who"><b>${esc(who)}:</b> ${esc(line)}</div>` + options.map((o, i) => `<button data-i="${i}"><span class="num">${i + 1}.</span>${esc(o.text)}</button>`).join('');
    el.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => options[Number(b.dataset.i)].act()));
    [...el.children].forEach((c, i) => slideIn(c, '90px 0', i * 55));
    this.dialogueOpen = options;
  }

  // ---- modal --------------------------------------------------------------------------------
  modal(html, onMount = () => {}) {
    const m = $('modal');
    this.panel = null; // which live panel is showing (set by the caller after opening)
    if (!html) { if (this.modalOpen) modalOut($('modalCard')); m.hidden = true; this.modalOpen = false; return; }
    const wasOpen = this.modalOpen && !m.hidden;
    const heading = () => $('modalCard').querySelector('h2')?.textContent.replace(/\d+/g, '') ?? '';
    const before = wasOpen ? heading() : null;
    $('modalCard').innerHTML = `<button class="x" aria-label="Close">${icon('close')}</button>${html}`;
    m.hidden = false;
    this.modalOpen = true;
    $('modalCard').querySelector('.x').addEventListener('click', () => this.modal(null));
    onMount($('modalCard'));
    // slam in when it opens; only drop the rows in when it turns to another page; stay still on a refresh
    if (!wasOpen) modalIn(m, $('modalCard'));
    else if (heading() !== before) stagger($('modalCard'));
  }

  // ---- chat -----------------------------------------------------------------------------------
  chatLine(name, text) {
    const li = document.createElement('li');
    li.innerHTML = `<b>${esc(name)}:</b> ${esc(text)}`;
    const log = $('chatLog');
    log.appendChild(li);
    slideIn(li, '-80px 0');
    while (log.children.length > 6) log.firstChild.remove();
  }

  // ---- minimap -------------------------------------------------------------------------------
  drawMap(playerPos, ry, members, mySlot) {
    this.mapState = { pos: playerPos, ry, members, mySlot };
    this.map.draw($('minimap'), this.mapState);
  }
}

export function questText(q) {
  const n = q.target;
  switch (q.kind) {
    case 'planted': return q.crop ? `Plant ${n} ${CROP[q.crop].name}` : `Plant ${n} seeds`;
    case 'harvested': return `Harvest ${n} crops`;
    case 'watered': return `Water ${n} plants`;
    case 'bought': return `Buy ${n} seeds`;
    case 'sold': return `Sell ${n} crops`;
    case 'earned': return `Earn ${short(n)} coins`;
    case 'liked': return `Like ${n} gardens`;
    case 'mutated': return `Harvest ${n} special crops`;
    case 'gadgets': return `Use ${n} gadgets`;
    default: return q.kind;
  }
}

export { CROPS };
