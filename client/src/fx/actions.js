// What each game action looks like when it succeeds or fails. Purely visual: it runs after the server has
// already answered, and nothing here changes coins, items or progress. (Plants, pets, eggs, homes and
// decorations animate in their own renderers, so neighbours' gardens move too.)
import * as THREE from 'three';
import { PALETTE } from './world-fx.js';
import { origin, flyTo, confetti, banner, pop, shake } from './ui-fx.js';

const icon = (id) => `<svg class="i"><use href="/icons/sprite.svg#${id}"/></svg>`;
const MIHAO = ['mihao', 'MIHAO!', 'mihao.'];
const say = () => MIHAO[(Math.random() * MIHAO.length) | 0];

export function createActionFx({ store, chars, fx, assets, player }) {
  const me = () => chars.avatars.get(store.you?.slot)?.avatar;
  const at = (up = 1.2) => new THREE.Vector3(player.pos.x, up, player.pos.z);

  /** Sparkles around my own cat, with a little hop. */
  function cheer(strength = 1, word = null) {
    me()?.cheer(strength);
    fx.ring(at(0), { radius: 1.4 * strength });
    fx.burst(at(1.3), { n: Math.round(16 * strength), colors: PALETTE.party, up: 3.2, speed: 2 });
    fx.float('star', at(2), { n: 3 });
    if (word) fx.float(word, at(2.5), { size: 0.7, rise: 0.8, spread: 0.1 });
  }
  /** A bought thing leaps from the button into the place it is kept. */
  function bought(stall, html, target, n = 1) {
    // let the hotbar redraw first, so a new item has somewhere to land
    requestAnimationFrame(() => flyTo(origin(), document.querySelector(target) ?? document.querySelector('#hotbar'), html, { n }));
    chars.vendorCheer(stall);
  }
  function big(title, sub, strength = 1.6) {
    banner(title, sub);
    confetti(innerWidth / 2, innerHeight * 0.34, 90);
    fx.beam(at(0));
    cheer(strength);
  }
  const reward = (word) => { const o = origin(); confetti(o.x, o.y, 36); cheer(1, word); };

  const done = {
    plant: () => fx.float('mihao', at(2.3), { size: 0.6, rise: 0.7, spread: 0.1 }),
    water: () => fx.float('drop', at(2.1), { n: 4 }),
    harvest: () => { me()?.cheer(0.6); },
    move: () => me()?.cheer(0.4),
    remove: () => fx.float(say(), at(2.3), { size: 0.55 }),
    useGadget: () => cheer(0.8),
    growAll: () => { big('Grow All!', 'Look at them go. mihao.', 1.2); },
    expandSoil: () => big('More soil!', 'The garden grows.'),
    buySeed: (p) => bought('seeds', `<div class="crop" style="${assets.cropIconStyle(p.id, 48)}"></div>`, `#hotbar [data-id="seed:${p.id}"]`, 3),
    buyGadget: (p) => bought('gadgets', icon('shop'), `#hotbar [data-id="gadget:${p.id}"]`, 2),
    buyDecor: () => bought('seeds', icon('decor'), '[data-panel="more"]', 2),
    buyEgg: () => bought('pets', icon('egg'), '[data-panel="more"]', 1),
    sell: (p, r) => {
      chars.vendorCheer('market');
      const count = r.x?.count ?? 1;
      fx.float('coin', at(1.9), { n: Math.min(14, 3 + count), rise: 1.6, spread: 1.1, delay: 0.05 });
      fx.burst(at(1.4), { n: 24, colors: PALETTE.gold, up: 3.6, speed: 2.2 });
      me()?.cheer(1);
      if (count >= 10) { banner('Sold!', `${count} crops to Gus. mihao.`); confetti(innerWidth / 2, innerHeight * 0.34, 50); }
    },
    pity: () => reward('mihao'),
    star: () => { const o = origin(); confetti(o.x, o.y, 12); },
    claimQuest: () => reward('MIHAO!'),
    claimGift: () => big('Daily gift!', 'Very mihao of you.', 1.2),
    claimCollection: () => big('Collection!', 'Reward claimed.', 1.2),
    claimSeason: () => reward('MIHAO!'),
    deliverOrder: () => reward('delivered'),
    deliverContract: () => big('Delivered!', 'Contract complete.', 1.2),
    festivalBuy: () => reward('mihao'),
    acornShop: () => reward('mihao'),
    pickAcorn: () => { fx.burst(at(0.6), { n: 14, colors: PALETTE.gold }); fx.float('star', at(1.6), { n: 2 }); flyTo({ x: innerWidth / 2, y: innerHeight * 0.55 }, '[data-panel="more"]', icon('acorn')); me()?.cheer(0.5); },
    surprise: () => { reward('mihao!'); fx.float('heart', at(1.9), { n: 5, spread: 0.9 }); },
    hatch: (p, r) => { banner('It hatched!', r.msg ?? ''); confetti(); cheer(1.2); },
    equipPet: (p) => chars.petCheer(p.id),
    trainPet: (p) => { chars.petCheer(p.id, 'star'); const o = origin(); confetti(o.x, o.y, 18); },
    petMode: (p) => chars.petCheer(p.id),
    buyHome: () => big('New home!', 'A very official address.'),
    rebirth: () => big('Promoted!', 'A new Rank Star. mihao.', 2.2),
    unlockIsland: () => big('Sky Island!', 'Now open.'),
    unlockPose: () => big('New pose!', 'Strike it from Mihao Cam.', 1),
    placeDecor: () => me()?.cheer(0.4),
    storeDecor: () => fx.float(say(), at(2.2), { size: 0.5 }),
    setTitle: () => cheer(0.7, 'mihao'),
    buyWear: () => big('New drip!', 'Looking official.', 1.2),
    setAvatar: () => { me()?.cheer(0.8); fx.ring(at(0), { color: '#FF7AB6' }); fx.float('star', at(1.8), { n: 4, spread: 0.9 }); },
    like: () => { fx.float('heart', at(2), { n: 7, spread: 0.9 }); fx.float('mihao', at(2.6), { size: 0.75 }); me()?.cheer(0.8); },
    trialStart: () => big('Go!', 'The challenge has started.', 1),
    trialAct: (p, r) => { if (r.x?.won) big('Challenge won!', 'Very mihao.', 1.4); else fx.float('star', at(1.9)); },
    claimTutorial: () => reward('mihao'),
  };

  return {
    /** r is the server's answer to action a. */
    result(a, p, r) {
      if (!r.ok) {
        const card = document.querySelector('#modal:not([hidden]) #modalCard') ?? document.querySelector('#hotbar');
        shake(card);
        fx.float('mihao?', at(2.4), { size: 0.55, rise: 0.5, spread: 0.1 });
        return;
      }
      done[a]?.(p ?? {}, r);
    },
    cheer,
    /** Puffs where the cat leaves from and where it lands. */
    travel(from, to) {
      for (const p of [from, to]) { fx.burst(new THREE.Vector3(p.x, 0.8, p.z), { n: 26, colors: PALETTE.white, speed: 2.4, up: 2, size: 0.14 }); fx.ring(new THREE.Vector3(p.x, 0, p.z), { radius: 1.8 }); }
      fx.beam(new THREE.Vector3(to.x, 0, to.z), { life: 0.8 });
    },
    levelUp(level) { big('Level up!', `Reputation level ${level}`, 1.5); pop(document.querySelector('.wallet'), 0.5); },
  };
}
