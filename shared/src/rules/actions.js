// @ts-check
// One entry point for player actions. The server validates proximity first, then calls applyAction.
import * as G from './garden.js';
import * as E from './economy.js';
import * as Q from './quests.js';
import { fail, ok } from './state.js';
import * as P from './pets.js';
import * as R from './progress.js';
import * as H from './estate.js';
import * as M from './memes.js';

/** Where an action must be performed: 'garden' (own plot), a stall id, or 'any'. */
export const ACTION_PLACE = Object.freeze({
  plant: 'garden', water: 'garden', harvest: 'garden', move: 'garden', remove: 'garden',
  useGadget: 'garden', expandSoil: 'garden', growAll: 'garden',
  buySeed: 'seeds', buyGadget: 'gadgets', sell: 'market', appraise: 'market', pity: 'market',
  star: 'any', claimQuest: 'any', claimGift: 'any', tutorial: 'any',
  // pets (eggs at Penny's pet shop; everything else from the pet panel)
  buyEgg: 'pets', hatch: 'any', equipPet: 'any', trainPet: 'any', petMode: 'any',
  // home and decor (decor sold by Mo, placed anywhere on your plot)
  buyHome: 'plot', buyDecor: 'seeds', placeDecor: 'plot', moveDecor: 'plot', storeDecor: 'plot',
  // progression
  claimCollection: 'any', setTitle: 'any', deliverOrder: 'board', deliverContract: 'board', claimSeason: 'any',
  festivalBuy: 'any', unlockIsland: 'balloon', pickAcorn: 'island', acornShop: 'island',
  unlockPose: 'any', inspect: 'plot',
  trialStart: 'any', trialAct: 'any', surprise: 'plot', rebirth: 'any', setAvatar: 'any', buyWear: 'any',
});

/** Which parts of the private state an action may change (for deltas). */
export const TOUCHES = Object.freeze({
  plant: ['plants', 'seeds', 'stats', 'daily', 'weekly', 'xp'],
  water: ['plants', 'stats', 'daily', 'weekly', 'xp'],
  harvest: ['plants', 'basket', 'species', 'stats', 'daily', 'weekly', 'xp'],
  move: ['plants'], remove: ['plants'],
  useGadget: ['plants', 'effects', 'gadgets', 'seeds', 'basket', 'species', 'stats', 'daily', 'weekly', 'xp'],
  expandSoil: ['soil', 'coins', 'basket'],
  growAll: ['plants', 'coins'],
  buySeed: ['seeds', 'coins', 'bought', 'stats', 'daily', 'weekly'],
  buyGadget: ['gadgets', 'tools', 'coins', 'bought'],
  sell: ['basket', 'coins', 'mood', 'stats', 'daily', 'weekly'],
  appraise: [], pity: ['coins', 'seeds', 'pityAt'],
  star: ['basket'], claimQuest: ['daily', 'weekly', 'coins', 'gems', 'gadgets', 'tools', 'xp'],
  claimGift: ['gift', 'coins', 'gems', 'gadgets', 'tools'], tutorial: ['tutorial'],
});

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const str = (v) => (typeof v === 'string' && v.length < 40 ? v : '');

/**
 * @param {*} state
 * @param {string} a action name
 * @param {*} p payload
 * @param {{now:number, seed:number, rng:(...parts:any[])=>()=>number}} ctx
 */
export function applyAction(state, a, p, ctx) {
  p = p ?? {};
  switch (a) {
    case 'plant': return G.plant(state, str(p.crop), num(p.x), num(p.z), ctx);
    case 'water': return G.water(state, str(p.id), ctx);
    case 'harvest': return G.harvest(state, str(p.id), ctx);
    case 'move': return G.move(state, str(p.id), num(p.x), num(p.z), ctx);
    case 'remove': return G.remove(state, str(p.id), ctx);
    case 'useGadget': return G.useGadget(state, str(p.kind), { x: num(p.x), z: num(p.z), plantId: str(p.id) }, ctx);
    case 'expandSoil': return G.expandSoil(state, ctx);
    case 'growAll': return G.growAll(state, num(p.quote), ctx);
    case 'buySeed': return E.buySeed(state, str(p.id), num(p.n) || 1, ctx);
    case 'buyGadget': return E.buyGadget(state, str(p.id), ctx);
    case 'sell': return E.sell(state, p.all ? 'all' : Array.isArray(p.ids) ? p.ids.slice(0, 200).map(str) : [], ctx);
    case 'appraise': return ok('', E.appraise(state, p.all ? 'all' : Array.isArray(p.ids) ? p.ids.slice(0, 200).map(str) : [], ctx.now));
    case 'pity': return G.pity(state, ctx);
    case 'star': return E.star(state, str(p.id));
    case 'claimQuest': return Q.claimQuest(state, str(p.id), !!p.weekly);
    case 'claimGift': return Q.claimGift(state, ctx.now);
    case 'buyEgg': return P.buyEgg(state, str(p.id), ctx);
    case 'hatch': return P.hatch(state, str(p.id), ctx);
    case 'equipPet': return P.equipPet(state, str(p.id));
    case 'trainPet': return P.trainPet(state, str(p.id));
    case 'petMode': return P.petMode(state, str(p.id), str(p.mode));
    case 'buyHome': return H.buyHome(state);
    case 'buyDecor': return H.buyDecor(state, str(p.id));
    case 'placeDecor': return H.placeDecor(state, str(p.kind), num(p.x), num(p.z), num(p.rot) || 0);
    case 'moveDecor': return H.moveDecor(state, str(p.id), num(p.x), num(p.z), Number.isFinite(p.rot) ? p.rot : null);
    case 'storeDecor': return H.storeDecor(state, str(p.id));
    case 'claimCollection': return R.claimCollection(state, str(p.id), ctx);
    case 'setTitle': return R.setTitle(state, typeof p.title === 'string' ? p.title.slice(0, 40) : '');
    case 'deliverOrder': return R.deliverOrder(state, str(p.id), ctx);
    case 'deliverContract': return R.deliverContract(state, ctx);
    case 'claimSeason': return R.claimSeason(state, Math.floor(num(p.tier)), ctx);
    case 'festivalBuy': return R.festivalBuy(state, str(p.id), ctx);
    case 'unlockIsland': return R.unlockIsland(state, ctx);
    case 'pickAcorn': return R.pickAcorn(state, Math.floor(num(p.i)), ctx.pos ?? { x: NaN, z: NaN }, ctx);
    case 'acornShop': return R.acornShop(state, str(p.id), ctx);
    case 'trialStart': return R.trialStart(state, ctx);
    case 'trialAct': return R.trialAct(state, str(p.a), Math.floor(num(p.bed)), str(p.crop), ctx);
    case 'surprise': return R.resolveSurprise(state, ctx.slot ?? 0, ctx.pos ?? { x: NaN, z: NaN }, ctx);
    case 'rebirth': return H.rebirth(state, ctx);
    case 'unlockPose': return M.unlockPose(state, str(p.id), ctx);
    case 'inspect': return M.inspect(state, ctx.slot ?? 0, ctx.pos ?? { x: NaN, z: NaN }, ctx);
    case 'setAvatar': return H.setAvatar(state, p);
    case 'buyWear': return H.buyWear(state, str(p.id));
    case 'tutorial': state.tutorial = Math.max(state.tutorial, Math.min(99, Math.floor(num(p.step) || 0))); return ok();
    default: return fail('unknown', 'Unknown action.');
  }
}
