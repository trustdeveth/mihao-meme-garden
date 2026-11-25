// The meme layer on screen: the Mihao Cam bar (poses, bubbles, photo, clip, hide interface), automatic moments,
// Beard Battle and Pointing Contest, the Official Inspector, mihao stamps and the weekly challenge.
import * as THREE from 'three';
import { POSES, POSE, LINES, MOMENTS, MOMENT_MS, MOMENT_COOLDOWN_MS, IDLE_MOMENT_MS, BIG_SALE_COUNT, DUEL, MEME_DAY_CAP, CHALLENGE_TAG, INSPECTION } from '@mg/shared/data/memes';
import { hasPose } from '@mg/shared/rules/memes';
import { toWorld, STALLS, PLOT } from '@mg/shared/world/village-layout';
import { Avatar } from '../render/characters.js';
import { icon, esc } from '../ui/hud.js';
import { snapshot, download, ClipRecorder, InstantReplay, CLIP_MAX_MS } from './capture.js';

const BOT = -1;
const WEATHER_MOMENTS = new Set(['rain', 'storm', 'stars', 'night', 'heatwave', 'frosty']);
const STARE_RANGE = 3.2;
const $ = (id) => document.getElementById(id);

const flatMat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
function block(group, w, h, d, color, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), flatMat(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  group.add(m);
  return m;
}
/** Things held for a moment, built from blocks. */
function makeProp(kind) {
  const g = new THREE.Group();
  if (kind === 'umbrella') {
    block(g, 0.05, 1.45, 0.05, '#6A3A1E', -0.5, 1.75, 0.12);
    const top = new THREE.Mesh(new THREE.ConeGeometry(1.0, 0.38, 8), flatMat('#C8202A'));
    top.position.set(-0.28, 2.66, 0.05);
    top.castShadow = true;
    g.add(top);
    block(g, 0.12, 0.12, 0.12, '#E8B53A', -0.28, 2.9, 0.05);
  } else if (kind === 'coins') {
    for (let i = 0; i < 7; i++) block(g, 0.24, 0.025, 0.13, i % 2 ? '#3FB05A' : '#FFD24A', ((i % 3) - 1) * 0.17, 1.02 + i * 0.07, 0.62 + (i % 2) * 0.05).rotation.set(0.3, i, 0.2);
  }
  return g;
}
const disposeProp = (g) => { g.parent?.remove(g); g.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); };

export function createMeme({ store, hud, act, socket, world, chars, player, audio, assets, sky, onMyPlot, travelTo }) {
  const rec = new ClipRecorder(world);
  const replay = new InstantReplay(world, rec);
  // instant replay records all the time while on, which costs power, so it starts switched off
  const replayKey = 'mg-replay';
  let replayWanted = (() => { try { return localStorage.getItem(replayKey) === 'on'; } catch { return false; } })();
  const autoKey = 'mg-auto-moments';
  let auto = (() => { try { return localStorage.getItem(autoKey) !== 'off'; } catch { return true; } })();
  let lastMoment = 0;
  let lastInput = performance.now();
  let idleDone = false;
  let weather = null;
  const stared = new Map(); // slot -> time
  const props = new Map(); // slot -> {obj, until}
  const tags = []; // bubbles that are not attached to a player: {el, at: () => Vector3, up, until}
  let duel = null; // {id, kind, a, b, go}
  let invite = null; // {from, name, kind, until}
  let inspector = null; // {avatar, goal, leaving, tag}
  const labels = () => $('labels');
  const mySlot = () => store.you?.slot;

  // ---- bubbles --------------------------------------------------------------------------------
  function tagAt(at, text, ms, up = 2.6, cls = 'bubble') {
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = text;
    labels().appendChild(el);
    const t = { el, at, up, until: performance.now() + ms };
    tags.push(t);
    chars.place(el, at(), up);
    return t;
  }
  const say = (slot, text) => chars.say(slot, text);
  /** Say one of the fixed lines, and let the village see it. */
  function sayLine(i) {
    say(mySlot(), LINES[i]);
    socket.raw({ t: 'meme', k: 'say', i });
    audio.play('pop');
  }
  function holdProp(slot, kind, ms) {
    const e = chars.avatars.get(slot);
    if (!e) return;
    const old = props.get(slot);
    if (old) disposeProp(old.obj);
    const obj = makeProp(kind);
    e.avatar.root.add(obj);
    props.set(slot, { obj, until: performance.now() + ms });
  }

  // ---- poses ------------------------------------------------------------------------------------
  const standing = () => player.speed < 0.3 && player.pos.y <= 0.001 && !player.target && !(player.vel > 0);
  const faceCamera = () => { player.ry = Math.atan2(world.camera.position.x - player.pos.x, world.camera.position.z - player.pos.z); };
  function strike(id) {
    const p = POSE[id];
    if (!hasPose(store.me, id)) return unlockDialog(id);
    player.setPose(player.pose === p.an ? 0 : p.an);
    refreshBar();
    return undefined;
  }
  function unlockDialog(id) {
    const p = POSE[id], have = store.me.meme?.points ?? 0;
    hud.modal(`<h2>${icon('lock', 'i big')}${esc(p.name)}</h2><p>Unlock this pose for <b>${p.cost} Meme Points</b>. You have <b>${have}</b>.</p><p class="soft">Meme Points come from rare harvests, mihao stamps, passed inspections and contest wins (up to ${MEME_DAY_CAP} a day). They only unlock poses.</p><p><button class="btn gold" id="mmUnlock" ${have >= p.cost ? '' : 'disabled'}>Unlock</button></p>`, (c) => c.querySelector('#mmUnlock').addEventListener('click', () => act('unlockPose', { id }).then((r) => { if (r.ok) { hud.modal(null); player.setPose(p.an); refreshBar(); } })));
  }

  // ---- automatic moments: short, never lock the controls, and can be switched off ----------------------
  function moment(id, { force = false } = {}) {
    const m = MOMENTS[id];
    const now = performance.now();
    if (!m || !auto || (!force && now - lastMoment < MOMENT_COOLDOWN_MS) || hud.modalOpen || duel || !store.me) return false;
    lastMoment = now;
    const an = POSE[m.pose].an;
    if (standing() && !player.pose && hasPose(store.me, m.pose)) {
      if (id !== 'stare') faceCamera();
      player.setPose(an, MOMENT_MS);
    }
    say(mySlot(), LINES[m.line]);
    if (m.prop) holdProp(mySlot(), m.prop, MOMENT_MS);
    socket.raw({ t: 'meme', k: 'moment', id });
    return true;
  }
  const onHarvest = (items) => { if (items.some((i) => i.big || i.variant !== 'normal')) setTimeout(() => moment('rare'), 1_200); };
  const onSale = (count) => { if (count >= BIG_SALE_COUNT) moment('sale'); };

  // ---- photo, clip, selfie, clean view ----------------------------------------------------------
  function photo() {
    const url = snapshot(world).toDataURL('image/png');
    download(url, `mihao-${Date.now()}.png`);
    audio.play('pop');
    hud.toast('Photo saved to your downloads, bubbles included.', 'good');
  }
  const tweetUrl = () => `https://x.com/intent/tweet?text=${encodeURIComponent(`mihao ${CHALLENGE_TAG}`)}`;
  function clipReady(blob, ext) {
    refreshBar();
    if (!blob.size) return hud.toast('The clip came out empty. Try again.', 'bad');
    const url = URL.createObjectURL(blob);
    const name = `mihao-clip-${Date.now()}.${ext}`;
    setClean(false);
    hud.modal(`<h2>${icon('camera', 'i big')}Your clip</h2><video class="clipview" src="${url}" controls loop autoplay muted playsinline></video><p class="soft">No sound. To post it: download, open X, then attach the file.${ext === 'webm' ? ' If X refuses the .webm file, convert it to .mp4 first.' : ''}</p><p class="mmrow"><button class="btn gold" id="mmDl">${icon('check')}Download</button><a class="btn blue" href="${tweetUrl()}" target="_blank" rel="noopener noreferrer">Open X</a></p>`, (c) => c.querySelector('#mmDl').addEventListener('click', () => download(url, name)));
    // free the video once the panel is gone
    const watch = setInterval(() => { if (!document.querySelector(`video[src="${url}"]`) || $('modal').hidden) { clearInterval(watch); setTimeout(() => URL.revokeObjectURL(url), 30_000); } }, 2_000);
    return undefined;
  }
  function toggleRecord() {
    if (rec.active) { rec.stop(); return; }
    if (!rec.supported) { hud.toast('This browser cannot record clips. Use your phone or computer screen recorder.', 'bad', 5000); return; }
    if (!rec.start(clipReady)) { hud.toast('Could not start recording.', 'bad'); return; }
    hud.toast(`Recording up to ${CLIP_MAX_MS / 1000}s. The interface is not in the clip.`, 'info');
    refreshBar();
  }
  function syncReplay() {
    if (replayWanted && !document.hidden && store.me) { if (!replay.active) replay.start(); } else if (replay.active) replay.stop();
    $('replayBtn').hidden = !replay.active;
  }
  function setReplay(on) {
    replayWanted = on && rec.supported;
    if (on && !rec.supported) hud.toast('This browser cannot record clips.', 'bad');
    try { localStorage.setItem(replayKey, replayWanted ? 'on' : 'off'); } catch { /* private window: lasts for this visit */ }
    syncReplay();
    if (replayWanted) hud.toast('Instant replay is on. Press L or Save last moment to keep what just happened.', 'info', 4500);
    refreshBar();
  }
  /** One click: keep the last 7.5 to 15 seconds. */
  function saveMoment() {
    if (!replay.active) { hud.toast('Turn on Instant replay in Mihao Cam first.', 'bad'); return; }
    if (replay.seconds < 1) { hud.toast('Instant replay only just started. Try again in a moment.', 'info'); return; }
    if (replay.save(clipReady)) audio.play('pop');
  }
  document.addEventListener('visibilitychange', syncReplay); // never records a hidden tab
  $('replayBtn').addEventListener('click', (e) => { saveMoment(); e.currentTarget.blur(); });
  /** Pose booth camera: swing round to look mihao in the face. */
  function selfie() {
    const d = 5.2;
    world.camera.position.set(player.pos.x + Math.sin(player.ry) * d, 2.3, player.pos.z + Math.cos(player.ry) * d);
    player.controls.target.set(player.pos.x, 1.35, player.pos.z);
    player.controls.update();
  }
  function setClean(on) {
    document.body.classList.toggle('clean', on);
    $('cleanExit').hidden = !on;
  }

  // ---- duels ----------------------------------------------------------------------------------------
  function nearestPlayer() {
    let best = null;
    for (const [slot, e] of chars.avatars) {
      if (slot === mySlot()) continue;
      const d = e.avatar.root.position.distanceTo(player.pos);
      if (d <= DUEL.range - 0.5 && (!best || d < best.d)) best = { slot, d };
    }
    return best?.slot ?? null;
  }
  function challenge(kind) {
    const near = nearestPlayer();
    if (near != null) { socket.raw({ t: 'meme', k: 'duel', kind, slot: near }); return; }
    const gus = STALLS.find((s) => s.id === 'market');
    if (Math.hypot(gus.x - player.pos.x, gus.z - player.pos.z) <= gus.reach + 2.5) { socket.raw({ t: 'meme', k: 'duel', kind, slot: BOT }); return; }
    hud.modal(`<h2>${icon('medal', 'i big')}${esc(DUEL.kinds[kind])}</h2><p>Stand next to another player and press the button again, or challenge Gus at the Market.</p><p><button class="btn gold" id="mmGus">Take me to Gus</button></p>`, (c) => c.querySelector('#mmGus').addEventListener('click', () => { hud.modal(null); travelTo('market'); }));
  }
  const nameOf = (slot) => (slot === BOT ? 'Gus' : store.members.get(slot)?.name ?? 'Someone');
  const vendorSpot = () => chars.vendors.market?.root.position ?? new THREE.Vector3();
  function speak(slot, text, ms = 4_000) { if (slot === BOT) tagAt(vendorSpot, text, ms); else say(slot, text); }
  function card(html, mount) {
    const el = $('duelcard');
    el.hidden = !html;
    el.innerHTML = html ?? '';
    if (html) mount?.(el);
  }
  const mine = () => duel && (duel.a === mySlot() || duel.b === mySlot());
  function tap() {
    if (!mine() || duel.kind !== 'point' || duel.tapped) return;
    duel.tapped = true;
    player.setPose(POSE.point.an, 2_500);
    socket.raw({ t: 'meme', k: 'tap', duel: duel.id });
  }
  function onDuel(m) {
    if (m.ev === 'invite') {
      invite = m;
      audio.play('rare');
      card(`<b>${esc(m.name)}</b> challenges you: <b>${esc(DUEL.kinds[m.kind])}</b><div class="mmrow"><button class="btn gold" id="duelYes">Accept</button><button class="btn red" id="duelNo">No thanks</button></div>`, (el) => {
        el.querySelector('#duelYes').addEventListener('click', () => { socket.raw({ t: 'meme', k: 'accept' }); invite = null; card(null); });
        el.querySelector('#duelNo').addEventListener('click', () => { socket.raw({ t: 'meme', k: 'decline' }); invite = null; card(null); });
      });
      return;
    }
    if (m.ev === 'start') {
      const involved = m.a === mySlot() || m.b === mySlot();
      if (involved) duel = { id: m.id, kind: m.kind, a: m.a, b: m.b };
      for (const s of [m.a, m.b]) speak(s, m.kind === 'beard' ? 'measuring beard...' : 'get ready...', 2_500);
      if (involved) {
        invite = null;
        if (m.kind === 'point') card(`<b>Pointing Contest</b><span id="duelState">Wait for POINT! Too early and you lose.</span><button class="btn red" id="duelTap">Point (Q)</button>`, (el) => el.querySelector('#duelTap').addEventListener('click', tap));
        else { card('<b>Beard Battle</b><span>Hold still...</span>'); player.setPose(POSE.stance.an, 3_000); }
      }
      return;
    }
    if (m.ev === 'go') {
      if (duel?.id !== m.id) return;
      duel.go = true;
      const s = $('duelState');
      if (s) { s.textContent = 'POINT NOW!'; $('duelTap')?.classList.replace('red', 'gold'); }
      audio.play('levelup');
      return;
    }
    if (m.ev === 'cancel') { if (duel?.id === m.id) { duel = null; card(null); hud.toast('The contest was called off.', 'info'); } return; }
    // result
    if (m.kind === 'beard') { speak(m.a, `my beard: ${m.values[0]} cm`); speak(m.b, `my beard: ${m.values[1]} cm`); }
    else if (m.winner != null) { speak(m.winner, 'mihao!'); }
    if (duel?.id !== m.id) return;
    const won = m.winner === mySlot();
    const loser = m.winner == null ? null : m.winner === m.a ? m.b : m.a;
    const why = m.reason === 'early' ? `${nameOf(loser)} pointed too early.` : m.reason === 'nobody' ? 'Nobody pointed.' : '';
    duel = null;
    card(null);
    hud.toast(m.winner == null ? `A draw. ${why}` : `${won ? 'You win!' : `${nameOf(m.winner)} wins.`} ${why}`, won ? 'gold' : 'info', 4000);
    if (m.winner != null) player.setPose(won ? POSE.stance.an : POSE.shock.an, 3_000);
  }

  // ---- Official Inspector -----------------------------------------------------------------------------
  const inspectionNow = () => { const s = store.me?.meme?.inspection; return s && s.until > store.now() ? s : null; };
  async function spawnInspector(spot) {
    const mine_ = { loading: true };
    inspector = mine_;
    const gltf = await assets.character('goat'); // the deep-blue official
    if (inspector !== mine_) return;
    const avatar = new Avatar(gltf, assets.mats, { scale: 1.05 });
    const from = toWorld(mySlot(), 0, PLOT.d / 2 - 0.5);
    avatar.root.position.set(from.x, 0, from.z);
    world.scene.add(avatar.root);
    inspector = { avatar, goal: toWorld(mySlot(), spot.x, spot.z), leaveAt: 0, tag: null, arrived: false };
    audio.play('rare');
    hud.toast('Official Inspection! Walk up to the inspector and press E.', 'info', 5000);
  }
  let walkedAt = performance.now();
  function updateInspector(dt) {
    // walking uses real time (the game's animation step is capped, which would make them crawl on slow devices)
    const walkDt = Math.min(0.5, (performance.now() - walkedAt) / 1000);
    walkedAt = performance.now();
    const spot = inspectionNow();
    if (spot && !inspector) spawnInspector(spot);
    if (!inspector || inspector.loading) return;
    const I = inspector, root = I.avatar.root, now = performance.now();
    if (!spot && !I.leaveAt) I.leaveAt = now + 3_500; // done or gave up: a last word, then gone
    const dx = I.goal.x - root.position.x, dz = I.goal.z - root.position.z, d = Math.hypot(dx, dz);
    if (d > 0.15) {
      const step = Math.min(d, 2.4 * walkDt);
      root.position.x += (dx / d) * step; root.position.z += (dz / d) * step;
      root.rotation.y = Math.atan2(dx, dz);
      I.avatar.play('walk'); I.avatar.pace(2.4);
    } else {
      root.rotation.y = Math.atan2(player.pos.x - root.position.x, player.pos.z - root.position.z);
      I.avatar.play(I.leaveAt ? 'idle' : 'stance');
      if (!I.arrived) { I.arrived = true; I.tag = tagAt(() => root.position, 'Official Inspection!', INSPECTION.secs * 1000); }
    }
    I.avatar.tick(dt);
    if (I.leaveAt && now > I.leaveAt) { world.scene.remove(root); if (I.tag) I.tag.until = 0; inspector = null; }
  }
  /** For the E key: where the inspector is, once they have arrived (the server checks that spot). */
  const inspectorSpot = () => (inspectionNow() && inspector?.arrived ? inspector.avatar.root.position : null);
  async function showGarden() {
    const r = await act('inspect', {}, { quiet: true });
    if (!r.ok) return;
    const pass = !!r.x?.pass;
    if (inspector?.tag) inspector.tag.until = 0;
    if (inspector?.avatar) tagAt(() => inspector?.avatar?.root.position ?? player.pos, pass ? 'mihao.' : 'very not mihao.', 3_500);
    player.setPose(pass ? POSE.stance.an : POSE.shock.an, MOMENT_MS);
    sayLine(pass ? LINES.indexOf('respect the official') : LINES.indexOf('mihao?'));
    hud.toast(r.msg, pass ? 'gold' : 'bad', 5000);
    audio.play(pass ? 'coin' : 'bad');
  }

  // ---- stamps and the weekly challenge --------------------------------------------------------------
  function stampAt(slot) {
    const sign = toWorld(slot, 0, PLOT.d / 2 + 0.4);
    const at = new THREE.Vector3(sign.x, 0, sign.z);
    tagAt(() => at, 'MIHAO', 3_500, 3.2, 'stamp');
  }
  async function stampsPanel() {
    let d;
    try { const r = await fetch('/api/stamps', { credentials: 'same-origin' }); if (!r.ok) throw new Error(); d = await r.json(); } catch { return hud.toast('Could not load your stamps.', 'bad'); }
    hud.modal(`<h2>${icon('like', 'i big')}Mihao stamps</h2><p>Your garden has <b>${d.total}</b> stamp${d.total === 1 ? '' : 's'}. Visit a friend and press E at their garden sign to leave one.</p><div class="list">${d.list.map((s) => `<div class="row"><span class="seal">MIHAO</span><div class="meta"><b>${esc(s.name)}</b><span>${esc(s.day)}</span></div></div>`).join('') || '<p class="soft">No stamps yet.</p>'}</div>`);
    return undefined;
  }
  async function challengePanel() {
    let d;
    try { d = await (await fetch('/api/challenge')).json(); } catch { return hud.toast('Could not load the challenge.', 'bad'); }
    const days = Math.max(1, Math.ceil((d.ends - store.now()) / 86_400_000));
    const featured = d.featured.map((f) => `<div class="row">${icon('star')}<div class="meta"><b>${esc(f.title)}</b><span>${esc(f.by)}</span></div><a class="btn blue" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">Watch</a></div>`).join('') || '<p class="soft">Nothing featured yet this week.</p>';
    const STATUS = { pending: 'Waiting for a moderator to look at it.', featured: 'Featured this week. mihao!', rejected: 'Not picked. You can send another one.' };
    const entry = `<h3>Your entry</h3>${d.mine ? `<div class="row">${icon(d.mine.status === 'featured' ? 'star' : 'timer')}<div class="meta"><b>${esc(d.mine.title)}</b><span>${STATUS[d.mine.status] ?? ''}</span></div><a class="btn blue" href="${esc(d.mine.url)}" target="_blank" rel="noopener noreferrer">View</a></div>` : ''}${d.mine?.status === 'featured' ? '' : `<form class="mmentry" id="chForm"><input id="chUrl" type="url" required maxlength="200" placeholder="Link to your post on X" aria-label="Link to your post on X"><input id="chTitle" maxlength="80" placeholder="Short title (optional)" aria-label="Short title"><button class="btn gold" type="submit">${d.mine ? 'Replace entry' : 'Send entry'}</button><span class="soft">If it is picked, your link, title and garden name are shown to all players.</span></form>`}`;
    hud.modal(`<h2>${icon('medal', 'i big')}Meme Challenge</h2><h3>${esc(d.title)}</h3><p>${esc(d.how)}</p><p class="soft">Post it on X with <b>${esc(d.tag)}</b>. ${days} day${days === 1 ? '' : 's'} left. Featured posts are picked by hand. There are no coin or token prizes.</p><p class="mmrow"><button class="btn gold" id="chPhoto">${icon('camera')}Mihao Cam</button><a class="btn blue" href="${tweetUrl()}" target="_blank" rel="noopener noreferrer">Open X</a></p>${entry}<h3>Featured this week</h3><div class="list">${featured}</div>`, (c) => {
      c.querySelector('#chPhoto').addEventListener('click', () => { hud.modal(null); toggleBar(true); });
      c.querySelector('#chForm')?.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const button = c.querySelector('#chForm button');
        button.disabled = true;
        try {
          const r = await fetch('/api/challenge/entry', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: c.querySelector('#chUrl').value, title: c.querySelector('#chTitle').value }) });
          const body = await r.json();
          if (!r.ok) { hud.toast(body.error ?? 'Could not send it.', 'bad'); button.disabled = false; return; }
          hud.toast('Entry sent. A moderator will take a look.', 'good');
          challengePanel();
        } catch { hud.toast('Could not reach the server.', 'bad'); button.disabled = false; }
      });
    });
    return undefined;
  }

  // ---- the Mihao Cam bar ------------------------------------------------------------------------
  const bar = $('memebar');
  function refreshBar() {
    if (bar.hidden || !store.me) return;
    const points = store.me.meme?.points ?? 0;
    const poses = POSES.map((p) => {
      const has = hasPose(store.me, p.id);
      return `<button class="mmbtn${player.pose === p.an ? ' on' : ''}${has ? '' : ' locked'}" data-pose="${p.id}">${has ? '' : icon('lock')}${esc(p.name)}${has ? '' : ` <em>${p.cost}</em>`}</button>`;
    }).join('');
    bar.innerHTML = `<div class="mmhead"><b>Mihao Cam</b><span title="Meme Points only unlock poses">Meme Points: <i>${points}</i></span><button class="mmx" data-do="close" aria-label="Close">${icon('close')}</button></div>
      <div class="mmgrid">${poses}</div>
      <div class="mmlines">${LINES.map((l, i) => `<button class="mmline" data-line="${i}">${esc(l)}</button>`).join('')}</div>
      <div class="mmgrid">
        <button class="mmbtn act" data-do="photo">Photo (P)</button>
        <button class="mmbtn act${rec.active ? ' rec' : ''}" data-do="record">${rec.active ? `Stop ${Math.floor(rec.seconds)}s` : 'Record clip'}</button>
        <button class="mmbtn act" data-do="selfie">Pose booth cam</button>
        <button class="mmbtn act" data-do="clean">Hide UI (H)</button>
        <button class="mmbtn" data-do="beard">Beard Battle</button>
        <button class="mmbtn" data-do="pointing">Pointing Contest</button>
        <button class="mmbtn" data-do="stamps">Stamps</button>
        <button class="mmbtn" data-do="challenge">Challenge</button>
      </div>
      <label class="mmauto"><input type="checkbox" id="mmAuto" ${auto ? 'checked' : ''}> Auto moments</label>
      <label class="mmauto" title="Keeps recording the game so you can save what just happened. Uses more power."><input type="checkbox" id="mmReplay" ${replayWanted ? 'checked' : ''}> Instant replay (uses more power)</label>
      ${replay.active ? '<button class="mmbtn act" data-do="moment">Save last moment (L)</button>' : ''}`;
  }
  const DO = { close: () => toggleBar(false), moment: saveMoment, photo, record: toggleRecord, selfie, clean: () => setClean(true), beard: () => challenge('beard'), pointing: () => challenge('point'), stamps: stampsPanel, challenge: challengePanel };
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.pose) strike(b.dataset.pose);
    else if (b.dataset.line) sayLine(Number(b.dataset.line));
    else DO[b.dataset.do]?.();
    b.blur(); // so Space still jumps afterwards
  });
  bar.addEventListener('change', (e) => {
    if (e.target.id === 'mmReplay') { e.target.blur(); setReplay(e.target.checked); return; }
    if (e.target.id !== 'mmAuto') return;
    auto = e.target.checked;
    try { localStorage.setItem(autoKey, auto ? 'on' : 'off'); } catch { /* private window: lasts for this visit */ }
    e.target.blur();
  });
  function toggleBar(on = bar.hidden) { bar.hidden = !on; refreshBar(); }
  $('memeBtn').addEventListener('click', () => toggleBar());
  $('cleanExit').addEventListener('click', () => setClean(false));
  store.on('me', refreshBar);

  const touched = () => { lastInput = performance.now(); idleDone = false; };
  for (const ev of ['keydown', 'pointerdown', 'wheel']) addEventListener(ev, touched, { passive: true });
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.ctrlKey || e.metaKey || e.altKey || e.repeat || !store.me) return;
    if (e.code === 'KeyQ') tap();
    if (hud.modalOpen) return;
    if (e.code === 'KeyG') { setClean(false); toggleBar(); }
    if (e.code === 'KeyH') setClean(!document.body.classList.contains('clean'));
    if (e.code === 'KeyP') photo();
    if (e.code === 'KeyL') saveMoment();
    if (e.key === 'Escape') setClean(false);
  });

  // ---- network ------------------------------------------------------------------------------------------
  socket.on('meme', (m) => {
    if (m.slot === mySlot()) return;
    if (m.k === 'say' && LINES[m.i]) say(m.slot, LINES[m.i]);
    if (m.k === 'moment' && MOMENTS[m.id]) { say(m.slot, LINES[MOMENTS[m.id].line]); if (MOMENTS[m.id].prop) holdProp(m.slot, MOMENTS[m.id].prop, MOMENT_MS); }
  });
  socket.on('duel', onDuel);
  socket.on('like', (m) => stampAt(m.slot));
  socket.on('welcome', () => { duel = null; invite = null; card(null); weather = null; setTimeout(syncReplay, 0); });

  // ---- every frame ------------------------------------------------------------------------------------
  let barAt = 0;
  function update(dt) {
    if (!store.me) return;
    const now = performance.now();
    // weather changes: everyone's game sees the same weather, so the village reacts together
    if (sky.kind && sky.kind !== weather) {
      const first = weather === null;
      weather = sky.kind;
      if (!first && WEATHER_MOMENTS.has(weather)) setTimeout(() => moment(weather), 800 + Math.random() * 900);
    }
    if (!idleDone && now - lastInput > IDLE_MOMENT_MS && !player.pose && !document.hidden) idleDone = moment('idle'); // once per quiet spell
    // two mihao close together stare at each other (at most every few minutes per neighbour)
    if (auto && standing() && !player.pose) {
      for (const [slot, e] of chars.avatars) {
        if (slot === mySlot() || e.avatar.root.position.distanceTo(player.pos) > STARE_RANGE || now - (stared.get(slot) ?? -1e9) < 180_000) continue;
        if (now - lastMoment < MOMENT_COOLDOWN_MS) break;
        stared.set(slot, now);
        player.ry = Math.atan2(e.avatar.root.position.x - player.pos.x, e.avatar.root.position.z - player.pos.z);
        moment('stare');
        break;
      }
    }
    if (invite && store.now() > invite.until) { invite = null; card(null); }
    for (const [slot, p] of props) if (now > p.until || !chars.avatars.has(slot)) { disposeProp(p.obj); props.delete(slot); }
    updateInspector(dt);
    for (let i = tags.length - 1; i >= 0; i--) {
      const t = tags[i];
      if (now > t.until) { t.el.remove(); tags.splice(i, 1); } else chars.place(t.el, t.at(), t.up);
    }
    if (rec.active && now - barAt > 500) { barAt = now; refreshBar(); }
  }

  return { update, afterRender: () => { rec.frame(); replay.frame(); }, saveMoment, replay, moment, onHarvest, onSale, photo, toggleBar, stampsPanel, challengePanel, inspectorSpot, showGarden };
}
