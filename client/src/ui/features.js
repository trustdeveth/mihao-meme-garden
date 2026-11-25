// Panels for pets, home & decor, album, collections, village board, season, festival, challenge,
// Sky Island, rebirth, avatar, friends and postcards.
import { CROP, CROPS } from '@mg/shared/data/crops';
import { GADGETS } from '@mg/shared/data/tables';
import {
  PETS, EGGS, PET_LIMITS, PET_TRAINING, HOMES, DECOR, repNeeded, SEASON_TIERS, SEASON_TIER_XP, seasonReward,
  FESTIVAL_SHOP, ISLAND, TRIALS, TRIAL_GROW, REBIRTH, AVATAR, DEFAULT_AVATAR, WEAR,
} from '@mg/shared/data/features';
import { collectionStatus, seasonInfo, seasonTier, festivalAt, nextFestival, trialOfDay } from '@mg/shared/rules/progress';
import { rebirthReady } from '@mg/shared/rules/estate';
import { petInterval } from '@mg/shared/rules/pets';
import { dayKey } from '@mg/shared/rules/state';
import { icon, esc, short, full, checklist, tick } from './hud.js';

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const rewardText = (r) => [r.coins ? `${short(r.coins)} coins` : '', r.gems ? `${r.gems} gems` : '', r.reputation ? `${r.reputation} rep` : '', ...Object.keys(r.gadgets ?? {}).map((g) => GADGETS[g]?.name ?? g), ...Object.keys(r.decor ?? {}).map((d) => DECOR[d]?.name ?? d), r.title ? `title "${r.title}"` : '', r.coinsStage ? 'coins' : ''].filter(Boolean).join(', ');

export function createFeatures({ store, hud, act, assets, socket, near, inGarden, travel, startPlacing, postcardShot }) {
  const me = () => store.me;
  const F = {};
  const reopen = (fn) => (r) => { if (r?.ok) fn(); return r; };

  // ---- Pets ------------------------------------------------------------------------------------
  F.pets = () => {
    const m = me(), now = store.now();
    const eggs = (m.eggs ?? []).map((e) => {
      const left = e.ready - now;
      return `<div class="row">${icon('egg')}<div class="meta"><b>${esc(EGGS[e.kind].name)}</b><span>${left > 0 ? `Hatching in ${mmss(left)}` : 'Ready to hatch!'}</span></div><button class="btn gold" data-hatch="${e.id}" ${left > 0 ? 'disabled' : ''}>Hatch</button></div>`;
    }).join('') || '<p class="soft">No eggs warming. Penny Paws sells eggs at the Pet Shop on the plaza.</p>';
    const pets = (m.pets ?? []).map((p) => {
      const next = PET_TRAINING[p.level];
      const def = PETS[p.kind];
      return `<div class="row">${icon(def.ability === 'water' ? 'water' : 'paw')}<div class="meta"><b>${esc(p.name)}${p.level ? ` · ${PET_TRAINING[p.level - 1].name}` : ''}</b><span>${def.ability === 'water' ? 'Waters' : 'Harvests'} every ${(petInterval(p) / 1000).toFixed(0)}s · ${next ? `next level: ${tick(p.bond >= next.bond, `bond ${Math.min(p.bond, next.bond)}/${next.bond}`)} ${tick(m.coins >= next.cost, `${short(next.cost)} coins`)}` : `bond ${p.bond} · max level`}${def.ability === 'harvest' ? ` · ${p.mode === 'patient' ? 'Patient: waits for Peak' : 'Speedy'}` : ''}</span></div>
        <button class="btn ${p.equipped ? 'gold' : 'blue'}" data-equip="${p.id}">${p.equipped ? 'Helping' : 'Resting'}</button>
        ${def.ability === 'harvest' ? `<button class="btn blue" data-mode="${p.id}" data-to="${p.mode === 'patient' ? 'speedy' : 'patient'}">${p.mode === 'patient' ? 'Patient' : 'Speedy'}</button>` : ''}
        ${next ? `<button class="btn" data-train="${p.id}" ${p.bond >= next.bond && m.coins >= next.cost ? '' : 'disabled'}>Train</button>` : ''}</div>`;
    }).join('') || '<p class="soft">No pets yet. Hatch an egg!</p>';
    hud.modal(`<h2>${icon('paw', 'i big')}Pets</h2><p class="soft">Up to ${PET_LIMITS.equipped} pets help at once, also while you are away (up to 8 hours).</p><h3>Incubators (${(m.eggs ?? []).length}/${PET_LIMITS.incubators})</h3><div class="list">${eggs}</div><h3>Your pets</h3><div class="list">${pets}</div>`, (c) => {
      c.querySelectorAll('[data-hatch]').forEach((b) => b.addEventListener('click', () => act('hatch', { id: b.dataset.hatch }).then(reopen(F.pets))));
      c.querySelectorAll('[data-equip]').forEach((b) => b.addEventListener('click', () => act('equipPet', { id: b.dataset.equip }).then(reopen(F.pets))));
      c.querySelectorAll('[data-train]').forEach((b) => b.addEventListener('click', () => act('trainPet', { id: b.dataset.train }).then(reopen(F.pets))));
      c.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => act('petMode', { id: b.dataset.mode, mode: b.dataset.to }).then(reopen(F.pets))));
    });
  };

  /** Egg section inside Tess's gadget shop. */
  F.eggShopHtml = () => Object.entries(EGGS).map(([id, e]) => `<div class="row">${icon('egg')}<div class="meta"><b>${esc(e.name)}</b><span>Hatches in ${e.hatch >= 60 ? `${e.hatch / 60} min` : `${e.hatch}s`}: ${e.odds.map(([k, p]) => `${PETS[k].name.split(' ').pop()} ${Math.round(p * 100)}%`).join(', ')}</span></div>${window.__mgOpenMgrd?.priceTag('egg', id) || '<button class="btn" disabled>$MGRD only</button>'}</div>`).join('');

  // ---- Home and decor ----------------------------------------------------------------------------
  F.home = () => {
    const m = me();
    const next = HOMES[m.home ?? 0];
    const cur = m.home ? HOMES[m.home - 1] : null;
    hud.modal(`<h2>${icon('home', 'i big')}Your Home</h2><p>${cur ? `You live in the <b>${cur.name}</b>: +${Math.round(cur.bonus * 100)}% on every sale.` : 'No home yet. A home adds a bonus to every sale, forever.'}${m.rebirths ? ` Rank Stars add +${m.rebirths * 5}%.` : ''}</p>${next ? `<div class="row">${icon('home')}<div class="meta"><b>Next: ${next.name}</b><span>+${Math.round(next.bonus * 100)}% on every sale</span></div><button class="btn gold" id="buyHome" ${m.coins >= next.cost ? '' : 'disabled'}>${icon('coin')}${short(next.cost)}</button></div>${checklist([{ label: 'Garden Coins', have: m.coins, need: next.cost, money: true }, { label: 'Standing in your garden', have: inGarden() ? 1 : 0, need: 1 }])}` : '<p>You built the best home there is!</p>'}`, (c) => c.querySelector('#buyHome')?.addEventListener('click', () => act('buyHome').then(reopen(F.home))));
  };

  F.decorShopHtml = () => Object.entries(DECOR).filter(([, d]) => d.price != null).map(([id, d]) => `<div class="row">${icon('decor')}<div class="meta"><b>${esc(d.name)}</b><span><em class="tag ${d.tier}">${cap(d.tier)}</em>${me().decorInv?.[id] ? `You have ${me().decorInv[id]} to place` : ''}</span></div>${window.__mgOpenMgrd?.priceTag('decor', id) || '<button class="btn" disabled>$MGRD only</button>'}</div>`).join('');

  F.decor = () => {
    const m = me();
    const inv = Object.entries(m.decorInv ?? {}).filter(([, n]) => n > 0);
    const placed = m.decor ?? [];
    hud.modal(`<h2>${icon('decor', 'i big')}Decorations</h2><p class="soft">Buy decorations from Mo at the seed stall. Place them anywhere in your fence, off the soil. Press R to rotate while placing.</p><h3>To place</h3><div class="list">${inv.map(([id, n]) => `<div class="row">${icon('decor')}<div class="meta"><b>${esc(DECOR[id].name)}</b><span>x${n}</span></div><button class="btn" data-place="${id}">Place</button></div>`).join('') || '<p class="soft">Nothing to place.</p>'}</div><h3>In your garden (${placed.length}/40)</h3><div class="list">${placed.map((d) => `<div class="row">${icon('decor')}<div class="meta"><b>${esc(DECOR[d.kind]?.name ?? d.kind)}</b></div><button class="btn blue" data-move="${d.id}" data-kind="${d.kind}">Move</button><button class="btn red" data-store="${d.id}">Pack away</button></div>`).join('') || '<p class="soft">No decorations yet.</p>'}</div>`, (c) => {
      c.querySelectorAll('[data-place]').forEach((b) => b.addEventListener('click', () => { hud.modal(null); startPlacing({ kind: b.dataset.place }); }));
      c.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => { hud.modal(null); startPlacing({ kind: b.dataset.kind, moveId: b.dataset.move }); }));
      c.querySelectorAll('[data-store]').forEach((b) => b.addEventListener('click', () => act('storeDecor', { id: b.dataset.store }).then(reopen(F.decor))));
    });
  };

  // ---- Album and collections ------------------------------------------------------------------------
  F.album = (tab = 'album') => {
    const m = me();
    const album = m.album ?? {};
    const byCrop = {};
    for (const k of Object.keys(album)) { const [crop] = k.split('|'); byCrop[crop] = (byCrop[crop] ?? 0) + 1; }
    const total = Object.keys(album).length;
    const cols = collectionStatus(m);
    const body = tab === 'album'
      ? `<p>${total} sticker${total === 1 ? '' : 's'} collected. Every crop, variant, weather mark and BIG size is a different sticker.</p><div class="stickers">${CROPS.map((c) => `<div class="sticker ${byCrop[c.id] ? '' : 'empty'}"><i class="crop" style="${byCrop[c.id] ? assets.cropIconStyle(c.id, 48) : ''}"></i><b>${byCrop[c.id] ? esc(c.name) : '?'}</b><span>${byCrop[c.id] ?? 0}</span></div>`).join('')}</div>`
      : `<div class="list">${cols.map((c) => `<div class="row ${c.claimed ? 'claimed' : c.progress >= 1 ? 'ready' : ''}"><span class="box big">${c.progress >= 1 ? icon('check') : ''}</span><div class="meta"><b>${esc(c.name)}</b><span>${c.claimed ? 'Earned' : c.progress >= 1 ? 'Done! Claim it' : `${Math.floor(c.progress * 100)}% done`} · ${c.gems} gems${c.title ? ` · title "${c.title}"` : ''}</span><div class="pbar"><i style="width:${Math.round(c.progress * 100)}%"></i></div></div><button class="btn gold" data-claim="${c.id}" ${!c.claimed && c.progress >= 1 ? '' : 'disabled'}>${c.claimed ? 'Done' : 'Claim'}</button></div>`).join('')}</div><h3>Title</h3><p>${['', ...(m.titles ?? [])].map((t) => `<button class="btn ${m.title === t ? 'gold' : 'blue'}" data-title="${esc(t)}">${t ? esc(t) : 'No title'}</button>`).join(' ')}</p>`;
    hud.modal(`<h2>${icon('album', 'i big')}Album</h2><div class="tabsmall"><button data-tab="album" class="${tab === 'album' ? 'on' : ''}">Stickers</button><button data-tab="badges" class="${tab === 'badges' ? 'on' : ''}">Badges &amp; titles</button></div>${body}`, (c) => {
      c.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => F.album(b.dataset.tab)));
      c.querySelectorAll('[data-claim]').forEach((b) => b.addEventListener('click', () => act('claimCollection', { id: b.dataset.claim }).then(() => F.album('badges'))));
      c.querySelectorAll('[data-title]').forEach((b) => b.addEventListener('click', () => act('setTitle', { title: b.dataset.title }).then(() => F.album('badges'))));
    });
  };

  // ---- Village board: orders, contract, reputation --------------------------------------------------
  F.board = () => {
    const m = me(), now = store.now();
    const atBoard = near('board');
    const rep = m.rep ?? { level: 0, points: 0 };
    const orders = (m.orders ?? []).map((o) => {
      const have = m.basket.filter((i) => i.crop === o.crop && !i.star && (!o.special || (o.special.env ? i.env.length > 0 : i.variant !== 'normal'))).length;
      return `<div class="row"><i class="crop" style="${assets.cropIconStyle(o.crop, 52)}"></i><div class="meta"><b>${esc(o.villager)}: ${o.count} ${esc(CROP[o.crop].name)}${o.special ? (o.special.env ? ' with a weather mark' : ', Silver or better') : ''}</b><span>${tick(have >= o.count, `${Math.min(have, o.count)} / ${o.count} in your basket`)} · ${rewardText(o.reward)} · ${mmss(o.until - now)} left</span></div><button class="btn gold" data-order="${o.id}" ${atBoard && have >= o.count ? '' : 'disabled'}>Deliver</button></div>`;
    }).join('');
    const c = m.contract;
    const contract = c ? `<div class="row">${icon('board')}<div class="meta"><b>${esc(c.name)}${c.done ? ' (complete!)' : ''}</b><span>${c.parts.map((p) => tick(p.have >= p.need, `${CROP[p.crop].name} ${p.have}/${p.need}`)).join(' ')}</span><span>Reward: ${rewardText(c.reward)}</span></div><button class="btn gold" id="contract" ${atBoard && !c.done ? '' : 'disabled'}>Deliver</button></div>` : '';
    hud.modal(`<h2>${icon('board', 'i big')}Village Board</h2><p><b>Reputation level ${rep.level}</b> · ${rep.points}/${repNeeded(rep.level)} to the next level</p><div class="pbar"><i style="width:${Math.round((rep.points / repNeeded(rep.level)) * 100)}%"></i></div>${atBoard ? '' : '<p class="soft">Walk to the notice board on the plaza to deliver. <button class="btn blue" id="goBoard">Go there</button></p>'}<h3>Villager orders</h3><div class="list">${orders}</div><h3>This week's contract</h3><div class="list">${contract}</div>`, (el) => {
      el.querySelectorAll('[data-order]').forEach((b) => b.addEventListener('click', () => act('deliverOrder', { id: b.dataset.order }).then(() => F.board())));
      el.querySelector('#contract')?.addEventListener('click', () => act('deliverContract').then(() => F.board()));
      el.querySelector('#goBoard')?.addEventListener('click', () => { hud.modal(null); travel('board'); });
    });
  };

  // ---- Season pass ------------------------------------------------------------------------------
  F.season = () => {
    const m = me(), now = store.now();
    const info = seasonInfo(now);
    const tier = seasonTier(m);
    const claimed = m.season?.id === info.id ? m.season.claimed : [];
    const rows = Array.from({ length: SEASON_TIERS }, (_, i) => i + 1).map((t) => `<div class="row">${icon(t % 5 === 0 ? 'medal' : 'season')}<div class="meta"><b>Tier ${t}</b><span>${rewardText(seasonReward(t))}</span></div><button class="btn gold" data-tier="${t}" ${t <= tier && !claimed.includes(t) ? '' : 'disabled'}>${claimed.includes(t) ? 'Done' : t <= tier ? 'Claim' : 'Locked'}</button></div>`).join('');
    const xp = m.season?.id === info.id ? m.season.xp : 0;
    hud.modal(`<h2>${icon('season', 'i big')}Season: ${esc(info.name)}</h2><p>Tier ${tier}/${SEASON_TIERS} · ${xp % SEASON_TIER_XP}/${SEASON_TIER_XP} XP to the next tier · ends in ${mmss(info.ends - now)}</p><p class="soft">Earn season XP by harvesting. All rewards are free.</p><div class="list">${rows}</div>`, (c) => c.querySelectorAll('[data-tier]').forEach((b) => b.addEventListener('click', () => act('claimSeason', { tier: Number(b.dataset.tier) }).then(() => F.season()))));
  };

  // ---- Festival -----------------------------------------------------------------------------------
  F.festival = () => {
    const now = store.now();
    const f = festivalAt(now);
    if (!f) { const n = nextFestival(now); return hud.modal(`<h2>${icon('festival', 'i big')}Festivals</h2><p>Every weekend (Friday to Sunday, UTC) the whole village celebrates a festival with special weather, a festive crop mutation and a ticket shop.</p>${n ? `<p>Next: <b>${esc(n.fest.name)}</b> in ${mmss(n.at - now)}.</p>` : ''}`); }
    const m = me();
    const tickets = m.festival?.id === f.key ? m.festival.tickets : 0;
    const names = { festivalflag: 'Festival Bunting (decor)', cap_gold: 'Golden Festival Cap (special)', plaid_pink: 'Party Pink Shirt', growJuice: 'Grow Juice', mysteryBox: 'Mystery Seed Box' };
    hud.modal(`<h2>${icon('festival', 'i big')}${esc(f.name)}</h2><p>Ends in ${mmss(f.ends - now)}. Every harvest gives a ticket and may get the festive <b>${cap(f.env)}</b> mutation (+3 value). Tickets expire when the festival ends.</p><p><b>${tickets}</b> ${icon('ticket')} tickets</p><div class="list">${Object.entries(FESTIVAL_SHOP).map(([id, it]) => `<div class="row">${icon(it.kind === 'decor' ? 'decor' : it.kind === 'wear' ? 'user' : id)}<div class="meta"><b>${names[id]}</b></div><button class="btn gold" data-fbuy="${id}" ${tickets >= it.price ? '' : 'disabled'}>${icon('ticket')}${it.price}</button></div>`).join('')}</div>`, (c) => c.querySelectorAll('[data-fbuy]').forEach((b) => b.addEventListener('click', () => act('festivalBuy', { id: b.dataset.fbuy }).then(() => F.festival()))));
  };

  // ---- Daily challenge -------------------------------------------------------------------------------
  let trialTimer = 0;
  F.challenge = () => {
    clearInterval(trialTimer);
    const m = me(), now = store.now();
    const def = trialOfDay(now);
    const t = m.trial?.day === dayKey(now) && m.trial.id === def.id ? m.trial : null;
    const wonToday = m.trialWon === dayKey(now);
    const goal = def.goal.harvest ? `Harvest ${def.goal.harvest} crops` : def.goal.species ? 'Harvest all three kinds' : `Reach ${def.goal.coins} trial coins (buy carrot seeds at ${def.buy}, sell at ${def.sell})`;
    const active = t && !t.done && now < t.until;
    const beds = active ? t.beds.map((b, i) => {
      const ready = b && now >= b.ready;
      const seeds = Object.entries(t.seeds).filter(([, n]) => n > 0);
      return `<div class="bed ${ready ? 'ripe' : b ? 'grow' : ''}"><b>Bed ${i + 1}</b>${b ? `<i class="crop" style="${assets.cropIconStyle(b.crop, 44)}"></i><span>${ready ? 'Ready!' : `${Math.ceil((b.ready - now) / 1000)}s`}</span><button class="btn gold" data-th="${i}" ${ready ? '' : 'disabled'}>Harvest</button>` : seeds.map(([c, n]) => `<button class="btn" data-tp="${i}" data-crop="${c}">Plant ${esc(CROP[c].name)} (${n})</button>`).join('') || '<span>Empty</span>'}</div>`;
    }).join('') : '';
    hud.modal(`<h2>${icon('medal', 'i big')}Daily Challenge</h2><p><b>${esc(def.name)}</b>: ${goal} in ${def.secs} s. Everyone gets the same tools, so only skill counts.</p><p class="soft">Medals: ${m.medals ?? 0} · best ${m.trialBest?.[def.id] ? `${m.trialBest[def.id]} s` : '-'} · first win each day pays ${10} gems and 30 reputation${wonToday ? ' (won today!)' : ''}</p>${active ? `<p><b>${mmss(t.until - now)}</b> left${def.id === 'market' ? ` · ${t.coins} trial coins <button class="btn blue" id="tbuy" ${t.coins >= def.buy ? '' : 'disabled'}>Buy carrot seed (${def.buy})</button>` : ` · harvested ${def.goal.species ? t.species.length : t.harvested}`}</p><div class="beds">${beds}</div>` : `<p>${t?.done ? (t.harvested >= (def.goal.harvest ?? 99) || t.species.length >= (def.goal.species ?? 99) || t.coins >= (def.goal.coins ?? 1e9) ? 'You did it!' : 'Time is up. Try again!') : ''}</p><p><button class="btn gold" id="tstart">${icon('medal')}Start</button></p>`}`, (c) => {
      c.querySelector('#tstart')?.addEventListener('click', () => act('trialStart').then(() => F.challenge()));
      c.querySelector('#tbuy')?.addEventListener('click', () => act('trialAct', { a: 'buy' }, { quiet: true }).then(() => F.challenge()));
      c.querySelectorAll('[data-tp]').forEach((b) => b.addEventListener('click', () => act('trialAct', { a: 'plant', bed: Number(b.dataset.tp), crop: b.dataset.crop }, { quiet: true }).then(() => F.challenge())));
      c.querySelectorAll('[data-th]').forEach((b) => b.addEventListener('click', () => act('trialAct', { a: 'harvest', bed: Number(b.dataset.th) }, { quiet: true }).then((r) => { if (r.x?.won || r.msg) hud.toast(r.msg || 'Harvested!', 'gold'); F.challenge(); })));
      if (active) trialTimer = setInterval(() => { if (!hud.modalOpen) { clearInterval(trialTimer); return; } F.challenge(); }, 1000);
    });
  };

  // ---- Sky Island ---------------------------------------------------------------------------------
  F.balloon = () => {
    const m = me();
    const unlocked = m.island?.unlocked;
    hud.dialogue('Captain Puff', unlocked ? 'All aboard for Sky Island! Mind the clouds.' : `My balloon has a hole! Bring me ${ISLAND.unlock.pumpkin} ${CROP.pumpkin.name} and ${ISLAND.unlock.bamboo} ${CROP.bamboo.name} and I will fly you to Sky Island.`, [
      unlocked ? { text: 'Fly to Sky Island!', act: () => { hud.dialogue(null); travel('island'); } } : { text: 'What do you need?', act: () => { hud.dialogue(null); F.balloonFix(); } },
      { text: 'What is up there?', act: () => hud.toast('Ten hidden Sky Acorns every day, and an owl who trades them for rare seeds and gadgets.', 'info', 5000) },
      { text: 'Bye!', act: () => hud.dialogue(null) },
    ]);
  };
  F.balloonFix = () => {
    const m = me();
    const have = (crop) => m.basket.filter((i) => i.crop === crop && !i.star).length;
    const items = Object.entries(ISLAND.unlock).map(([crop, n]) => ({ label: `${CROP[crop].name} in your basket`, have: have(crop), need: n }));
    const ok = items.every((i) => i.have >= i.need);
    hud.modal(`<h2>${icon('balloon', 'i big')}Fix the Balloon</h2><p>Captain Puff patches the balloon with crops. Bring them in your basket (starred crops are not used).</p>${checklist(items)}<p><button class="btn gold" id="fix" ${ok && near('balloon') ? '' : 'disabled'}>${icon('balloon')}Give the crops</button>${near('balloon') ? '' : ' <span class="soft">Stand next to the balloon.</span>'}</p>`, (c) => c.querySelector('#fix')?.addEventListener('click', () => act('unlockIsland').then((r) => { if (r.ok) hud.modal(null); else F.balloonFix(); })));
  };
  F.islandShop = () => {
    const m = me();
    const names = { growJuice: 'Grow Juice', mysteryBox: 'Mystery Seed Box', capyHorn: 'Capybara Horn', rocketSprinkler: 'Rocket Sprinkler', seed_kiwi: `${CROP.kiwi.name} seed`, seed_cherryblossom: `${CROP.cherryblossom.name} seed` };
    hud.modal(`<h2>${icon('acorn', 'i big')}Owl's Acorn Shop</h2><p>You have <b>${m.island?.acorns ?? 0}</b> Sky Acorns (${(m.island?.day === dayKey(store.now()) ? m.island.picked.length : 0)}/${ISLAND.acornsPerDay} found today).</p><div class="list">${Object.entries(ISLAND.shop).map(([id, p]) => `<div class="row">${id.startsWith('seed_') ? `<i class="crop" style="${assets.cropIconStyle(id.slice(5), 48)}"></i>` : icon(id)}<div class="meta"><b>${names[id]}</b></div><button class="btn gold" data-ab="${id}" ${(m.island?.acorns ?? 0) >= p ? '' : 'disabled'}>${icon('acorn')}${p}</button></div>`).join('')}</div><p><button class="btn blue" id="home">Fly home</button></p>`, (c) => {
      c.querySelectorAll('[data-ab]').forEach((b) => b.addEventListener('click', () => act('acornShop', { id: b.dataset.ab }).then(() => F.islandShop())));
      c.querySelector('#home').addEventListener('click', () => { hud.modal(null); travel('garden'); });
    });
  };

  // ---- Promotion --------------------------------------------------------------------------------------
  F.rebirth = () => {
    const m = me();
    const ready = rebirthReady(m);
    hud.modal(`<h2>${icon('rebirth', 'i big')}Promotion</h2><p>Start your garden over with a higher rank. You keep your pets, decorations, album, badges, titles, reputation and avatar. Coins, seeds, plants, soil and home reset. Each promotion gives a permanent <b>Rank Star</b>: +${REBIRTH.bonusPerStar * 100}% on every sale (up to ${REBIRTH.maxStars} stars).</p><p>Stars: <b>${m.rebirths ?? 0}</b> of ${REBIRTH.maxStars}.</p>${checklist([{ label: 'Soil at full size', have: m.soil, need: REBIRTH.soil }, { label: `Home: ${HOMES[REBIRTH.home - 1].name} or better`, have: m.home ?? 0, need: REBIRTH.home }])}${(m.rebirths ?? 0) >= REBIRTH.maxStars ? '<p>You hold the highest rank there is!</p>' : ''}<p><button class="btn red" id="rb" ${ready ? '' : 'disabled'}>${icon('rebirth')}Get promoted</button></p>`, (c) => c.querySelector('#rb')?.addEventListener('click', () => { if (confirm('Really start over? This cannot be undone.')) act('rebirth').then(() => hud.modal(null)); }));
  };

  // ---- Avatar and wardrobe ---------------------------------------------------------------------------
  const WEAR_TABS = [['hat', 'Hats'], ['shirt', 'Tops'], ['pants', 'Bottoms'], ['shoes', 'Shoes']];
  // one atlas holds a picture of every item worn by the cat
  let wearAtlas = null;
  const wearAtlasReady = fetch('/icons/wear.json').then((r) => r.json()).then((j) => { wearAtlas = j; }).catch(() => {});
  const picture = (key, fallback = '') => {
    const at = wearAtlas?.at[key];
    if (!at) return `<i class="wsw" style="background:${fallback || '#E9D6B8'}"></i>`;
    const [x, y] = at;
    return `<i class="wpic" style="background-size:${wearAtlas.cols * 100}% ${wearAtlas.rows * 100}%;background-position:${(x / (wearAtlas.cols - 1)) * 100}% ${(y / Math.max(1, wearAtlas.rows - 1)) * 100}%"></i>`;
  };
  const FUR_NAMES = { '#f4efe6': 'Snow', '#ecd3a6': 'Cream', '#e0701f': 'Deep Orange', '#a0612e': 'Cinnamon', '#5a3a26': 'Chocolate', '#9a9ca6': 'Grey', '#2c2a2e': 'Tuxedo', '#f2a8c0': 'Bubblegum', '#86b2e8': 'Sky Blue', '#c3a0ee': 'Lilac', '#8fd6a0': 'Mint', '#f2c94c': 'Golden' };
  const swatchBg = (w) => (w.finish === 'rainbow' ? 'linear-gradient(135deg,#ff5a5a,#ffc233,#5ad06a,#5fb8ff,#b07aff)'
    : w.finish === 'galaxy' ? 'radial-gradient(circle at 30% 30%,#b9a8ff,#3a2a8a 60%,#120a3a)'
      : w.finish === 'gold' ? 'linear-gradient(135deg,#fff3b0,#ffcf40 45%,#c8901a)'
        : w.finish === 'glow' ? `radial-gradient(circle,#ffffff,${w.color})` : w.color ?? 'linear-gradient(135deg,#d93a3a 50%,#2a3a8a 50%)');
  F.avatar = (tab = 'look') => {
    const m = me();
    const a = { ...DEFAULT_AVATAR, ...(m.avatar ?? {}) };
    const owned = (id) => WEAR[id].price === 0 || (m.wardrobe ?? []).includes(id);
    const tabs = `<div class="tabsmall">${[['look', 'Fur'], ['beard', 'Mustache'], ...WEAR_TABS].map(([id, l]) => `<button data-tab="${id}" class="${tab === id ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const worn = `<span class="worn">${icon('check')}Wearing</span>`;
    let body;
    if (tab === 'look') {
      const fur = AVATAR.fur.map((c) => `<div class="wearcard ${a.skin === c ? 'on' : ''}">${picture(`fur:${c ?? 'original'}`, c)}<b>${c ? FUR_NAMES[c] ?? 'Fur' : 'Original Ginger'}</b>${a.skin === c ? worn : `<button class="btn blue" data-part="skin" data-c="${c ?? ''}">Wear</button>`}</div>`).join('');
      body = `<h3>Fur colour</h3><div class="wear">${fur}</div><p>Height <input type="range" id="height" min="0.9" max="1.1" step="0.02" value="${a.height ?? 1}"></p>`;
    } else if (tab === 'beard') {
      const styles = AVATAR.beards.map((b) => `<div class="wearcard ${a.beard === b.id ? 'on' : ''}">${picture(`beard:${b.id}`)}<b>${b.name}</b>${a.beard === b.id ? worn : `<button class="btn blue" data-beard="${b.id}">Wear</button>`}</div>`).join('');
      const sw = (list, prem) => `<div class="swatches">${[...list, ...Object.keys(prem)].map((c) => {
        const locked = prem[c] && !(m.unlockedColors ?? []).includes(c);
        return `<button class="swatch ${a.hair === c ? 'on' : ''}" data-part="hair" data-c="${c ?? ''}" style="background:${c ?? '#F7F3EA'}" title="${c ? (locked ? `${prem[c]} gems` : '') : 'Mihao white'}">${locked ? icon('gem') : c ? '' : '<b class="orig">A</b>'}</button>`;
      }).join('')}</div>`;
      body = `<h3>Style</h3><div class="wear">${styles}</div><h3>Colour</h3>${sw(AVATAR.hair, AVATAR.premiumHair)}${Object.keys(AVATAR.premiumHair).filter((h) => !(m.unlockedColors ?? []).includes(h)).map((h) => { const tag = window.__mgOpenMgrd?.priceTag('hair', h) ?? ''; return tag ? `<span class="hairbuy"><i style="background:${h}"></i>${tag}</span>` : ''; }).join('')}`;
    } else {
      const items = Object.entries(WEAR).filter(([, w]) => w.slot === tab).sort((x, y) => (x[1].special ? 1 : 0) - (y[1].special ? 1 : 0) || (x[1].gems ? x[1].gems * 1000 : x[1].price ?? 1e12) - (y[1].gems ? y[1].gems * 1000 : y[1].price ?? 1e12));
      body = `<div class="wear">${items.map(([id, w]) => {
        const have = owned(id), on = a[tab] === id;
        const cost = w.mgrd ? `${icon('mgrd')}$MGRD shop` : w.gems ? `${icon('gem')}${w.gems}` : w.price == null ? `${icon('ticket')}Festival` : `${icon('coin')}${short(w.price)}`;
        const can = w.mgrd ? true : w.gems ? m.gems >= w.gems : w.price != null && m.coins >= w.price;
        return `<div class="wearcard ${on ? 'on' : ''} ${w.special ? 'special' : ''}">${picture(id, swatchBg(w))}<b>${esc(w.name)}</b>${w.special ? '<em class="tag mythical">Special</em>' : ''}
          ${on ? `<span class="worn">${icon('check')}Wearing</span>` : have ? `<button class="btn blue" data-wear="${id}">Wear</button>` : `<button class="btn gold" data-buy="${id}" ${can ? '' : 'disabled'}>${cost}</button>${w.gems ? window.__mgOpenMgrd?.priceTag('wear', id) ?? '' : ''}`}</div>`;
      }).join('')}</div>`;
    }
    hud.modal(`<h2>${icon('user', 'i big')}Your Farmer</h2><p class="soft">Close this window to see your farmer. Specials shine, sparkle or glow.</p>${tabs}${body}`, (c) => {
      c.querySelectorAll('[data-tab]').forEach((x) => x.addEventListener('click', () => F.avatar(x.dataset.tab)));
      c.querySelectorAll('[data-part]').forEach((x) => x.addEventListener('click', () => act('setAvatar', { [x.dataset.part]: x.dataset.c || null }, { quiet: true }).then(() => F.avatar(tab))));
      c.querySelectorAll('[data-beard]').forEach((x) => x.addEventListener('click', () => act('setAvatar', { beard: x.dataset.beard }, { quiet: true }).then(() => F.avatar(tab))));
      c.querySelectorAll('[data-wear]').forEach((x) => x.addEventListener('click', () => act('setAvatar', { [tab]: x.dataset.wear }, { quiet: true }).then(() => F.avatar(tab))));
      c.querySelectorAll('[data-buy]').forEach((x) => x.addEventListener('click', () => (WEAR[x.dataset.buy].mgrd ? window.__mgOpenMgrd?.('shop') : act('buyWear', { id: x.dataset.buy }).then(() => F.avatar(tab)))));
      c.querySelector('#height')?.addEventListener('change', (e) => act('setAvatar', { height: Number(e.target.value) }, { quiet: true }));
      window.__mgOpenMgrd?.bindTags(c, () => F.avatar(tab));
    });
    if (!wearAtlas) wearAtlasReady.then(() => { if (wearAtlas && document.querySelector('#modal:not([hidden]) .wear')) F.avatar(tab); });
  };

  // ---- Friends --------------------------------------------------------------------------------------
  F.friends = async () => {
    let data;
    try { data = await (await fetch('/api/friends', { credentials: 'same-origin' })).json(); } catch { return hud.toast('Could not load friends.', 'bad'); }
    hud.modal(`<h2>${icon('friends', 'i big')}Friends</h2><p>Your friend code: <b style="font-size:24px;letter-spacing:2px">${esc(data.code)}</b></p><p><input id="fcode" placeholder="Friend's code" maxlength="8" style="font:700 18px var(--font);padding:6px 10px;border:3px solid var(--bark);border-radius:10px;width:160px"> <button class="btn" id="fadd">Add friend</button></p><div class="list">${data.friends.map((f) => `<div class="row">${icon('user')}<div class="meta"><b>${esc(f.name)}</b><span>${f.online ? (f.sameRoom ? 'In your village' : 'Online') : 'Offline'}</span></div>${f.online && !f.sameRoom ? `<button class="btn" data-join="${f.id}" ${f.roomFull ? 'disabled' : ''}>${f.roomFull ? 'Village full' : 'Join'}</button>` : ''}<button class="btn red" data-rm="${f.id}">Remove</button></div>`).join('') || '<p class="soft">No friends yet. Share your code!</p>'}</div>`, (c) => {
      c.querySelector('#fadd').addEventListener('click', async () => {
        const r = await fetch('/api/friends/add', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: c.querySelector('#fcode').value }) });
        const d = await r.json();
        hud.toast(r.ok ? `${d.name} is now your friend!` : d.error, r.ok ? 'good' : 'bad');
        if (r.ok) F.friends();
      });
      c.querySelectorAll('[data-join]').forEach((b) => b.addEventListener('click', () => { hud.modal(null); socket.join(b.dataset.join); }));
      c.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => { await fetch('/api/friends/remove', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: b.dataset.rm }) }); F.friends(); }));
    });
  };

  // ---- More menu ------------------------------------------------------------------------------------
  F.more = (extra) => {
    const items = [
      ['album', 'Album', F.album], ['board', 'Village Board', F.board], ['season', 'Season', F.season], ['festival', festivalAt(store.now()) ? 'Festival!' : 'Festivals', F.festival],
      ['medal', 'Challenge', F.challenge], ['decor', 'Decor', F.decor], ['home', 'Home', F.home], ['paw', 'Pets', F.pets],
      ['user', 'Avatar', F.avatar], ['friends', 'Friends', F.friends], ['camera', 'Postcard', postcardShot], ['rebirth', 'Promotion', F.rebirth],
      ['camera', 'Mihao Cam', () => window.__mgMeme?.toggleBar(true)], ['like', 'Stamps', () => window.__mgMeme?.stampsPanel()], ['star', 'Meme Challenge', () => window.__mgMeme?.challengePanel()],
      ...extra,
    ];
    hud.modal(`<h2>${icon('more', 'i big')}Menu</h2><div class="menugrid">${items.map(([ic, label], i) => `<button class="menubtn" data-i="${i}">${icon(ic, 'i big')}<span>${label}</span></button>`).join('')}</div>`, (c) => c.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => { hud.modal(null); items[Number(b.dataset.i)][2](); })));
  };

  return F;
}
