// The second set of Meme Depot pictures (reactions, two-panel jokes and more game moments).
const face = (id, extra) => ({ id, camera: 'face', ...extra });
const full = (id, extra) => ({ id, camera: 'full', ...extra });

export default [
  // ---- reactions people can drop into any chat ----
  face('no', { time: 'dusk', cats: [{ pose: 'stance' }], bottom: 'NO.', bottomSize: 300, bottomColor: '#fff', template: 'unimpressed' }),
  face('mihao-question', { time: 'day', cats: [{ look: 'gardener', pose: 'idle', turn: -0.25 }], bottom: 'MIHAO?', bottomSize: 240 }),
  face('i-saw-that', { time: 'night', spot: 'plaza', cats: [{ pose: 'stance', turn: 0.62 }], bottom: 'I SAW THAT.', bottomSize: 200, template: 'side-eye' }),
  face('approved', { time: 'day', spot: 'market', cats: [{ look: 'captain', pose: 'stance' }], stamp: ['APPROVED', '#178a34'], sub: 'official garden business.' }),
  face('rejected', { time: 'dusk', cats: [{ pose: 'stance' }], stamp: ['REJECTED', '#c21b22'], sub: 'not enough mihao.' }),
  face('inspecting', { time: 'golden', spot: 'beds', cats: [{ pose: 'stance' }], props: [{ kind: 'magnifier', pos: [0.17, 1.8, 0.62] }], bottom: 'HMM...', bottomSize: 220, template: 'magnifying-glass' }),

  // ---- greetings and everyday posts ----
  full('tea-first', { time: 'sunrise', lift: 0.2, cats: [{ look: 'gardener', pose: 'idle', x: -0.5, turn: 0.35 }], props: [{ kind: 'crate', pos: [0.8, 0, 0.55], h: 0.65 }, { kind: 'teacup', pos: [0.8, 0.65, 0.55] }], top: 'GM. TEA FIRST.', bottom: 'GARDEN SECOND.', bottomSize: 140, template: 'tea-break' }),
  full('monday', { time: 'day', lift: 0.25, cats: [{ pose: 'sit', at: 0.8 }], top: 'MONDAY AGAIN?', bottom: "CARROTS DON'T CARE.", bottomSize: 128 }),
  full('weekend-festival', { time: 'sunrise', spot: 'market', confetti: true, cats: [{ pose: 'dance', at: 0.45 }, { look: 'phoenix', pose: 'dance', at: 1.1, x: -1.4, z: -0.6, turn: 0.2 }, { look: 'ghost', pose: 'dance', at: 1.6, x: 1.4, z: -0.6, turn: -0.2 }], top: "IT'S THE WEEKEND", topSize: 160, bottom: 'FESTIVAL TIME', bottomSize: 170 }),
  full('lets-grow', { time: 'sunrise', cats: [{ pose: 'point', at: 0.6 }], top: "LET'S GROW", topSize: 210, bottom: 'VERY MIHAO ENERGY', bottomSize: 135 }),
  full('thank-you', { time: 'blossom', spot: 'blossom', hearts: true, cats: [{ look: 'sailor', pose: 'wave', at: 0.55 }], top: 'THANK YOU', topSize: 210, bottom: 'YOU ARE VERY MIHAO', bottomSize: 135 }),
  full('a-gift', { time: 'golden', lift: 0.3, cats: [{ pose: 'point', at: 0.6, x: -0.7, turn: 0.5 }], props: [{ kind: 'gift', pos: [0.8, 0.04, 0.55] }], top: 'A GIFT FOR YOU', bottom: 'OPEN WITH MIHAO', bottomSize: 140, template: 'gift' }),
  full('happy-birthday', { time: 'blossom', spot: 'blossom', lift: 0.3, confetti: true, cats: [{ look: 'lime', pose: 'wave', at: 0.55, x: -0.68, turn: 0.3 }], props: [{ kind: 'cake', pos: [0.78, 0.04, 0.6] }], top: 'HAPPY BIRTHDAY', bottom: 'MAKE A MIHAO WISH', bottomSize: 130, template: 'birthday' }),
  full('five-more-minutes', { time: 'night', lift: 0.25, zzz: [1010, 520], cats: [{ look: 'ghost', pose: 'sit', at: 0.8 }], top: 'FIVE MORE MINUTES', topSize: 145, bottom: 'THEN I WATER.', bottomSize: 150 }),
  full('good-garden', { time: 'golden', lift: 0.2, confetti: true, cats: [{ pose: 'flex', at: 0.4, x: -0.55, turn: 0.25 }], props: [{ kind: 'trophy', pos: [0.82, 0.04, 0.5] }], top: 'GG', topSize: 260, bottom: 'GOOD GARDEN.', bottomSize: 160, template: 'winner' }),
  full('fish-is-mine', { time: 'dusk', lift: 0.3, cats: [{ look: 'gardener', pose: 'stance', x: -0.6, turn: 0.4 }, { look: 'sailor', pose: 'shock', at: 0.45, x: 1.15, z: -0.6, turn: -0.45 }], props: [{ kind: 'crate', pos: [0.5, 0, 0.75], h: 0.55 }, { kind: 'fish', pos: [0.5, 0.55, 0.75] }], top: 'THE FISH IS MINE', bottom: 'END OF MEETING.', bottomSize: 140, template: 'fish-dispute' }),

  // ---- village life ----
  full('new-gardener', { time: 'day', spot: 'beds', cats: [{ pose: 'wave', at: 0.55, x: -0.8, turn: 0.45 }, { look: 'gardener', pose: 'wave', at: 1.0, x: 0.85, turn: -0.45 }], top: 'NEW GARDENER!', bottom: 'SAY MIHAO BACK', bottomSize: 140, template: 'hello' }),
  full('visit-my-garden', { time: 'blossom', spot: 'blossom', cats: [{ look: 'sailor', pose: 'point', at: 0.6 }], top: 'VISIT MY GARDEN', topSize: 155, bottom: 'I HAVE SNACKS.', bottomSize: 150 }),
  full('mihao-stamp', { time: 'golden', cats: [{ pose: 'flex', at: 0.4 }], stamp: ['MIHAO', '#c21b22', 1110, 520, 150], top: 'NICE GARDEN', bottom: 'HAVE A STAMP', bottomSize: 150 }),
  full('sky-island', { time: 'day', spot: 'beds', lift: 0.1, cats: [{ look: 'captain', pose: 'point', at: 0.6, x: -0.65, turn: 0.4 }], props: [{ kind: 'balloon', pos: [0.8, 0.45, -0.2], height: 1.85 }], top: 'SKY ISLAND?', bottom: 'FIX THE BALLOON FIRST', bottomSize: 118 }),

  // ---- weather ----
  full('make-a-wish', { time: 'night', lift: -0.15, shootingStars: true, cats: [{ look: 'grandmaster', pose: 'point', at: 0.6 }], top: 'SHOOTING STARS', topSize: 160, bottom: 'WISH FOR RARE CROPS', bottomSize: 125, template: 'starry-night' }),
  full('frosty-whiskers', { time: 'day', snow: true, cats: [{ look: 'ghost', pose: 'shock', at: 0.45 }], top: 'FROSTY WHISKERS', topSize: 160, bottom: 'STILL MIHAO.', bottomSize: 165, template: 'snow' }),
  full('too-hot', { time: 'golden', lift: 0.25, heat: true, cats: [{ look: 'gardener', pose: 'sit', at: 0.8 }], top: 'HEATWAVE', topSize: 200, bottom: 'TOO HOT TO MIHAO', bottomSize: 140 }),

  // ---- two-panel jokes (side by side, so the cats and things stay near the middle of each half) ----
  { id: 'one-carrot-vs-hundred', panels: [
    { time: 'day', cats: [{ look: 'gardener', pose: 'idle' }], props: [{ kind: 'sprout', pos: [0.2, 0, 0.95], scale: 0.9 }], label: 'PLANTING 1 SEED' },
    { time: 'dusk', cats: [{ look: 'gardener', pose: 'shock', at: 0.45, z: -0.25 }], props: [{ kind: 'heap', pos: [0, 0, 0.9], spread: 0.7, n: 50 }], label: 'HARVESTING 100 CROPS' },
  ] },
  { id: 'sunny-vs-storm', panels: [
    { time: 'sunrise', cats: [{ pose: 'dance', at: 0.45 }], label: 'ME ON A SUNNY DAY' },
    { time: 'night', storm: true, cats: [{ pose: 'shock', at: 0.45 }], label: 'ME IN A BEARD STORM' },
  ] },
  { id: 'before-after-sale', panels: [
    { time: 'dusk', cats: [{ look: 'gardener', pose: 'sit', at: 0.8 }], label: 'BEFORE SELLING' },
    { time: 'golden', spot: 'market', cats: [{ look: 'captain', pose: 'flex', at: 0.4, z: -0.3 }], props: [{ kind: 'coins', pos: [0.05, 0.02, 0.85], scale: 0.85 }], label: 'AFTER SELLING (GAME COINS)' },
  ] },
  { id: 'what-i-said', panels: [
    { time: 'day', cats: [{ pose: 'stance' }], label: '"JUST ONE CROP CHECK"' },
    { time: 'night', spot: 'plaza', cats: [{ look: 'ghost', pose: 'dance', at: 0.45 }], label: '5 HOURS LATER' },
  ] },
];
