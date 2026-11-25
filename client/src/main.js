// Meme Garden client: boot, networking glue and all player interactions.
import { createActionFx } from './fx/actions.js';
import { createAmbient } from './fx/ambient.js';
import { createMeme } from './meme/meme.js';
import { drawOverlay } from './meme/capture.js';
import * as THREE from 'three';
import { CROP, CROPS } from '@mg/shared/data/crops';
import { GADGETS, SOIL_LEVELS, TIERS, VENDORS } from '@mg/shared/data/tables';
import { canPlace } from '@mg/shared/rules/placement';
import { growAllQuote, soilRequirements, pityEligible } from '@mg/shared/rules/garden';
import { stockAt, restockIndex, remaining, salePrice, appraise } from '@mg/shared/rules/economy';
import { ripenessAt } from '@mg/shared/rules/ripening';
import { toWorld, toLocal, STALLS, SIGNS, REACH, PLOT_SLOTS, PLOT, plotAt } from '@mg/shared/world/village-layout';
import { ensureSession, Socket, Store, recover } from './net/net.js';
import { Assets } from './assets/assets.js';
import { createRenderer, World } from './scene/world.js';
import { Sky } from './scene/sky.js';
import { createQuality, QUALITY_CHOICES } from './scene/quality.js';
import { PlantRenderer } from './render/plants.js';
import { Characters } from './render/characters.js';
import { PlayerController } from './controls/player.js';
import { Hud, icon, esc, short, full, questText, checklist, tick } from './ui/hud.js';
import { WorldLabels } from './ui/labels.js';
import { EstateRenderer } from './render/estate.js';
import { PlazaExtras } from './scene/fireworks.js';
import { Audio } from './audio.js';
import { createFeatures } from './ui/features.js';
import { createMgrd } from './chain/mgrd.js';
import { BALLOON, BOARD, onIsland } from '@mg/shared/world/village-layout';
import { DECOR, HOME_SPOT, NEST_SPOT, ISLAND } from '@mg/shared/data/features';
import { canPlaceDecor, DECOR_MSG } from '@mg/shared/rules/estate';
import { acornSpots, festivalAt } from '@mg/shared/rules/progress';
import { dayKey } from '@mg/shared/rules/state';

const $ = (id) => document.getElementById(id);
const setLoad = (k, text) => { $('loadBar').style.width = `${Math.round(k * 100)}%`; $('loadPct').textContent = `${Math.round(k * 100)}%`; if (text) $('loadText').textContent = text; };
const LOAD_TIPS = [
  'Tip: crops picked at Peak ripeness sell for 30% more. mihao.',
  'Tip: rain makes plants grow faster, and storms can zap crops into rare mutations. mihao.',
  'Tip: pets water and harvest your garden, even while you are away. good pets.',
  'Tip: jump over fences with Space. any last words?',
  'Tip: Mo restocks the seed shop every 5 minutes. Rare seeds go fast! mihao.',
  'Tip: buddy plants grow 10% faster next to each other.',
  'Tip: the Village Board pays extra for special crops. mihao approves.',
];
{
  let i = Math.floor(Math.random() * LOAD_TIPS.length);
  const tip = () => { const el = $('loadTip'); if (el) el.textContent = LOAD_TIPS[i++ % LOAD_TIPS.length]; };
  tip();
  const id = setInterval(() => { if ($('loading')?.classList.contains('done')) clearInterval(id); else tip(); }, 3500);
}

const store = new Store();
let socket, world, assets, plants, chars, player, hud, sky, labels, estate, audio, F, plaza, meme;
let juice, ambient; // cosmetic: action celebrations and background life
let quality; // graphics level
let placing = null; // {kind, moveId, rot} while placing a decoration
const muted = new Set((() => { try { return JSON.parse(localStorage.getItem('mg-muted') ?? '[]'); } catch { return []; } })());
let moving = null; // plant id picked up with the trowel
let ghost = null;
let lastFrame = performance.now();
let mapAt = 0;
let tutorialSent = false;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const STALL_NAME = { seeds: 'Mo the Mihao', market: 'Gus the Mihao', gadgets: 'Tinker Tess', pets: 'Penny Paws' };

boot().catch((e) => { console.error(e); setLoad(1, `Could not start: ${e.message}. Is the server running?`); });

async function boot() {
  setLoad(0.05, 'mihao is finding your garden...');
  const session = await ensureSession();
  const renderer = createRenderer($('world'));
  assets = await new Assets(renderer).init((k) => setLoad(0.05 + k * 0.25, 'mihao is painting the blocks...'));
  world = new World(renderer, assets);
  await world.build((k) => setLoad(0.3 + k * 0.4, 'mihao is stacking the village...'));
  sky = new Sky(world);
  chars = new Characters(world, assets, store);
  await chars.init();
  setLoad(0.8, 'mihao is waking the shopkeepers...');
  plants = new PlantRenderer(world, assets, store);
  player = new PlayerController(world, renderer.domElement);
  hud = new Hud(store, assets);
  labels = new WorldLabels(world, assets);
  hud.onSelect = onSelect;
  plaza = new PlazaExtras(world);
  estate = new EstateRenderer(world, assets, store);
  await estate.init();
  audio = new Audio();
  // warm the crop models we will need first
  await Promise.all(['carrot', 'strawberry'].map((id) => assets.crop(id)));
  socket = new Socket(session.playerId);
  const openMgrd = createMgrd({ hud, store, onWardrobe: () => hud.refresh() });
  window.__mgOpenMgrd = openMgrd;
  F = createFeatures({ store, hud, act, assets, socket, near, inGarden: () => onMyPlot(), travel: travelTo, startPlacing, postcardShot });
  meme = createMeme({ store, hud, act, socket, world, chars, player, audio, assets, sky, onMyPlot: () => onMyPlot(), travelTo });
  juice = createActionFx({ store, chars, fx: world.fx, assets, player });
  sky.onThunder = (close) => audio.thunder(close);
  quality = createQuality({ world, sky });
  ambient = createAmbient({ world, player });
  plants.owner = (slot) => { const a = chars.avatars.get(slot)?.avatar; return a ? a.root.position.clone().setY(1.2) : null; };
  window.__mgMeme = meme; // the Menu panel opens the meme screens through this
  wireSocket();
  wireInput(renderer.domElement);
  const welcomed = new Promise((r) => socket.on('welcome', r));
  socket.connect();
  setLoad(0.9, 'any last words? mihao.');
  await welcomed;
  setLoad(1, 'mihao is ready');
  $('loading').classList.add('done');
  hud.show();
  if (session.recoveryCode) showRecovery(session.recoveryCode, true);
  // test hooks for the end-to-end scripts (only with ?debug in the URL)
  if (new URLSearchParams(location.search).has('debug')) {
    window.__mg = {
      quality, store, player, hud, act, F, estate, chars, openExpand, openPanel, world, sky, meme,
      screenOf(slot, lx, lz, y = 0.1) { const w = toWorld(slot, lx, lz); const v = new THREE.Vector3(w.x, y, w.z).project(world.camera); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight }; },
      bubbles: () => [...document.querySelectorAll('.bubble')].map((b) => b.textContent),
    };
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------------------------
// Network

function wireSocket() {
  socket.on('status', (s) => {
    const el = $('conn');
    const map = { online: ['online', 'Connected'], connecting: ['connecting', 'Connecting...'], offline: ['offline', 'Reconnecting...'], replaced: ['offline', 'Opened in another tab'], idle: ['offline', 'Disconnected for being idle. Tap to rejoin'] };
    const [ic, title] = map[s] ?? map.offline;
    el.innerHTML = icon(ic);
    el.title = title;
    // a tab that lost its connection on purpose must not keep showing an old, frozen village
    if (s === 'replaced' || s === 'idle') {
      hud?.modal(`<h2>${icon(s === 'replaced' ? 'warning' : 'timer', 'i big')}${s === 'replaced' ? 'Opened somewhere else' : 'You were away'}</h2><p>${s === 'replaced' ? 'Your garden is open in another tab or browser, so this one stopped updating. Only one place can play at a time.' : 'You were idle for a while, so we paused your connection.'}</p><p><button class="btn gold" id="playHere">${icon('garden')}${s === 'replaced' ? 'Play here' : 'Rejoin'}</button></p>`, (c) => c.querySelector('#playHere').addEventListener('click', () => { hud.modal(null); socket.connect(); }));
      hud?.toast(title, 'bad', 6000);
    }
  });
  $('conn').addEventListener('click', () => { if (socket.status !== 'online') socket.connect(); });
  socket.on('welcome', () => { window.__mgOpenMgrd?.sync?.(); refreshVillageBoard(); });
  socket.on('welcome', (m) => {
    hud.wallet = null; // a fresh balance is not a payment: do not animate it
    chars.petsReady = false;
    store.welcome(m);
    const g = store.members.get(m.you.slot);
    player.spawn(g.x, g.z, g.ry);
    chars.sync();
    plants.resetAll();
    hud.refresh();
    $('chatLog').innerHTML = '';
    for (const c of m.chat ?? []) hud.chatLine(c.name, c.text);
    if (m.away) showAway(m.away);
    updateSigns();
    chars.syncPets();
    updateFestival();
  });
  socket.on('g', (m) => { store.applyGarden(m); if (m.slot !== store.you.slot) updateSigns(); });
  socket.on('sync', (m) => {
    const hadSurprise = !!store.me?.surprise;
    store.applyDelta(m.d);
    hud.refresh();
    for (const h of m.helped ?? []) { chars.petWork(store.you.slot, h); setTimeout(() => audio.play(h.did === 'water' ? 'water' : 'pop'), 900); }
    if (!hadSurprise && store.me.surprise) { audio.play('rare'); hud.toast({ crow: 'A crow is raiding your garden! Shoo it (E)!', gnome: 'A gnome is sneaking through your garden! Catch it (E)!', alien: 'A lost alien landed in your garden! It wants a snack (E).' }[store.me.surprise.kind], 'info', 5000); }
  });
  socket.on('pethelp', (m) => { for (const h of m.helped) chars.petWork(m.slot, h); });
  socket.on('profile', (m) => { const mem = store.members.get(m.slot); if (mem) { Object.assign(mem, { avatar: m.avatar, title: m.title, stars: m.stars, holder: m.holder, club: m.club }); chars.sync(); } });
  store.on('garden', () => chars.syncPets());
  socket.on('pos', (m) => {
    for (const [slot, x, z, ry, an] of m.n) {
      if (slot === store.you?.slot) continue;
      chars.push(slot, x / 100, z / 100, ry / 100, an);
      const mem = store.members.get(slot);
      if (mem) { mem.x = x / 100; mem.z = z / 100; }
    }
  });
  socket.on('fix', (m) => player.fix(m.x, m.z, m.travel));
  socket.on('join', (m) => { store.members.set(m.member.slot, m.member); store.gardens.set(m.member.slot, store.toGarden(m.garden)); chars.sync(); chars.syncPets(); plants.syncSlot(m.member.slot); updateSigns(); if (m.member.slot !== store.you.slot) hud.toast(`${m.member.name} joined the village!`, 'info'); });
  socket.on('leave', (m) => { store.members.delete(m.slot); store.gardens.delete(m.slot); chars.sync(); chars.syncPets(); plants.syncSlot(m.slot); updateSigns(); });
  socket.on('ghost', (m) => { const mem = store.members.get(m.slot); if (mem) { mem.ghost = true; chars.sync(); } });
  socket.on('afk', (m) => { const mem = store.members.get(m.slot); if (mem) { mem.afk = m.afk; chars.sync(); } });
  socket.on('like', (m) => { const mem = store.members.get(m.slot); if (mem) mem.likes = m.likes; updateSigns(); if (m.slot === store.you.slot) hud.toast(`${store.members.get(m.from)?.name ?? 'Someone'} left a mihao stamp on your garden!`, 'gold'); });
  // the Village panel follows people joining, leaving and changing while it is open
  for (const ev of ['join', 'leave', 'ghost', 'afk', 'like', 'profile']) socket.on(ev, () => { if (hud.panel === 'room' && hud.modalOpen) setTimeout(() => openPanel('room')); });
  socket.on('chat', (m) => { if (muted.has(m.name)) return; hud.chatLine(m.name, m.text); chars.say(m.slot, m.text); });
  socket.on('toast', (m) => { hud.toast(m.msg, m.kind ?? 'bad', m.kind === 'gold' ? 5000 : 2600); if (m.kind === 'gold') audio?.play('coin'); });
}

/** Send an action and show the result. */
async function act(a, p = {}, { quiet = false } = {}) {
  const from = { x: player.pos.x, z: player.pos.z };
  const r = await socket.act(a, p);
  const before = store.me?.rep?.level ?? 0;
  if (r.ok) {
    store.applyDelta(r.d); hud.refresh(); if (!quiet && r.msg) hud.toast(r.msg);
    const sfx = { plant: 'plant', water: 'water', harvest: 'harvest', sell: 'coin', buySeed: 'coin', buyGadget: 'coin', buyEgg: 'coin', buyDecor: 'coin', buyHome: 'levelup', hatch: 'hatch', expandSoil: 'levelup', claimQuest: 'coin', claimGift: 'rare', claimCollection: 'rare', claimSeason: 'coin', deliverOrder: 'coin', deliverContract: 'rare', pickAcorn: 'pop', placeDecor: 'plant', surprise: 'rare', rebirth: 'levelup', unlockIsland: 'levelup' }[a];
    if (sfx) audio.play(sfx);
    if (a === 'sell') meme?.onSale(r.x?.count ?? 0);
    meme?.onAction(a);
    juice?.result(a, p, r);
    if (a === 'travel') setTimeout(() => juice?.travel(from, { x: player.pos.x, z: player.pos.z }), 60);
    if ((store.me?.rep?.level ?? 0) > before) { audio.play('levelup'); hud.toast(`Reputation level ${store.me.rep.level}!`, 'gold', 3500); juice?.levelUp(store.me.rep.level); }
  } else { hud.toast(r.msg || 'That did not work.', 'bad'); audio.play('bad'); juice?.result(a, p, r); }
  return r;
}

// ---------------------------------------------------------------------------------------------
// Frame loop

function frame(t) {
  const raw = (t - lastFrame) / 1000;
  const dt = Math.min(0.05, raw); // animation step
  lastFrame = t;
  const walking = player.update(Math.min(0.25, raw), socket); // movement keeps real speed on slow devices
  chars.setLocal(player.pos, player.ry, player.an, player.speed);
  world.update(dt, player.pos);
  sky.update(dt, store.seed, store.now(), player.pos);
  plants.update(dt, world.camera.position);
  chars.update(dt);
  world.fx.update(dt);
  quality?.tick(t);
  ambient?.update(dt, quality?.ambient);
  estate.update(dt);
  plaza.update(dt);
  meme.update(dt);
  labels.update(store, plants, player.pos);
  hud.tick();
  updatePrompt();
  updateGhost();
  updateTutorial();
  if (t - mapAt > 110) mapAt = t, hud.drawMap(player.pos, player.ry, [...store.members.values()], store.you.slot);
  // remember which plot we are on to switch vendor talk off when walking away
  if (hud.dialogueOpen && walking && hud.dialogueStall) { const s = STALLS.find((x) => x.id === hud.dialogueStall); if (Math.hypot(s.x - player.pos.x, s.z - player.pos.z) > 6) closeDialogue(); }
  world.renderer.render(world.scene, world.camera);
  meme.afterRender(); // a clip copies the frame right after it is drawn
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------------------------
// Picking and interactions

const mySlot = () => store.you.slot;
const myLocal = () => toLocal(mySlot(), player.pos.x, player.pos.z);
const myPlants = () => [...(store.gardens.get(mySlot())?.plants.values() ?? [])];
const isRipe = (p) => !!p.fruit || store.now() >= p.readyAt;

function pick(clientX, clientY) {
  pointer.set((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, world.camera);
  const hits = raycaster.intersectObjects([...plants.pickables(), world.ground, ...world.plots.flatMap((p) => [p.soil, p.locked, p.ground].filter(Boolean))], true);
  for (const h of hits) {
    let o = h.object;
    while (o && !o.userData?.kind && o.parent) o = o.parent;
    if (o?.userData?.kind === 'plant') return { kind: 'plant', slot: o.userData.slot, id: o.userData.id, point: h.point };
    if (h.object.userData?.kind === 'soil') return { kind: 'soil', slot: h.object.userData.slot, point: h.point };
    if (h.object === world.ground || h.object.userData?.kind === 'plotground') return { kind: 'ground', point: h.point };
  }
  return null;
}

function wireInput(dom) {
  let down = null;
  dom.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, b: e.button }; });
  // game cursor: a grabbing fist while dragging the camera, a pointing glove over things you can click
  const host = $('world');
  let hoverAt = 0;
  dom.addEventListener('pointermove', (e) => {
    host.classList.toggle('dragging', !!down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 7);
    const now = performance.now();
    if (down || now - hoverAt < 90) return;
    hoverAt = now;
    const hit = pick(e.clientX, e.clientY);
    const [kind] = hud.selected.split(':');
    labels.hover = hit?.kind === 'plant' ? hit.id : null;
    host.classList.toggle('hover', !!hit && (hit.kind === 'plant' || (placing || kind === 'seed' || moving ? hit.slot === mySlot() : false)));
  });
  addEventListener('pointerup', () => host.classList.remove('dragging'));
  dom.addEventListener('pointerup', (e) => {
    if (!down || down.b !== 0 || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 7) { down = null; return; }
    down = null;
    onClick(pick(e.clientX, e.clientY));
  });
  dom.addEventListener('pointermove', (e) => { pointer.lastX = e.clientX; pointer.lastY = e.clientY; });
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') { if (e.key === 'Escape') e.target.blur(); return; }
    if (e.code === 'KeyE') interactNearest();
    if (e.code === 'KeyR' && placing) placing.rot = (placing.rot + 1) % 8;
    if (e.key === 'Enter') { $('chatInput').focus(); e.preventDefault(); }
    if (e.key === 'Escape') { closeDialogue(); hud.modal(null); moving = null; stopPlacing(); }
    if (hud.dialogueOpen) { const n = Number(e.key); if (n >= 1 && n <= hud.dialogueOpen.length) hud.dialogueOpen[n - 1].act(); }
  });
  $('chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('chatInput').value.trim();
    if (v) socket.raw({ t: 'chat', text: v });
    $('chatInput').value = '';
    $('chatInput').blur();
  });
  document.querySelectorAll('[data-travel]').forEach((b) => b.addEventListener('click', () => act('travel', { to: b.dataset.travel }, { quiet: true }).then(() => {
    const to = b.dataset.travel;
    if (to !== 'garden') setTimeout(() => openVendor(to), 150);
  })));
  document.querySelectorAll('[data-panel]').forEach((b) => b.addEventListener('click', () => openPanel(b.dataset.panel)));
  $('settingsBtn').addEventListener('click', openSettings);
  $('festBanner').addEventListener('click', () => F.festival());
  document.addEventListener('click', (e) => { if (e.target.closest('button')) audio?.play('click'); }, true);
  // touch controls
  if (matchMedia('(pointer: coarse)').matches) setupTouch();
}

function onSelect(id) {
  moving = null;
  const [kind, key] = id.split(':');
  if (kind === 'gadget' && !GADGETS[key].place && !['growJuice', 'oopsShovel'].includes(key)) {
    // instant gadgets: horn, rain jar, mystery box work from anywhere on your plot
    useInstantGadget(key);
  }
}

async function useInstantGadget(kind) {
  if (!onMyPlot()) { hud.toast('Use that in your own garden.', 'bad'); return; }
  const r = await act('useGadget', { kind });
  if (r.ok && kind === 'capyHorn') player.emote(socket, 6);
  hud.select('tool:hand');
}

function onMyPlot() {
  const l = myLocal();
  return Math.abs(l.x) <= PLOT.w / 2 + 1 && Math.abs(l.z) <= PLOT.d / 2 + 2.5;
}

/** Walk next to a plot-local point in my garden, then run fn. */
function reachThen(lx, lz, extra, fn) {
  const l = myLocal();
  if (Math.hypot(l.x - lx, l.z - lz) <= REACH + extra - 0.3) { fn(); return; }
  const dx = l.x - lx, dz = l.z - lz, d = Math.hypot(dx, dz) || 1;
  const stand = toWorld(mySlot(), lx + (dx / d) * 1.6, lz + (dz / d) * 1.6);
  player.walkTo(stand.x, stand.z, fn);
}

function onClick(hit) {
  if (!hit || hud.modalOpen) return;
  if (placing) {
    const l = toLocal(mySlot(), hit.point.x, hit.point.z);
    const c = canPlaceDecor(store.me, placing.kind, l.x, l.z, placing.moveId);
    if (!c.ok) return hud.toast(DECOR_MSG[c.code] ?? 'You cannot put it there.', 'bad');
    const pl = placing;
    return reachThen(l.x, l.z, 1, () => act(pl.moveId ? 'moveDecor' : 'placeDecor', { kind: pl.kind, id: pl.moveId, x: r2(l.x), z: r2(l.z), rot: pl.rot * (Math.PI / 4) }).then((r) => {
      if (!r.ok) return;
      if (!pl.moveId && store.me.decorInv?.[pl.kind] > 0) return; // keep placing more of the same
      stopPlacing();
    }));
  }
  const sel = hud.selected;
  const [kind, key] = sel.split(':');
  if (hit.kind === 'plant' && hit.slot === mySlot()) {
    const p = store.gardens.get(mySlot()).plants.get(hit.id);
    if (!p) return;
    return plantAction(p, kind, key);
  }
  if ((hit.kind === 'soil' || hit.kind === 'plant') && hit.slot === mySlot()) {
    const l = toLocal(mySlot(), hit.point.x, hit.point.z);
    if (moving) { const id = moving; return reachThen(l.x, l.z, 0.7, () => act('move', { id, x: r2(l.x), z: r2(l.z) }).then((r) => { if (r.ok) moving = null; })); }
    if (kind === 'seed') {
      const c = CROP[key];
      const ok = canPlace(store.me, c.radius, l.x, l.z, store.now());
      if (!ok.ok) return hud.toast({ off_soil: 'Plant on the soil!', locked_soil: 'Expand your soil to plant here!', too_close: 'Too close to another plant!' }[ok.code] ?? 'You cannot plant there.', 'bad');
      return reachThen(l.x, l.z, c.radius, async () => { player.emote(socket, 4); chars.playOneShot(mySlot(), 'plant'); await act('plant', { crop: key, x: r2(l.x), z: r2(l.z) }); });
    }
    if (kind === 'gadget' && GADGETS[key].place) return reachThen(l.x, l.z, 0.8, () => act('useGadget', { kind: key, x: r2(l.x), z: r2(l.z) }).then((r) => { if (r.ok) hud.select('tool:hand'); }));
  }
  // walk there
  player.walkTo(hit.point.x, hit.point.z);
}

function plantAction(p, kind, key) {
  const c = CROP[p.crop];
  const go = (fn) => reachThen(p.x, p.z, c.radius, fn);
  if (kind === 'tool' && key === 'water') return go(async () => { player.emote(socket, 5); chars.playOneShot(mySlot(), 'water'); await act('water', { id: p.id }); });
  if (kind === 'tool' && key === 'trowel') { moving = p.id; hud.toast(`Picked up the ${c.name}. Click the soil where it should go.`, 'info'); return; }
  if (kind === 'tool' && key === 'shovel') return confirmBox(`Remove this ${c.name}?`, 'You will not get the seed back.', 'Remove', 'red', () => go(() => act('remove', { id: p.id })));
  if (kind === 'gadget' && (key === 'growJuice' || key === 'oopsShovel')) return go(() => act('useGadget', { kind: key, id: p.id }).then((r) => { if (r.ok) hud.select('tool:hand'); }));
  if (isRipe(p)) return go(() => harvest(p));
  hud.toast(`${c.name} is still growing.`, 'info');
}

async function harvest(p) {
  player.emote(socket, 6);
  chars.playOneShot(mySlot(), 'harvest');
  const r = await act('harvest', { id: p.id }, { quiet: true });
  if (r.ok) {
    const items = store.me.basket.filter((i) => r.x?.items?.includes(i.id));
    const special = items.find((i) => i.variant !== 'normal' || i.big || i.env.length);
    const pos = toWorld(mySlot(), p.x, p.z);
    chars.floater(new THREE.Vector3(pos.x, 0, pos.z), `+${items.length} ${CROP[p.crop].name}`);
    hud.toast(special ? `Wow! ${describeItem(special)}!` : r.msg, special ? 'gold' : 'good');
    if (special) audio.play('rare');
    meme.onHarvest(items);
  }
}

function describeItem(i) {
  const bits = [];
  if (i.big) bits.push('BIG');
  if (i.variant !== 'normal') bits.push(cap(i.variant));
  for (const e of i.env) bits.push(cap(e));
  bits.push(CROP[i.crop].name);
  return bits.join(' ');
}
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const r2 = (v) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------------------------------------
// Nearest interactable (E key / prompt)

function nearest() {
  const px = player.pos.x, pz = player.pos.z;
  let best = null;
  const consider = (d, item) => { if (!best || d < best.d) best = { d, ...item }; };
  if (onMyPlot()) {
    const l = myLocal();
    for (const p of myPlants()) {
      const d = Math.hypot(p.x - l.x, p.z - l.z) - CROP[p.crop].radius;
      if (d <= REACH - 0.6) consider(d - (isRipe(p) ? 1 : 0), { kind: 'plant', plant: p });
    }
    for (const key of ['expand', 'growAll']) { const s = SIGNS[key]; const d = Math.hypot(s.x - l.x, s.z - l.z); if (d < 2.6) consider(d, { kind: 'sign', key }); }
  }
  for (const s of STALLS) { const d = Math.hypot(s.x - px, s.z - pz) - 2.2; if (d < 2.4) consider(d, { kind: 'stall', id: s.id }); }
  { const d = Math.hypot(BOARD.x - px, BOARD.z - pz); if (d < BOARD.reach) consider(d, { kind: 'board' }); }
  { const d = Math.hypot(BALLOON.x - px, BALLOON.z - pz); if (d < BALLOON.reach) consider(d, { kind: 'balloon' }); }
  if (onIsland(px, pz)) {
    const ib = { x: ISLAND.center.x + 4, z: ISLAND.center.z + ISLAND.radius - 7 };
    { const d = Math.hypot(ib.x - px, ib.z - pz); if (d < 4.5) consider(d, { kind: 'islandHome' }); }
    { const d = Math.hypot(ISLAND.center.x - px, ISLAND.center.z - pz); if (d < 4) consider(d, { kind: 'owl' }); }
    const day = dayKey(store.now());
    const picked = store.me.island?.day === day ? store.me.island.picked : [];
    acornSpots(store.me, day, store.seed).forEach((s, i) => {
      if (picked.includes(i)) return;
      const d = Math.hypot(ISLAND.center.x + s.x - px, ISLAND.center.z + s.z - pz);
      if (d < 2.6) consider(d - 1, { kind: 'acorn', i });
    });
  }
  if (onMyPlot()) {
    const l = myLocal();
    const s = store.me.surprise;
    if (s && s.until > store.now()) { const d = Math.hypot(s.x - l.x, s.z - l.z); if (d < 3.8) consider(d - 2, { kind: 'surprise' }); }
    { const d = Math.hypot(HOME_SPOT.x - l.x, HOME_SPOT.z + 3.8 - l.z); if (d < 3.4) consider(d + 0.5, { kind: 'home' }); }
    (store.me.eggs ?? []).forEach((egg, i) => { const d = Math.hypot(NEST_SPOT.x + i * NEST_SPOT.step - l.x, NEST_SPOT.z - l.z); if (d < 2.2 && store.now() >= egg.ready) consider(d - 1, { kind: 'egg', id: egg.id }); });
  }
  { const spot = meme.inspectorSpot(); if (spot) { const d = Math.hypot(spot.x - px, spot.z - pz); if (d < 4) consider(d - 3, { kind: 'inspector' }); } }
  for (const [slot] of store.members) {
    if (slot === mySlot()) continue;
    const w = toWorld(slot, SIGNS.owner.x, SIGNS.owner.z + 1.5);
    const d = Math.hypot(w.x - px, w.z - pz);
    if (d < 4.5) consider(d, { kind: 'like', slot });
  }
  return best;
}

function updatePrompt() {
  if (hud.modalOpen) { hud.prompt(null); return; }
  const n = nearest();
  if (!n) { hud.prompt(null); return; }
  if (n.kind === 'plant') {
    const p = n.plant, c = CROP[p.crop];
    if (isRipe(p)) {
      const r = Math.max(0, ripenessAt(p, store.now()));
      hud.prompt(`Harvest ${c.name}`, `${['Fresh', 'Juicy', 'Peak'][r]} · ${c.fruits} fruit`);
    } else {
      const left = Math.max(0, p.readyAt - store.now());
      hud.prompt(p.watered ? `${c.name} is growing` : `Water ${c.name}`, `Ready in ${Math.ceil(left / 1000)}s${p.buddy ? ' · buddy bonus' : ''}`);
    }
  } else if (n.kind === 'inspector') hud.prompt('Show your garden', 'Official Inspection');
  else if (n.kind === 'stall') hud.prompt(`Talk to ${STALL_NAME[n.id]}`, { seeds: 'Seed shop', market: 'Sell your crops', gadgets: 'Gadget shop', pets: 'Pet eggs and pet care' }[n.id]);
  else if (n.kind === 'sign') hud.prompt(n.key === 'expand' ? 'Expand Soil' : 'Grow All', n.key === 'expand' ? 'See what the next soil needs' : 'Finish growing everything now');
  else if (n.kind === 'board') hud.prompt('Village Board', 'Orders and the weekly contract');
  else if (n.kind === 'balloon') hud.prompt('Talk to Captain Puff', store.me.island?.unlocked ? 'Fly to Sky Island' : 'The balloon needs fixing');
  else if (n.kind === 'islandHome') hud.prompt('Fly home', 'Back to the village');
  else if (n.kind === 'owl') hud.prompt("Owl's Acorn Shop", `${store.me.island?.acorns ?? 0} Sky Acorns`);
  else if (n.kind === 'acorn') hud.prompt('Pick up the Sky Acorn', '');
  else if (n.kind === 'surprise') { const s = store.me.surprise; hud.prompt({ crow: 'Shoo the crow!', gnome: 'Catch the gnome!', alien: 'Help the lost alien' }[s.kind], s.kind === 'alien' ? `It wants a ${CROP[s.want]?.name ?? 'snack'}` : `${Math.ceil((s.until - store.now()) / 1000)}s left`); }
  else if (n.kind === 'home') hud.prompt(store.me.home ? 'Your home' : 'Build a home', 'Sale bonus and upgrades');
  else if (n.kind === 'egg') hud.prompt('Hatch the egg!', 'Something is wiggling inside');
  else if (n.kind === 'like') { const m = store.members.get(n.slot); hud.prompt(store.liked.has(n.slot) ? `You stamped ${m?.name}'s garden` : `Leave a mihao stamp for ${m?.name}`, `${m?.likes ?? 0} stamps`); }
}

function interactNearest() {
  if (hud.modalOpen) return;
  const n = nearest();
  if (!n) return;
  if (n.kind === 'plant') {
    const [kind, key] = hud.selected.split(':');
    if (isRipe(n.plant)) return harvest(n.plant);
    if (kind === 'tool' && key === 'hand' && !n.plant.watered) return plantAction(n.plant, 'tool', 'water');
    return plantAction(n.plant, kind, key);
  }
  if (n.kind === 'inspector') return meme.showGarden();
  if (n.kind === 'stall') return openVendor(n.id);
  if (n.kind === 'board') return F.board();
  if (n.kind === 'balloon') return F.balloon();
  if (n.kind === 'islandHome') return travelTo('garden');
  if (n.kind === 'owl') return F.islandShop();
  if (n.kind === 'acorn') return act('pickAcorn', { i: n.i });
  if (n.kind === 'surprise') { chars.playOneShot(mySlot(), 'wave'); player.emote(socket, 7); return act('surprise'); }
  if (n.kind === 'home') return F.home();
  if (n.kind === 'egg') return act('hatch', { id: n.id }).then((r) => { if (r.ok) { hud.toast(r.msg, 'gold', 4000); } });
  if (n.kind === 'sign') return n.key === 'expand' ? openExpand() : openGrowAll();
  if (n.kind === 'like') return act('like', { slot: n.slot }).then((r) => { if (r.ok) { store.liked.add(n.slot); player.emote(socket, 7); chars.playOneShot(mySlot(), 'wave'); } });
}

// ---------------------------------------------------------------------------------------------
// Placement ghost

function updateGhost() {
  const [kind, key] = hud.selected.split(':');
  if (placing) return updateDecorGhost();
  const radius = kind === 'seed' ? CROP[key].radius : kind === 'gadget' && GADGETS[key]?.place ? 0.8 : moving ? CROP[store.gardens.get(mySlot())?.plants.get(moving)?.crop]?.radius : null;
  if (!radius || pointer.lastX == null || !onMyPlotLoose()) { if (ghost) ghost.visible = false; return; }
  const hit = pick(pointer.lastX, pointer.lastY);
  if (!hit || hit.slot !== mySlot()) { if (ghost) ghost.visible = false; return; }
  if (!ghost) {
    ghost = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false }));
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 40), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false }));
    disc.rotation.x = ring.rotation.x = -Math.PI / 2;
    ghost.add(disc, ring);
    world.plots[mySlot()].group.add(ghost);
    ghost.userData = { disc, ring };
  }
  if (ghost.parent !== world.plots[mySlot()].group) world.plots[mySlot()].group.add(ghost);
  const l = toLocal(mySlot(), hit.point.x, hit.point.z);
  const ok = canPlace(store.me, radius, l.x, l.z, store.now(), moving).ok;
  const color = ok ? '#2FB463' : '#D93A3A';
  ghost.userData.disc.material.color.set(color);
  ghost.userData.ring.material.color.set(color);
  ghost.scale.setScalar(radius * 0.9);
  ghost.position.set(l.x, 0.09, l.z);
  ghost.visible = true;
}
let decorGhost = null;
function updateDecorGhost() {
  if (pointer.lastX == null) return;
  const hit = pick(pointer.lastX, pointer.lastY);
  if (!hit) { if (decorGhost) decorGhost.visible = false; return; }
  if (!decorGhost || decorGhost.userData.kind !== placing.kind) {
    if (decorGhost) decorGhost.parent?.remove(decorGhost);
    decorGhost = new THREE.Group();
    decorGhost.userData.kind = placing.kind;
    const def = DECOR[placing.kind];
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 40), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06;
    ring.scale.setScalar(def.r * (def.scale ?? 1));
    decorGhost.add(ring);
    decorGhost.userData.ring = ring;
    assets.prop(def.model).then((m) => {
      if (decorGhost?.userData.kind !== placing?.kind) return;
      const o = m.scene.clone();
      o.scale.setScalar(def.scale ?? 1);
      o.traverse((x) => { if (x.isMesh) { x.material = x.material.clone(); x.material.transparent = true; x.material.opacity = 0.6; x.castShadow = false; } });
      decorGhost.add(o);
    });
    world.plots[mySlot()].group.add(decorGhost);
  }
  const l = toLocal(mySlot(), hit.point.x, hit.point.z);
  const ok = canPlaceDecor(store.me, placing.kind, l.x, l.z, placing.moveId).ok;
  decorGhost.userData.ring.material.color.set(ok ? '#2FB463' : '#D93A3A');
  decorGhost.position.set(l.x, 0.02, l.z);
  decorGhost.rotation.y = placing.rot * (Math.PI / 4);
  decorGhost.visible = true;
}
function startPlacing(p) {
  if (!onMyPlotLoose()) travelTo('garden');
  placing = { rot: 0, ...p };
  hud.toast('Click a free spot in your garden. R rotates, Esc stops.', 'info', 4000);
}
function stopPlacing() { placing = null; if (decorGhost) { decorGhost.parent?.remove(decorGhost); decorGhost = null; } }

/** Teleport to a place (same as the travel tabs). */
function travelTo(to) {
  closeDialogue();
  return act('travel', { to }, { quiet: true });
}

/** Is the player near a feature spot? */
function near(what) {
  const px = player.pos.x, pz = player.pos.z;
  if (what === 'board') return Math.hypot(BOARD.x - px, BOARD.z - pz) <= BOARD.reach + 0.8;
  if (what === 'balloon') return Math.hypot(BALLOON.x - px, BALLOON.z - pz) <= BALLOON.reach + 0.8;
  if (what === 'island') return onIsland(px, pz);
  return stallNear(what);
}

/** Save a postcard picture of the current view with a little frame. */
function postcardShot() {
  world.renderer.render(world.scene, world.camera);
  const src = world.renderer.domElement;
  const W = 1200, H = Math.round((W * src.height) / src.width);
  const c = document.createElement('canvas'); c.width = W + 40; c.height = H + 110;
  const g = c.getContext('2d');
  g.fillStyle = '#FFF4DC'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(src, 20, 20, W, H);
  g.save(); g.beginPath(); g.rect(20, 20, W, H); g.clip(); g.translate(20, 20); drawOverlay(g, W / innerWidth); g.restore();
  g.strokeStyle = '#4A2E1A'; g.lineWidth = 6; g.strokeRect(20, 20, W, H);
  g.fillStyle = '#4A2E1A'; g.font = '800 40px "Baloo 2", sans-serif';
  g.fillText(`Greetings from ${store.you.name}'s garden!`, 30, H + 75);
  g.font = '700 22px "Baloo 2", sans-serif';
  g.fillText(`Mihao Garden · ${new Date(store.now()).toISOString().slice(0, 10)}`, W - 300, H + 75);
  const a = document.createElement('a');
  a.download = `mihao-garden-${Date.now()}.png`;
  a.href = c.toDataURL('image/png');
  a.click();
  audio.play('pop');
  hud.toast('Postcard saved to your downloads!', 'good');
}

function updateFestival() {
  const f = festivalAt(store.now());
  const el = $('festBanner');
  el.hidden = !f;
  if (f) el.querySelector('b').textContent = f.name;
}
setInterval(() => { if (store.me) updateFestival(); }, 30000);

/** Fountain name and Fireworks Pot status for the plaza (public, refreshed every minute). */
async function refreshVillageBoard() {
  try {
    const b = await (await fetch('/api/village-board')).json();
    plaza.setPlaque(b.plaque);
    plaza.on = !!b.fireworks;
  } catch { /* chain features off */ }
}
setInterval(() => { if (plaza) refreshVillageBoard(); }, 60_000);

const onMyPlotLoose = () => plotAt(player.pos.x, player.pos.z) === mySlot() || onMyPlot();

// ---------------------------------------------------------------------------------------------
// Vendors and panels

function closeDialogue() {
  if (hud.dialogueStall) chars.vendorTalk(hud.dialogueStall, false);
  hud.dialogueStall = null;
  hud.dialogue(null);
}

function openVendor(id) {
  chars.vendorTalk(id, true);
  hud.dialogueStall = id;
  if (id === 'seeds') {
    hud.dialogue(STALL_NAME.seeds, pick1(['*yawn* Oh! A customer. Seeds?', 'Fresh seeds, only slightly sat on.', 'Restock is soon. Or was it just now?']), [
      { text: 'Show me your seeds.', act: () => { closeDialogue(); openSeedShop(); } },
      { text: 'When is the next restock?', act: () => hud.toast(`Next restock in ${$('restockTime').textContent}.`, 'info') },
      { text: 'Bye!', act: closeDialogue },
    ]);
  } else if (id === 'market') {
    const sellable = store.me.basket.filter((i) => !i.star);
    hud.dialogue(STALL_NAME.market, pick1(['Let me see those crops. Mmm, crunchy.', 'Is that a BIG one? I am drooling.', 'Sell it before I eat it.']), [
      { text: 'What is my basket worth?', act: () => { const a = appraise(store.me, 'all', store.now()); hud.toast(`${a.count} crops: about ${full(a.total)} coins.`, 'gold'); } },
      { text: 'Show me my basket.', act: () => { closeDialogue(); openPanel('basket'); } },
      { text: `Sell everything (${sellable.length})`, act: () => { closeDialogue(); if (sellable.length) act('sell', { all: true }).then((r) => { if (r.ok) chars.floater(player.pos.clone(), `+${short(r.x?.value ?? 0)}`); }); } },
      { text: 'Got any snacks?', act: () => { closeDialogue(); act('pity'); } },
      { text: 'Bye!', act: closeDialogue },
    ]);
  } else if (id === 'gadgets') {
    hud.dialogue(STALL_NAME.gadgets, pick1(['Sprinklers, horns, juice. All tested! Mostly.', 'This one is a rocket. For plants. Probably.', 'Need something that goes TOOT?']), [
      { text: 'Show me your gadgets.', act: () => { closeDialogue(); openGadgetShop(); } },
      { text: 'Bye!', act: closeDialogue },
    ]);
  } else if (id === 'pets') {
    hud.dialogue(STALL_NAME.pets, pick1(['Every egg is warm and loved. Mostly warm.', 'Pets water and harvest while you nap!', 'Psst, the legendary eggs wiggle the most.']), [
      { text: 'Show me your eggs.', act: () => { closeDialogue(); openEggShop(); } },
      { text: 'How are my pets?', act: () => { closeDialogue(); F.pets(); } },
      { text: 'Bye!', act: closeDialogue },
    ]);
  }
}
const pick1 = (a) => a[Math.floor(Math.random() * a.length)];

function stallNear(id) { const s = STALLS.find((x) => x.id === id); return Math.hypot(s.x - player.pos.x, s.z - player.pos.z) <= s.reach + 1; }

function openSeedShop() {
  const r = restockIndex(store.now());
  const stock = stockAt(store.seed, r);
  const rows = CROPS.filter((c) => !c.unlock).map((c) => {
    const left = remaining(store.me, store.seed, store.now(), 'seed', c.id);
    const can = left > 0 && store.me.coins >= c.seed;
    return `<div class="row"><div class="crop" style="${assets.cropIconStyle(c.id, 52)}"></div><div class="meta"><b>${esc(c.name)}</b><span><em class="tag ${c.tier}">${cap(c.tier)}</em>${left ? `${left} in stock` : 'Out of stock'} · ${c.regrow ? `${c.fruits} fruit, regrows` : 'single harvest'}</span></div><button class="btn gold" data-buy="${c.id}" ${can ? '' : 'disabled'}>${icon('coin')}${short(c.seed)}</button></div>`;
  }).join('');
  hud.modal(`<h2>${icon('seeds', 'i big')}Mo's Seed Shop</h2><div class="tabsmall"><button class="on">Seeds</button><button id="decorTab">Decorations</button></div><p class="soft">Restocks every 5 minutes. Rare seeds are not always in stock.</p><div class="list">${rows}</div>`, (card) => {
    card.querySelector('#decorTab').addEventListener('click', openDecorShop);
    card.querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', async () => {
      if (!stallNear('seeds')) return hud.toast('Walk up to the seed stall first.', 'bad');
      const res = await act('buySeed', { id: b.dataset.buy, n: 1 });
      if (res.ok) openSeedShop();
    }));
  });
  void stock;
}

function openGadgetShop() {
  const rows = Object.entries(GADGETS).filter(([, g]) => g.price != null).map(([id, g]) => {
    const left = remaining(store.me, store.seed, store.now(), 'gadget', id);
    const owned = g.permanent ? store.me.tools[id] : store.me.gadgets[id] ?? 0;
    const can = left > 0 && store.me.coins >= g.price && !(g.permanent && owned);
    return `<div class="row">${icon(id)}<div class="meta"><b>${esc(g.name)}</b><span>${gadgetText(id)} ${g.permanent ? (owned ? '· Owned' : '') : owned ? `· You have ${owned}` : ''} · ${left ? `${left} in stock` : 'Out of stock'}</span></div><button class="btn gold" data-buy="${id}" ${can ? '' : 'disabled'}>${icon('coin')}${short(g.price)}</button></div>`;
  }).join('');
  hud.modal(`<h2>${icon('shop', 'i big')}Tess's Gadgets</h2><div class="list">${rows}</div>`, (card) => {
    card.querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', async () => {
      if (!stallNear('gadgets')) return hud.toast('Walk up to the gadget stall first.', 'bad');
      const res = await act('buyGadget', { id: b.dataset.buy });
      if (res.ok) openGadgetShop();
    }));
  });
}

function openDecorShop() {
  hud.modal(`<h2>${icon('decor', 'i big')}Mo's Decorations</h2><div class="tabsmall"><button id="seedTab">Seeds</button><button class="on">Decorations</button></div><p class="soft">Decorations are sold for $MGRD (festivals, contracts and surprises still give some for free). They go anywhere in your fence, off the soil; open Menu, then Decor, to place them.</p><div class="list">${F.decorShopHtml()}</div>`, (card) => {
    card.querySelector('#seedTab').addEventListener('click', openSeedShop);
    window.__mgOpenMgrd?.bindTags(card, openDecorShop);
    card.querySelectorAll('[data-decor]').forEach((b) => b.addEventListener('click', async () => {
      if (!stallNear('seeds')) return hud.toast('Walk up to the seed stall first.', 'bad');
      const r = await act('buyDecor', { id: b.dataset.decor });
      if (r.ok) openDecorShop();
    }));
  });
}

function openEggShop() {
  hud.modal(`<h2>${icon('paw', 'i big')}Penny's Pet Shop</h2><p class="soft">Pet eggs are sold for $MGRD. They warm in nests next to your home. Pets water or harvest for you, even while you are away.</p><div class="list">${F.eggShopHtml()}</div>`, (card) => {
    window.__mgOpenMgrd?.bindTags(card, openEggShop);
    card.querySelectorAll('[data-egg]').forEach((b) => b.addEventListener('click', async () => {
      if (!stallNear('pets')) return hud.toast('Walk up to the Pet Shop first.', 'bad');
      const r = await act('buyEgg', { id: b.dataset.egg });
      if (r.ok) openEggShop();
    }));
  });
}

function gadgetText(id) {
  return {
    bubbleSprinkler: 'Plants nearby grow 50% faster for 4 min.',
    rocketSprinkler: 'Plants in a wide circle grow twice as fast for 4 min.',
    capyHorn: 'Harvest every ripe plant at once. 2 toots.',
    growJuice: 'One plant ripens instantly.',
    mysteryBox: 'A random seed. Rarer is luckier.',
    oopsShovel: 'Dig up a plant and get its seed back.',
    magnifier: 'See every plant in detail. Forever.',
    rainJar: 'Your garden counts as Rain for 2 min.',
  }[id] ?? '';
}

function openPanel(name) {
  if (name === 'basket') {
    const me = store.me;
    const rows = me.basket.slice().sort((a, b) => salePrice(me, b, store.now()) - salePrice(me, a, store.now())).map((i) => {
      const tags = [i.big ? '<em class="tag mut">BIG</em>' : '', i.variant !== 'normal' ? `<em class="tag mut">${cap(i.variant)}</em>` : '', ...i.env.map((e) => `<em class="tag mut">${cap(e)}</em>`)].join('');
      return `<div class="row"><div class="crop" style="${assets.cropIconStyle(i.crop, 52)}"></div><div class="meta"><b>${esc(CROP[i.crop].name)} ${tags}</b><span>${i.mass} kg · ${['Fresh', 'Juicy', 'Peak'][i.ripe ?? 0]} · worth <span class="money">${full(salePrice(me, i, store.now()))}</span></span></div><button class="btn ${i.star ? 'gold' : 'blue'}" data-star="${i.id}" title="${i.star ? 'Protected from selling' : 'Protect from selling'}">${icon('star')}</button>${stallNear('market') ? `<button class="btn" data-sell="${i.id}" ${i.star ? 'disabled' : ''}>Sell</button>` : ''}</div>`;
    }).join('') || '<p>Your basket is empty. Harvest something!</p>';
    const total = appraise(me, 'all', store.now());
    hud.modal(`<h2>${icon('basket', 'i big')}Basket ${me.basket.length}/100</h2><p class="soft">${stallNear('market') ? `Sell all unstarred: about <b class="money">${full(total.total)}</b> coins.` : 'Visit Gus the Mihao at the market to sell.'}</p>${stallNear('market') && total.count ? `<p><button class="btn gold" id="sellAll">${icon('coin')}Sell all (${total.count})</button></p>` : ''}<div class="list">${rows}</div>`, (card) => {
      card.querySelectorAll('[data-star]').forEach((b) => b.addEventListener('click', () => act('star', { id: b.dataset.star }, { quiet: true }).then(() => openPanel('basket'))));
      card.querySelectorAll('[data-sell]').forEach((b) => b.addEventListener('click', () => act('sell', { ids: [b.dataset.sell] }).then(() => openPanel('basket'))));
      card.querySelector('#sellAll')?.addEventListener('click', () => act('sell', { all: true }).then(() => openPanel('basket')));
    });
  } else if (name === 'quests') {
    const q = (list, weekly) => list.map((x) => `<div class="row ${x.claimed ? 'claimed' : x.progress >= x.target ? 'ready' : ''}"><span class="box big">${x.progress >= x.target ? icon('check') : ''}</span><div class="meta"><b>${esc(questText(x))}</b><div class="pbar"><i style="width:${Math.round(Math.min(1, x.progress / x.target) * 100)}%"></i></div><span>${x.claimed ? 'Claimed' : x.progress >= x.target ? 'Done! Claim your reward' : `${short(Math.min(x.progress, x.target))} / ${short(x.target)}`} · Reward: ${short(x.reward.coins)} coins${x.reward.gems ? `, ${x.reward.gems} gems` : ''}${Object.keys(x.reward.gadgets ?? {}).map((g) => `, ${GADGETS[g].name}`).join('')}</span></div><button class="btn gold" data-claim="${x.id}" data-weekly="${weekly ? 1 : ''}" ${x.claimed || x.progress < x.target ? 'disabled' : ''}>${x.claimed ? 'Done' : 'Claim'}</button></div>`).join('');
    hud.modal(`<h2>${icon('quests', 'i big')}Quests</h2><p class="soft">New daily quests every day at 00:00 UTC.</p><h3>Today</h3><div class="list">${q(store.me.daily.quests)}</div><h3>This week</h3><div class="list">${q(store.me.weekly.quests, true)}</div>`, (card) => {
      card.querySelectorAll('[data-claim]').forEach((b) => b.addEventListener('click', () => act('claimQuest', { id: b.dataset.claim, weekly: !!b.dataset.weekly }).then(() => openPanel('quests'))));
    });
  } else if (name === 'gift') {
    const g = store.me.gift;
    const today = new Date(store.now()).toISOString().slice(0, 10);
    const days = ['60 coins + 1 gem', 'Grow Juice', 'Bubble Sprinkler', '180 coins + 4 gems', 'Mystery Seed Box', 'Capybara Horn', '600 coins + 10 gems + 3 boxes'];
    const next = g.last === today ? g.streak : g.last === new Date(store.now() - 86400000).toISOString().slice(0, 10) ? (g.streak % 7) + 1 : 1;
    hud.modal(`<h2>${icon('gift', 'i big')}Daily Gift</h2><div class="list">${days.map((d, i) => `<div class="row">${icon(i + 1 <= (g.last === today ? g.streak : next - 1) ? 'check' : 'gift')}<div class="meta"><b>Day ${i + 1}</b><span>${d}</span></div></div>`).join('')}</div><p>${g.last === today ? 'Come back tomorrow for the next gift!' : `<button class="btn gold" id="claimGift">${icon('gift')}Claim day ${next}</button>`}</p>`, (card) => {
      card.querySelector('#claimGift')?.addEventListener('click', () => act('claimGift').then(() => openPanel('gift')));
    });
  } else if (name === 'room') {
    const rows = [...store.members.values()].sort((a, b) => a.slot - b.slot).map((m) => `<div class="row">${icon('user')}<div class="meta"><b>${m.stars ? `${m.stars} star${m.stars > 1 ? 's' : ''} · ` : ''}${esc(m.name)}${m.slot === mySlot() ? ' (you)' : ''}</b><span>Plot ${m.slot + 1} · ${m.likes ?? 0} stamps${m.title ? ` · ${esc(m.title)}` : ''}${m.ghost ? ' · reconnecting' : m.afk ? ' · away' : ''}</span></div>${m.slot === mySlot() ? '' : `<button class="btn blue" data-visit="${m.slot}">Visit</button><button class="btn mgrdpay" data-tipto="${m.slot}" title="Tip $MGRD">${icon('mgrd')}Tip</button><button class="btn blue" data-giftto="${m.slot}" data-name="${esc(m.name)}">${icon('gift')}Gift</button><button class="btn ${muted.has(m.name) ? 'gold' : 'blue'}" data-mute="${esc(m.name)}">${muted.has(m.name) ? 'Unmute' : 'Mute'}</button><button class="btn red" data-report="${m.slot}">Report</button>`}</div>`).join('');
    hud.modal(`<h2>${icon('room', 'i big')}Village ${esc(store.roomId)} · ${store.members.size}/12</h2><p class="soft">Walk up to a garden's sign and press E to like it. <button class="btn blue" id="friendsBtn">${icon('friends')}Friends</button></p><div class="list">${rows}</div>`, (card) => {
      card.querySelector('#friendsBtn').addEventListener('click', () => F.friends());
      card.querySelectorAll('[data-visit]').forEach((b) => b.addEventListener('click', () => { hud.modal(null); const s = PLOT_SLOTS[Number(b.dataset.visit)]; const w = toWorld(s.index, 0, PLOT.d / 2 + 3); player.walkTo(w.x, w.z); }));
      card.querySelectorAll('[data-tipto]').forEach((b) => b.addEventListener('click', () => window.__mgOpenMgrd?.tip(Number(b.dataset.tipto))));
      card.querySelectorAll('[data-giftto]').forEach((b) => b.addEventListener('click', () => window.__mgOpenMgrd?.gift(Number(b.dataset.giftto), b.dataset.name)));
      card.querySelectorAll('[data-mute]').forEach((b) => b.addEventListener('click', () => {
        const n = b.dataset.mute;
        if (muted.has(n)) muted.delete(n); else muted.add(n);
        try { localStorage.setItem('mg-muted', JSON.stringify([...muted])); } catch { /* private mode */ }
        openPanel('room');
      }));
      card.querySelectorAll('[data-report]').forEach((b) => b.addEventListener('click', () => {
        const slot = Number(b.dataset.report);
        hud.modal(`<h2>Report ${esc(store.members.get(slot)?.name)}</h2><p>What happened?</p><p>${['Rude chat', 'Spam', 'Bad name', 'Other'].map((r) => `<button class="btn red" data-why="${r}">${r}</button>`).join(' ')}</p>`, (c2) => c2.querySelectorAll('[data-why]').forEach((x) => x.addEventListener('click', () => { hud.modal(null); act('report', { slot, reason: x.dataset.why }); })));
      }));
    });
    hud.panel = 'room';
  } else if (name === 'more') {
    F.more([['mgrd', '$MGRD Rewards', () => window.__mgOpenMgrd?.()], ['settings', 'Settings', openSettings]]);
  }
}

function openExpand() {
  const r = soilRequirements(store.me);
  if (r.max) return hud.modal(`<h2>${icon('expand', 'i big')}Expand Soil</h2><p>Your soil is already at full size (${SOIL_LEVELS[SOIL_LEVELS.length - 1].area} m²). Amazing garden!</p>`);
  const me = store.me;
  const items = [{ label: 'Garden Coins', have: me.coins, need: r.next.price, money: true }];
  if (r.next.requires) {
    const q = r.next.requires;
    if (q.species) items.push({ label: 'Different crops harvested', have: Object.keys(me.species).length, need: q.species });
    if (q.harvested) items.push({ label: 'Crops harvested in total', have: me.stats.harvested, need: q.harvested });
    for (const [c, n] of Object.entries(q.items ?? {})) items.push({ label: `${CROP[c].name} in your basket (delivered)`, have: me.basket.filter((i) => i.crop === c && !i.star).length, need: n });
  }
  hud.modal(`<h2>${icon('expand', 'i big')}Expand Soil</h2><p>Grow your soil from <b>${SOIL_LEVELS[me.soil].area} m²</b> to <b>${r.next.area} m²</b>${r.next.requires ? ` (${r.next.requires.name})` : ''}.</p>${checklist(items)}<p><button class="btn" id="doExpand" ${r.ok ? '' : 'disabled'}>${icon('expand')}${r.ok ? 'Expand!' : 'Not ready yet'}</button> ${window.__mgOpenMgrd?.priceTag('soil', '') ?? ''}</p>${window.__mgOpenMgrd?.priceTag('soil', '') ? '<p class="soft">$MGRD pays only the coin price; the crop and harvest requirements still apply.</p>' : ''}`, (card) => {
    window.__mgOpenMgrd?.bindTags(card, () => hud.modal(null));
    card.querySelector('#doExpand')?.addEventListener('click', () => act('expandSoil').then((res) => { if (res.ok) hud.modal(null); }));
  });
}

function openGrowAll() {
  const q = growAllQuote(store.me, store.now(), store.seed);
  if (!q.count) return hud.toast('Everything is already grown!', 'info');
  const tag = window.__mgOpenMgrd?.priceTag('growall', '') ?? '';
  hud.modal(`<h2>Grow All</h2><p>Finish growing ${q.count} plant${q.count > 1 ? 's' : ''} right now for ${full(q.cost)} coins? It costs more than the crops are usually worth: it is for when you cannot wait.</p><p><button class="btn gold" id="okBtn" ${store.me.coins >= q.cost ? '' : 'disabled'}>Grow for ${short(q.cost)}</button> ${tag} <button class="btn blue" id="noBtn">Cancel</button></p>`, (card) => {
    card.querySelector('#okBtn').addEventListener('click', () => { hud.modal(null); act('growAll', { quote: q.cost }); });
    card.querySelector('#noBtn').addEventListener('click', () => hud.modal(null));
    window.__mgOpenMgrd?.bindTags(card, () => hud.modal(null));
  });
}

function confirmBox(title, text, okText, cls, fn) {
  hud.modal(`<h2>${esc(title)}</h2><p>${esc(text)}</p><p><button class="btn ${cls}" id="okBtn">${esc(okText)}</button> <button class="btn blue" id="noBtn">Cancel</button></p>`, (card) => {
    card.querySelector('#okBtn').addEventListener('click', () => { hud.modal(null); fn(); });
    card.querySelector('#noBtn').addEventListener('click', () => hud.modal(null));
  });
}

function showAway(a) {
  const mins = Math.round(a.away / 60000);
  const ripe = a.ripened.reduce((n, r) => n + r.fruit, 0);
  hud.modal(`<h2>${icon('sparkle', 'i big')}The Garden Gazette</h2><p><b>LOCAL GARDEN CARRIES ON WITHOUT ITS OWNER</b></p><p>You were away for ${mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`}. ${a.ripened.length ? `${a.ripened.length} plant${a.ripened.length > 1 ? 's' : ''} ripened with ${ripe} fruit waiting for you.` : 'Your plants kept growing.'}${a.strikes ? ` The sky struck ${a.strikes} time${a.strikes > 1 ? 's' : ''}: look for Zapped or Starstruck crops!` : ''}</p><p><button class="btn" id="okBtn">Let's go!</button></p>`, (card) => card.querySelector('#okBtn').addEventListener('click', () => hud.modal(null)));
}

function showRecovery(code, first) {
  hud.modal(`<h2>${icon('key', 'i big')}${first ? 'Your garden is saved' : 'Recovery code'}</h2><p>Your garden is saved on this browser. Keep this code to open it on another device:</p><p style="font-size:30px;font-weight:800;letter-spacing:2px">${esc(code)}</p><p class="soft">Anyone with the code can open your garden, so keep it private.</p><p><button class="btn" id="okBtn">Got it</button></p>`, (card) => card.querySelector('#okBtn').addEventListener('click', () => hud.modal(null)));
}

function openSettings() {
  hud.modal(`<h2>${icon('settings', 'i big')}Settings</h2><p><b>${esc(store.you?.name)}</b> · Village ${esc(store.roomId)}</p><p>Have a recovery code from another device?</p><p><input id="rc" placeholder="XXXX-XXXX-XXXX" style="font:700 20px var(--font);padding:6px 10px;border:3px solid var(--bark);border-radius:10px;width:220px"> <button class="btn" id="rcBtn">${icon('key')}Open that garden</button></p><h3>${icon('settings')}Graphics</h3><p>${QUALITY_CHOICES.map(([id, name]) => `<button class="btn ${quality.mode === id ? 'gold' : 'blue'}" data-gfx="${id}">${name}</button>`).join(' ')}</p><p class="soft">Auto lowers detail only if your device runs slowly. Choose Fastest for an older phone or computer.</p><h3>${icon('sound')}Sound</h3><p>Effects <input type="range" id="sfxVol" min="0" max="1" step="0.05" value="${audio.sfxVol}"> Music <input type="range" id="musVol" min="0" max="1" step="0.05" value="${audio.musicVol}"></p><p class="soft">Farmer model based on "Cartoon farmer character model" by zyroiscool2025 (sketchfab.com/zyroiscool2025), licensed CC-BY-4.0.</p><p class="soft">Controls: WASD or arrows to move, Shift to run, Space to jump, E to interact, mouse drag to look, wheel to zoom, 1-9 for the hotbar, Enter to chat, R to rotate decorations.</p>`, (card) => {
    card.querySelectorAll('[data-gfx]').forEach((b) => b.addEventListener('click', () => { quality.set(b.dataset.gfx); card.querySelectorAll('[data-gfx]').forEach((x) => { x.className = `btn ${x === b ? 'gold' : 'blue'}`; }); }));
    card.querySelector('#sfxVol').addEventListener('input', (e) => { audio.unlock(); audio.setSfx(Number(e.target.value)); });
    card.querySelector('#musVol').addEventListener('input', (e) => { audio.unlock(); audio.setMusic(Number(e.target.value)); });
    card.querySelector('#rcBtn').addEventListener('click', async () => {
      try { await recover(card.querySelector('#rc').value); location.reload(); } catch (e) { hud.toast(e.message, 'bad'); }
    });
  });
}

function updateSigns() {
  for (const [i, plot] of world.plots.entries()) {
    const m = store.members.get(i);
    if (!m) { plot.signs.owner.draw('Empty Plot', 'Waiting for a gardener', '#FFF4DC'); plot.signs.expand.draw('', ''); plot.signs.growAll.draw('', ''); continue; }
    plot.signs.owner.draw(m.name.length > 16 ? `${m.name.slice(0, 15)}.` : m.name, `${m.likes ?? 0} stamps`);
    const g = store.gardens.get(i);
    const next = SOIL_LEVELS[(g?.soil ?? 0) + 1];
    plot.signs.expand.draw('Expand Soil', next ? short(next.price) : 'Max size!');
    plot.signs.growAll.draw('Grow All', i === mySlot() ? (() => { const q = growAllQuote(store.me, store.now(), store.seed); return q.count ? short(q.cost) : 'All grown!'; })() : '');
  }
}
setInterval(() => { if (store.me) updateSigns(); }, 2000);

// ---------------------------------------------------------------------------------------------
// Tutorial pointer: buy a carrot -> plant -> harvest -> sell

function updateTutorial() {
  const el = $('pointer');
  const me = store.me;
  if (!me || me.tutorial >= 4 || hud.modalOpen) { el.hidden = true; return; }
  let target = null, text = '';
  const plantsList = myPlants();
  if (me.stats.sold > 0) { if (!tutorialSent) { tutorialSent = true; act('tutorial', { step: 4 }, { quiet: true }); hud.toast('You sold your first crop! The garden is yours.', 'gold', 4000); } el.hidden = true; return; }
  if (me.basket.length) { const s = STALLS.find((x) => x.id === 'market'); target = new THREE.Vector3(s.x, 3.2, s.z); text = 'Sell it to Gus the Mihao!'; }
  else if (plantsList.some(isRipe)) { const p = plantsList.find(isRipe); const w = toWorld(mySlot(), p.x, p.z); target = new THREE.Vector3(w.x, 1.4, w.z); text = 'Harvest it! (E)'; }
  else if (plantsList.length) { const p = plantsList[0]; const w = toWorld(mySlot(), p.x, p.z); target = new THREE.Vector3(w.x, 1.2, w.z); text = 'Water it while it grows'; }
  else if (me.seeds.carrot) { const w = toWorld(mySlot(), 0, 0); target = new THREE.Vector3(w.x, 0.8, w.z); text = `Pick the ${CROP.carrot.name} seed, click the soil`; }
  else { const s = STALLS.find((x) => x.id === 'seeds'); target = new THREE.Vector3(s.x, 3.2, s.z); text = 'Buy seeds from Mo the Mihao'; }
  $('pointerText').textContent = text;
  const v = target.project(world.camera);
  el.hidden = v.z > 1;
  el.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
  el.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
}

// ---------------------------------------------------------------------------------------------
// Touch controls (joystick + E / jump buttons)

function setupTouch() {
  const joy = $('joystick'), knob = joy.querySelector('.knob');
  joy.hidden = false;
  $('touchbtns').hidden = false;
  let id = null;
  joy.addEventListener('pointerdown', (e) => { id = e.pointerId; joy.setPointerCapture(id); });
  joy.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    const r = joy.getBoundingClientRect();
    let x = (e.clientX - r.left - r.width / 2) / (r.width / 2), y = (e.clientY - r.top - r.height / 2) / (r.height / 2);
    const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    knob.style.transform = `translate(${x * 35}px, ${y * 35}px)`;
    player.joy = { x, z: y };
  });
  const end = () => { id = null; knob.style.transform = ''; player.joy = { x: 0, z: 0 }; };
  joy.addEventListener('pointerup', end);
  joy.addEventListener('pointercancel', end);
  $('touchE').addEventListener('click', interactNearest);
  $('touchJump').addEventListener('click', () => player.jump());
}

void TIERS; void VENDORS; void pityEligible; void PLOT_SLOTS;
