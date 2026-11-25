// Mihao Meme Garden UI icons: 24x24, flat blocky shapes with a thick near-black outline, in the Mihao palette.
// The drawings below keep their old colours; the palette pass at the bottom of this file recolours and squares them off.
// Each entry is the inner SVG markup. build-sprite.mjs validates and packs them into sprite.svg.
const O = 'stroke="#4A2E1A" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"';
const o = 'stroke="#4A2E1A" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"';

export const ICONS = {
  coin: `<circle cx="12" cy="12" r="9" fill="#FFC233" ${O}/><circle cx="12" cy="12" r="5.5" fill="#FFD84A" ${o}/><path d="M12 9.2c-1.6 1.1-1.8 3.3 0 5.6c1.8-2.3 1.6-4.5 0-5.6z" fill="#7CB342" ${o}/>`,
  gem: `<path d="M12 2.5l7 6.5l-7 12.5l-7-12.5z" fill="#2FB463" ${O}/><path d="M12 2.5l-2.5 6.5h5zM5 9h14" fill="#7EE0A0" ${o}/>`,
  // $MGRD token: the project logo (same art as client/public/favicon.svg, scaled from 64 to 24)
  mgrd: `<g transform="scale(.375)"><circle cx="32" cy="32" r="30" fill="#5DBB46" stroke="#4A2E1A" stroke-width="4"/> <path d="M8 44 Q32 34 56 44 L56 50 Q32 64 8 50 Z" fill="#8A5A34"/> <path d="M32 44 C32 36 31 30 32 22" fill="none" stroke="#2F7A2A" stroke-width="5" stroke-linecap="round"/> <path d="M32 30 C22 32 14 26 13 16 C24 14 31 20 32 30 Z" fill="#7DD957" stroke="#2F7A2A" stroke-width="3" stroke-linejoin="round"/> <path d="M32 24 C40 24 49 18 51 8 C40 7 32 13 32 24 Z" fill="#9BE86A" stroke="#2F7A2A" stroke-width="3" stroke-linejoin="round"/> <circle cx="45" cy="40" r="5" fill="#FFC233" stroke="#4A2E1A" stroke-width="2.5"/></g>`,
  xp: `<path d="M12 2.8l2.6 5.6l6.1.7l-4.5 4.1l1.2 6l-5.4-3l-5.4 3l1.2-6l-4.5-4.1l6.1-.7z" fill="#FFC233" ${O}/>`,
  seeds: `<path d="M6 8c0-2 2-3.5 6-3.5s6 1.5 6 3.5l1 10c0 1.5-2.5 2.5-7 2.5s-7-1-7-2.5z" fill="#D9A35A" ${O}/><path d="M8.5 5.5l1.5 2.5h4l1.5-2.5" fill="none" ${o}/><ellipse cx="12" cy="14" rx="2" ry="3" fill="#7CB342" ${o}/>`,
  garden: `<path d="M6 13h12l-1.5 7.5h-9z" fill="#D2693A" ${O}/><path d="M12 13V8" ${O}/><path d="M12 9c-1-3-4-4-6-3c.5 2.5 3 4 6 3zM12 8c1-3 4-4.5 6-3.5c-.5 2.5-3 4-6 3.5z" fill="#4CAF50" ${o}/>`,
  sell: `<path d="M8 6.5c-3 2.5-4.5 6-4 9c.5 3.5 3.5 5 8 5s7.5-1.5 8-5c.5-3-1-6.5-4-9z" fill="#C9965A" ${O}/><path d="M8 6.5l1.5-3h5L16 6.5" fill="#E8C07A" ${o}/><circle cx="12" cy="14" r="3.2" fill="#FFC233" ${o}/>`,
  shop: `<path d="M3.5 9l2-5h13l2 5" fill="#1F6FE0" ${O}/><path d="M3.5 9c0 1.5 1.2 2.5 2.8 2.5S9 10.5 9 9c0 1.5 1.2 2.5 3 2.5s3-1 3-2.5c0 1.5 1.2 2.5 2.8 2.5s2.7-1 2.7-2.5" fill="#FFF4DC" ${o}/><path d="M5 11.5V20h14v-8.5" fill="#C98E5A" ${O}/>`,
  quests: `<path d="M6 3.5h10a2 2 0 0 1 2 2V19a1.5 1.5 0 0 1-1.5 1.5H7.5A1.5 1.5 0 0 1 6 19z" fill="#FFF4DC" ${O}/><path d="M9 8h6M9 11.5h6M9 15h4" ${o}/><circle cx="17.5" cy="17.5" r="3.5" fill="#2FB463" ${o}/><path d="M16 17.5l1 1l2-2" stroke="#fff" stroke-width="1.5" fill="none"/>`,
  gift: `<rect x="4" y="9" width="16" height="11" rx="1.5" fill="#D6336C" ${O}/><rect x="3" y="6.5" width="18" height="4" rx="1" fill="#E85A8A" ${O}/><path d="M12 6.5V20" stroke="#FFC233" stroke-width="3"/><path d="M12 6.5c-2-3.5-5.5-3.5-5.5-1.5s3 1.5 5.5 1.5zm0 0c2-3.5 5.5-3.5 5.5-1.5s-3 1.5-5.5 1.5z" fill="#FFC233" ${o}/>`,
  chat: `<path d="M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-9l-4.5 3.5v-3.5H4A1.5 1.5 0 0 1 2.5 16V7A1.5 1.5 0 0 1 4 5.5z" fill="#FFF4DC" ${O}/><circle cx="8" cy="11.5" r="1.2" fill="#4A2E1A"/><circle cx="12" cy="11.5" r="1.2" fill="#4A2E1A"/><circle cx="16" cy="11.5" r="1.2" fill="#4A2E1A"/>`,
  like: `<path d="M12 20.5s-8-4.6-8-10.4C4 7 6 5 8.5 5c1.6 0 2.8.9 3.5 2c.7-1.1 1.9-2 3.5-2C18 5 20 7 20 10.1c0 5.8-8 10.4-8 10.4z" fill="#D6336C" ${O}/><path d="M7.5 9c.3-1 1-1.6 2-1.6" stroke="#FFC0D4" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,
  settings: `<circle cx="12" cy="12" r="4" fill="#FFC233" ${O}/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" ${O}/>`,
  close: `<circle cx="12" cy="12" r="9.5" fill="#D93A3A" ${O}/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>`,
  back: `<circle cx="12" cy="12" r="9.5" fill="#FFF4DC" ${O}/><path d="M13.5 7.5L9 12l4.5 4.5" fill="none" stroke="#4A2E1A" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  menu: `<rect x="3.5" y="5" width="17" height="3" rx="1.5" fill="#FFF4DC" ${o}/><rect x="3.5" y="10.5" width="17" height="3" rx="1.5" fill="#FFF4DC" ${o}/><rect x="3.5" y="16" width="17" height="3" rx="1.5" fill="#FFF4DC" ${o}/>`,
  water: `<path d="M5 10h10l-1 9H6z" fill="#3FA9E0" ${O}/><path d="M15 12l5-4l1 1.5l-5 4.5" fill="#3FA9E0" ${o}/><path d="M7 10c0-3 6-3 6 0" fill="none" ${o}/><path d="M21.5 11.5c0 1-.8 1.5-.8 2.3M19.8 13.3c0 .8-.6 1.2-.6 1.9" stroke="#3FA9E0" stroke-width="1.5" stroke-linecap="round"/>`,
  shovel: `<path d="M11 2.5h2v10h-2z" fill="#C98E5A" ${o}/><path d="M7.5 12.5h9v3c0 3-2 5.5-4.5 6c-2.5-.5-4.5-3-4.5-6z" fill="#B8B8C0" ${O}/><path d="M9.5 2.5h5" ${O}/>`,
  trowel: `<path d="M13.5 3.5l3 3l-4 4l-3-3z" fill="#C98E5A" ${o}/><path d="M9.5 7.5l3 3l-6.5 9.5c-1.5 1-3 .5-3.5-.5c-.5-1 0-2.5 1-3.5z" fill="#B8B8C0" ${O}/>`,
  basket: `<path d="M3 10h18l-2 10H5z" fill="#C9965A" ${O}/><path d="M7 10c0-4 2.5-6 5-6s5 2 5 6" fill="none" ${O}/><path d="M7 13.5v4M12 13.5v4M17 13.5v4" ${o}/>`,
  star: `<path d="M12 3l2.6 5.5l6 .8l-4.4 4.1l1.1 5.9L12 16.5l-5.3 2.8l1.1-5.9l-4.4-4.1l6-.8z" fill="#FFD84A" ${O}/>`,
  lock: `<rect x="5" y="10.5" width="14" height="10" rx="2" fill="#FFC233" ${O}/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" ${O}/><circle cx="12" cy="15.5" r="1.5" fill="#4A2E1A"/>`,
  check: `<circle cx="12" cy="12" r="9.5" fill="#2FB463" ${O}/><path d="M7.5 12.5l3 3l6-6.5" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  timer: `<circle cx="12" cy="13" r="8" fill="#FFF4DC" ${O}/><path d="M12 9v4.5l3 2" fill="none" ${O}/><path d="M10 2.5h4" ${O}/>`,
  warning: `<path d="M12 3l9.5 17h-19z" fill="#FFC233" ${O}/><path d="M12 9.5v5" stroke="#4A2E1A" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="17.5" r="1.3" fill="#4A2E1A"/>`,
  online: `<circle cx="12" cy="12" r="8" fill="#2FB463" ${O}/><circle cx="12" cy="12" r="3" fill="#B7F0C8"/>`,
  offline: `<circle cx="12" cy="12" r="8" fill="#D93A3A" ${O}/><path d="M9 9l6 6M15 9l-6 6" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>`,
  connecting: `<circle cx="12" cy="12" r="8" fill="#FFC233" ${O}/><circle cx="8.5" cy="12" r="1.3" fill="#4A2E1A"/><circle cx="12" cy="12" r="1.3" fill="#4A2E1A"/><circle cx="15.5" cy="12" r="1.3" fill="#4A2E1A"/>`,
  map: `<path d="M3 6l6-2.5l6 2.5l6-2.5V18l-6 2.5l-6-2.5l-6 2.5z" fill="#B7E08A" ${O}/><path d="M9 3.5V18M15 6v14.5" ${o}/><circle cx="17.5" cy="10" r="1.6" fill="#D93A3A" ${o}/>`,
  user: `<circle cx="12" cy="8.5" r="4" fill="#E9B48F" ${O}/><path d="M4.5 20.5c.5-4 3.5-6.5 7.5-6.5s7 2.5 7.5 6.5z" fill="#3D6EA8" ${O}/>`,
  room: `<circle cx="8" cy="9" r="3" fill="#E9B48F" ${o}/><circle cx="16" cy="9" r="3" fill="#C98E6A" ${o}/><path d="M2.5 19c.5-3 2.5-5 5.5-5s5 2 5.5 5zM10.5 19c.5-3 2.5-5 5.5-5s5 2 5.5 5z" fill="#2FB463" ${o}/>`,
  expand: `<rect x="4" y="4" width="16" height="16" rx="2" fill="#8D6E4A" ${O}/><path d="M8 12h8M12 8v8" stroke="#FFF4DC" stroke-width="2.6" stroke-linecap="round"/>`,
  growAll: `<path d="M12 21v-8" ${O}/><path d="M12 14c-1.5-4-5.5-5-8-3.5c1 3.5 4.5 5 8 3.5zM12 13c1.5-4.5 5.5-6 8-4.5c-1 3.5-4.5 5.5-8 4.5z" fill="#4CAF50" ${o}/><path d="M14 2.5l-3 5h3l-2.5 4.5" fill="none" stroke="#FFC233" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  sparkle: `<path d="M12 2.5c.8 4.5 2.5 6.6 7 7.5c-4.5.9-6.2 3-7 7.5c-.8-4.5-2.5-6.6-7-7.5c4.5-.9 6.2-3 7-7.5z" fill="#FFD84A" ${O}/><circle cx="19" cy="18.5" r="1.8" fill="#FFD84A" ${o}/>`,
  pointer: `<path d="M12 21l-6.5-9h4V3.5h5V12h4z" fill="#FFC233" ${O}/>`,
  key: `<circle cx="8" cy="12" r="4.5" fill="#FFC233" ${O}/><path d="M12.5 12h8.5v3M18 12v2.5" fill="none" ${O}/><circle cx="8" cy="12" r="1.5" fill="#4A2E1A"/>`,
  sunny: `<circle cx="12" cy="12" r="4.8" fill="#FFC233" ${O}/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" ${O}/>`,
  rain: `<path d="M6.5 14.5a4.5 4.5 0 0 1 .7-9a5.5 5.5 0 0 1 10.3 1.7a3.7 3.7 0 0 1-.5 7.3z" fill="#D7E7F2" ${O}/><path d="M8 17.5l-1 3M12 17.5l-1 3M16 17.5l-1 3" stroke="#1F6FE0" stroke-width="2" stroke-linecap="round"/>`,
  night: `<path d="M15.5 3.5a8.5 8.5 0 1 0 5 13.5a7 7 0 0 1-5-13.5z" fill="#B9A6F2" ${O}/><circle cx="17.5" cy="7" r="1" fill="#FFD84A"/><circle cx="20" cy="11.5" r=".8" fill="#FFD84A"/>`,
  frosty: `<path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6" stroke="#4A2E1A" stroke-width="3.6" stroke-linecap="round"/><path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6" stroke="#8FD3FF" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="12" r="2.6" fill="#D7F0FF" ${o}/>`,
  heatwave: `<circle cx="9" cy="9" r="4.5" fill="#FF8A3A" ${O}/><path d="M4 16c2-1.3 4 1.3 6 0s4 1.3 6 0s4 1.3 6 0M4 20c2-1.3 4 1.3 6 0s4 1.3 6 0" fill="none" stroke="#D93A3A" stroke-width="2" stroke-linecap="round"/>`,
  storm: `<path d="M6.5 13.5a4.5 4.5 0 0 1 .7-9a5.5 5.5 0 0 1 10.3 1.7a3.7 3.7 0 0 1-.5 7.3z" fill="#8A8FA8" ${O}/><path d="M13 11.5l-3 5h3l-2 5" fill="none" stroke="#FFC233" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  stars: `<path d="M9 3l1.5 3.5L14 8l-3.5 1.5L9 13l-1.5-3.5L4 8l3.5-1.5z" fill="#FFD84A" ${o}/><path d="M12 21l7-9" stroke="#FFD84A" stroke-width="2" stroke-linecap="round"/><circle cx="19.5" cy="11.5" r="2" fill="#FFF4DC" ${o}/>`,
  bubbleSprinkler: `<path d="M11 21V12h2v9" fill="#3D6EA8" ${o}/><rect x="8" y="9" width="8" height="3.5" rx="1.5" fill="#3FA9E0" ${O}/><circle cx="7" cy="5.5" r="2.3" fill="#D7F0FF" ${o}/><circle cx="13.5" cy="4" r="1.7" fill="#D7F0FF" ${o}/><circle cx="18" cy="6.5" r="1.3" fill="#D7F0FF" ${o}/>`,
  rocketSprinkler: `<path d="M12 2.5c3 2 4 5.5 4 9.5h-8c0-4 1-7.5 4-9.5z" fill="#D93A3A" ${O}/><circle cx="12" cy="7.5" r="1.6" fill="#D7F0FF" ${o}/><path d="M8 12l-2.5 3.5H8M16 12l2.5 3.5H16" fill="#FFC233" ${o}/><path d="M10 15.5l2 5l2-5" fill="#FFC233" ${o}/>`,
  capyHorn: `<path d="M3 9.5h4l9-5v15l-9-5H3z" fill="#FFC233" ${O}/><path d="M18.5 8.5c1.5 1.5 1.5 5.5 0 7M20.5 6.5c2.5 2.5 2.5 8.5 0 11" fill="none" ${o}/>`,
  growJuice: `<path d="M9 3.5h6v3l2 3v10.5c0 .8-.7 1.5-1.5 1.5h-7c-.8 0-1.5-.7-1.5-1.5V9.5l2-3z" fill="#FFF4DC" ${O}/><path d="M7 13h10v7c0 .8-.7 1.5-1.5 1.5h-7C7.7 21.5 7 20.8 7 20z" fill="#7CB342" ${o}/><path d="M12 15.5c-1 .8-1 2.2 0 3c1-.8 1-2.2 0-3z" fill="#B7E08A" ${o}/>`,
  mysteryBox: `<rect x="4" y="8" width="16" height="12.5" rx="1.5" fill="#7C3AED" ${O}/><path d="M3 8l9-4.5L21 8" fill="#A77BF5" ${O}/><path d="M10 12.5a2 2 0 1 1 3 1.7c-.8.5-1 1-1 1.8" fill="none" stroke="#FFD84A" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="18" r="1.1" fill="#FFD84A"/>`,
  oopsShovel: `<path d="M11 2.5h2v9h-2z" fill="#C98E5A" ${o}/><path d="M7.5 11.5h9v3c0 3-2 5.5-4.5 6c-2.5-.5-4.5-3-4.5-6z" fill="#B8B8C0" ${O}/><path d="M17 5.5a3.5 3.5 0 1 1 3.5 3.5" fill="none" stroke="#2FB463" stroke-width="2" stroke-linecap="round"/><path d="M18.5 3.5l-1.5 2l2.2.8" fill="none" stroke="#2FB463" stroke-width="2" stroke-linecap="round"/>`,
  magnifier: `<circle cx="10" cy="10" r="6.5" fill="#D7F0FF" ${O}/><path d="M15 15l6 6" stroke="#4A2E1A" stroke-width="3.4" stroke-linecap="round"/><path d="M15 15l6 6" stroke="#C98E5A" stroke-width="1.6" stroke-linecap="round"/><circle cx="10" cy="10" r="2.4" fill="#4A2E1A"/>`,
  rainJar: `<path d="M7 7.5h10v12c0 1-1 2-2 2H9c-1 0-2-1-2-2z" fill="#D7F0FF" ${O}/><rect x="6" y="5" width="12" height="3" rx="1" fill="#C98E5A" ${o}/><path d="M9.5 15a2 2 0 0 1 .3-4a2.5 2.5 0 0 1 4.7.8a1.7 1.7 0 0 1-.2 3.2z" fill="#8A8FA8" ${o}/><path d="M10.5 17v1.5M13 17v1.5" stroke="#1F6FE0" stroke-width="1.5" stroke-linecap="round"/>`,
  harvest: `<path d="M6 9c0-2 2-4 6-4s6 2 6 4c0 6-3 11-6 11s-6-5-6-11z" fill="#D93A3A" ${O}/><path d="M12 5c0-1.5.5-2.5 2-3" fill="none" ${o}/><path d="M12 5c-2-1.5-4-1-5 0c1.5 1.3 3.5 1.3 5 0z" fill="#4CAF50" ${o}/><path d="M8.5 9.5c.5-1 1.2-1.6 2-1.8" stroke="#FFC0C0" stroke-width="1.5" stroke-linecap="round" fill="none"/>`,
  plant: `<path d="M4 18.5c2-2 14-2 16 0v2H4z" fill="#8D5A3A" ${O}/><path d="M12 18v-6" ${O}/><path d="M12 13c-1-3-4-4-6-3c.5 2.5 3 4 6 3zM12 12c1-3 4-4.5 6-3.5c-.5 2.5-3 4-6 3.5z" fill="#7CB342" ${o}/>`,
  paw: `<ellipse cx="12" cy="15.5" rx="5" ry="4.2" fill="#C98E5A" ${O}/><circle cx="6.2" cy="9.5" r="2.2" fill="#C98E5A" ${o}/><circle cx="10" cy="6.5" r="2.2" fill="#C98E5A" ${o}/><circle cx="14" cy="6.5" r="2.2" fill="#C98E5A" ${o}/><circle cx="17.8" cy="9.5" r="2.2" fill="#C98E5A" ${o}/>`,
  egg: `<path d="M12 2.8c3.8 0 6.8 6 6.8 10.4c0 4.4-3 7.8-6.8 7.8s-6.8-3.4-6.8-7.8C5.2 8.8 8.2 2.8 12 2.8z" fill="#FFF4DC" ${O}/><path d="M7.5 12.5l2-1.5l2 1.5l2-1.5l2 1.5l1.6-1.2" fill="none" stroke="#2FB463" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  album: `<rect x="4" y="3" width="15" height="18" rx="2" fill="#7C3AED" ${O}/><rect x="7" y="6" width="9" height="6" rx="1" fill="#FFF4DC" ${o}/><path d="M7 15h9M7 18h6" stroke="#FFF4DC" stroke-width="1.6" stroke-linecap="round"/><path d="M4 5v14" stroke="#5B21B6" stroke-width="2"/>`,
  board: `<path d="M6 21V9M18 21V9" ${O}/><rect x="3" y="5" width="18" height="11" rx="1.5" fill="#B08458" ${O}/><rect x="5.5" y="7" width="5" height="4" fill="#FFF4DC" ${o}/><rect x="12.5" y="8" width="5" height="5" fill="#FFE9A0" ${o}/>`,
  season: `<circle cx="12" cy="10" r="6.5" fill="#FFC233" ${O}/><path d="M8.5 15l-2 6l3.2-1.8L12 21l1-5.5M15.5 15l2 6l-3.2-1.8" fill="#D93A3A" ${o}/><path d="M12 6.5l1.1 2.3l2.5.3l-1.8 1.7l.5 2.5L12 12l-2.3 1.3l.5-2.5l-1.8-1.7l2.5-.3z" fill="#FFF4DC"/>`,
  medal: `<path d="M7 2.5h4l2 5H9zM17 2.5h-4l-2 5h4z" fill="#1F6FE0" ${o}/><circle cx="12" cy="14.5" r="6.5" fill="#FFD84A" ${O}/><circle cx="12" cy="14.5" r="3.5" fill="#FFC233" ${o}/>`,
  decor: `<path d="M12 2.5l5 9H7z" fill="#D93A3A" ${O}/><circle cx="12" cy="13" r="3" fill="#F3C9A8" ${o}/><path d="M8 21c0-3 1.5-5.5 4-5.5s4 2.5 4 5.5z" fill="#1F6FE0" ${O}/><path d="M9.5 15.5c1 1.8 4 1.8 5 0" fill="#FFF4DC" ${o}/>`,
  home: `<path d="M3 11.5L12 4l9 7.5" fill="none" ${O}/><path d="M5.5 10v10.5h13V10L12 4.5z" fill="#F2EAD8" ${O}/><rect x="10" y="14" width="4" height="6.5" fill="#B08458" ${o}/><path d="M3 11.5L12 4l9 7.5v-2L12 2.5L3 9.5z" fill="#D93A3A" ${o}/>`,
  friends: `<circle cx="8.5" cy="8.5" r="3.2" fill="#F3C9A8" ${o}/><circle cx="15.5" cy="8.5" r="3.2" fill="#C98E6A" ${o}/><path d="M2.5 20c.5-3.5 3-5.5 6-5.5s5.5 2 6 5.5z" fill="#1F6FE0" ${o}/><path d="M9.5 20c.5-3.5 3-5.5 6-5.5s5.5 2 6 5.5z" fill="#D6336C" ${o}/>`,
  festival: `<path d="M4 20l5-14l9 9z" fill="#FFC233" ${O}/><path d="M6.5 13l4.5 4.5M8 9l7 7" stroke="#D93A3A" stroke-width="1.8"/><circle cx="16" cy="4.5" r="1.4" fill="#D6336C"/><circle cx="20" cy="8.5" r="1.4" fill="#1F6FE0"/><circle cx="19" cy="3.5" r="1" fill="#2FB463"/>`,
  camera: `<rect x="3" y="7" width="18" height="13" rx="2.5" fill="#3A2416" ${O}/><path d="M8 7l1.5-3h5L16 7" fill="#6B4A2B" ${o}/><circle cx="12" cy="13.5" r="4" fill="#9DD3FF" ${O}/><circle cx="17.8" cy="9.8" r="1" fill="#FFD84A"/>`,
  rebirth: `<path d="M12 4a8 8 0 1 1-7.4 5" fill="none" stroke="#4A2E1A" stroke-width="3.6" stroke-linecap="round"/><path d="M12 4a8 8 0 1 1-7.4 5" fill="none" stroke="#2FB463" stroke-width="1.8" stroke-linecap="round"/><path d="M3 5l1.6 4.5L9 8" fill="none" ${O}/><path d="M12 9l1 2l2.2.3l-1.6 1.5l.4 2.2l-2-1l-2 1l.4-2.2l-1.6-1.5L11 11z" fill="#FFD84A" ${o}/>`,
  more: `<rect x="3" y="3" width="7.5" height="7.5" rx="2" fill="#1F6FE0" ${o}/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2" fill="#2FB463" ${o}/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2" fill="#FFC233" ${o}/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" fill="#D6336C" ${o}/>`,
  acorn: `<path d="M6.5 11c0 5 2.5 9.5 5.5 9.5s5.5-4.5 5.5-9.5z" fill="#C98E3A" ${O}/><path d="M5 11c0-3 3-5.5 7-5.5s7 2.5 7 5.5z" fill="#7A5434" ${O}/><path d="M12 5.5V3" ${O}/>`,
  ticket: `<path d="M3 7.5h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z" fill="#D6336C" ${O}/><path d="M9 8v8" stroke="#FFF4DC" stroke-width="1.6" stroke-dasharray="1.6 1.6"/><path d="M14.5 10.2l.8 1.6l1.7.2l-1.3 1.2l.4 1.7l-1.6-.9l-1.6.9l.4-1.7l-1.3-1.2l1.7-.2z" fill="#FFD84A"/>`,
  sound: `<path d="M3.5 9h4l5-4.5v15l-5-4.5h-4z" fill="#FFC233" ${O}/><path d="M16 8.5c1.6 1.6 1.6 5.4 0 7M18.5 6c3 3 3 9 0 12" fill="none" ${O}/>`,
  balloon: `<path d="M12 2.5c4.4 0 7.5 3.4 7.5 7.4c0 3.8-3.6 7-6 8.1h-3c-2.4-1.1-6-4.3-6-8.1c0-4 3.1-7.4 7.5-7.4z" fill="#D93A3A" ${O}/><path d="M12 2.5c-2 2.2-2.6 5-2.4 7.6c.2 3 1.2 6 1.9 7.9M12 2.5c2 2.2 2.6 5 2.4 7.6c-.2 3-1.2 6-1.9 7.9" fill="#FFC233" ${o}/><rect x="9.5" y="19" width="5" height="3" rx="1" fill="#B08458" ${o}/>`,
  wave: `<path d="M8.5 20.5c-2-1.5-3.5-4-3.5-7V8.5a1.5 1.5 0 0 1 3 0V12V5.5a1.5 1.5 0 0 1 3 0V11V4a1.5 1.5 0 0 1 3 0v7V5.5a1.5 1.5 0 0 1 3 0v8c0 3.5-2 6-4 7z" fill="#E9B48F" ${O}/>`,
};

// ---- Mihao pass: cat-themed icons, then recolour and square off everything -----------------------------
const catHead = (hat = false) =>
  `<path d="M4 4l4 3h8l4-3v9H4z" fill="#E9A23E" ${O}/><rect x="4" y="7" width="16" height="13" fill="#E9A23E" ${O}/>` +
  `<rect x="6.5" y="10" width="3.5" height="4" fill="#FFD23F" ${o}/><rect x="8" y="10.4" width="1" height="3.2" fill="#111111"/>` +
  `<rect x="14" y="10" width="3.5" height="4" fill="#FFD23F" ${o}/><rect x="15.5" y="10.4" width="1" height="3.2" fill="#111111"/>` +
  `<rect x="8.5" y="15" width="7" height="4" fill="#FFF3DE" ${o}/><rect x="11" y="15" width="2" height="1.4" fill="#E9788A"/>` +
  (hat ? `<rect x="3.5" y="3.2" width="17" height="4" fill="#4A2E1A"/><rect x="8.5" y="0.8" width="7" height="3" fill="#B3181B" ${o}/><circle cx="12" cy="5.2" r="1.1" fill="#E8B53A"/>` : '');
Object.assign(ICONS, {
  coin: `<path d="M8 2.5h8l5.5 5.5v8L16 21.5H8L2.5 16V8z" fill="#FFC233" ${O}/><path d="M7.5 9.5l1.2-3.2l2.3 3zM16.5 9.5l-1.2-3.2l-2.3 3z" fill="#E9A23E" ${o}/><rect x="7.5" y="9.5" width="9" height="7" fill="#E9A23E" ${o}/><rect x="9" y="11.5" width="2" height="2" fill="#111111"/><rect x="13" y="11.5" width="2" height="2" fill="#111111"/><rect x="11" y="14.2" width="2" height="1.2" fill="#E9788A"/>`,
  mgrd: catHead(true),
  user: catHead(false),
  room: `<g transform="translate(-1.5 4) scale(.62)">${catHead(false)}</g><g transform="translate(10 4) scale(.62)">${catHead(true)}</g><path d="M3 20.5h18" ${O}/>`,
  friends: `<g transform="translate(-1.5 4) scale(.62)">${catHead(true)}</g><g transform="translate(10 4) scale(.62)">${catHead(false)}</g><path d="M3 20.5h18" ${O}/>`,
});

const PALETTE = {
  '#4A2E1A': '#17120F', '#FFF4DC': '#FFF3D6',
  '#FFC233': '#F2B632', '#FFD84A': '#FFD24A',
  '#D93A3A': '#C8202A', '#D6336C': '#C8202A', '#E85A8A': '#E0443E', '#FFC0D4': '#FF9A8A', '#FFC0C0': '#FF9A8A',
  '#1F6FE0': '#2A4FA0', '#3D6EA8': '#2A4FA0',
  '#7C3AED': '#8E1118', '#A77BF5': '#C8433F', '#5B21B6': '#5E0B10', '#B9A6F2': '#C8433F',
  '#4CAF50': '#3FB05A', '#2FB463': '#2E9B5E',
  '#E9B48F': '#E9A23E', '#F3C9A8': '#E9A23E', '#C98E6A': '#C9822A', '#F3C9A8': '#E9A23E',
};
for (const [id, svg] of Object.entries(ICONS)) {
  ICONS[id] = svg
    .replace(/#[0-9A-Fa-f]{6}/g, (c) => PALETTE[c.toUpperCase()] ?? c)
    .replace(/stroke-linejoin="round"/g, 'stroke-linejoin="miter"')
    .replace(/stroke-linecap="round"/g, 'stroke-linecap="square"')
    .replace(/<rect([^>]*?) rx="[\d.]+"/g, '<rect$1');
}

// ---- The Mihao meme face, matching the player: pale ginger, deadpan stare, white brows, long thin moustache -----
const INK = '#17120F', GINGER = '#EDA650', FUR_DARK = '#C9772A', CREAM = '#FFF0D8';
const at = (x, y, s, inner) => `<g transform="translate(${x} ${y}) scale(${s})">${inner}</g>`;
const hair = (d, w = 1.5) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w + 1.2}" stroke-linecap="round"/><path d="${d}" fill="none" stroke="#FFFFFF" stroke-width="${w}" stroke-linecap="round"/>`;
const lid = (x) => `<path d="M${x - 1.9} -2.3h3.8c-.2 1.5-.9 2.3-1.9 2.3s-1.7-.8-1.9-2.3z" fill="${INK}"/>`;
/** Just the features, to put on any object: the thing itself becomes a Mihao. (x, y) is between the eyes and nose. */
const mug = (x, y, s) => at(x, y, s,
  lid(-3.3) + lid(3.3) +
  hair('M-1.5 -3.6Q-4 -5.8-7 -3.2') + hair('M1.5 -3.6Q4 -5.8 7 -3.2') +
  `<path d="M-2 3.4h4L0 9.6z" fill="#FFFFFF" stroke="${INK}" stroke-width=".8" stroke-linejoin="round"/>` +
  hair('M-.5 2.5C-3.6 1.4-5.6 3.6-5.6 8.8') + hair('M.5 2.5C3.6 1.4 5.6 3.6 5.6 8.8') +
  `<path d="M-1.3 .8h2.6L0 2.4z" fill="#E9788A" stroke="${INK}" stroke-width=".6" stroke-linejoin="round"/>`);
/** Cat ears to sit on top of a round or square badge. */
const ears = (cx, y, half, color = GINGER) => [-1, 1].map((k) => `<path d="M${cx + k * half} ${y + 4}L${cx + k * (half + .3)} ${y - 1.6}L${cx + k * (half - 4.4)} ${y + 1.4}Z" fill="${color}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>`).join('');
/** The whole head. */
const mihao = (x, y, s, { hat = false, coat = null } = {}) => at(x, y, s,
  (coat ? `<path d="M-8.5 11.5c.4-4.5 3.8-6 8.5-6s8.1 1.5 8.5 6z" fill="${coat}" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/>` : '') +
  [-1, 1].map((k) => `<path d="M${k * 8.6} -1.5L${k * 8} -11L${k * 2} -6.6Z" fill="${GINGER}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/><path d="M${k * 7.2} -3.6L${k * 7} -8.4L${k * 3.8} -6.2Z" fill="#F2A8A0"/>`).join('') +
  `<ellipse cx="0" cy="0" rx="9.4" ry="8" fill="${GINGER}" stroke="${INK}" stroke-width="1.6"/>` +
  `<path d="M-2.6 -7.4l.4 2.6M0 -7.8v3M2.6 -7.4l-.4 2.6" stroke="${FUR_DARK}" stroke-width="1.1" stroke-linecap="round"/>` +
  `<ellipse cx="0" cy="3.4" rx="5" ry="3.4" fill="${CREAM}"/>` + mug(0, .9, .94) +
  (hat ? `<path d="M-8.6 -5.6h17.2v-1.9H-8.6z" fill="${INK}"/><path d="M-5.6 -7.2c.4-3.6 2.8-5 5.6-5s5.2 1.4 5.6 5z" fill="${INK}"/><circle cx="0" cy="-12.6" r="1.7" fill="#C8202A" stroke="${INK}" stroke-width=".8"/><circle cx="0" cy="-8.8" r="1.2" fill="#F2B632"/>` : ''));

const base = { ...ICONS };
// things that become a Mihao by getting its face
const faces = {
  seeds: [12, 12.6, .68], garden: [12, 16, .48], sell: [12, 13, .68], shop: [12, 15.4, .54], gift: [12, 13, .64],
  basket: [12, 14.4, .56], lock: [12, 14.8, .52], harvest: [12, 11.6, .78], egg: [12, 11.8, .72], acorn: [12, 14.4, .54],
  balloon: [12, 9.4, .74], gem: [12, 9.6, .54], star: [12, 11.6, .54], xp: [12, 11.6, .54], like: [12, 10.4, .72],
  timer: [12, 12.6, .64], storm: [11.6, 8.8, .54], rain: [12, 10, .56], sunny: [12, 11.6, .5], shovel: [12, 15.6, .48],
  water: [9.8, 14, .46], growJuice: [12, 14.8, .46], mysteryBox: [12, 13.6, .54], rainJar: [12, 13, .5],
  magnifier: [10, 9.6, .5], decor: [12, 12.4, .46], sound: [8.4, 11.4, .4], capyHorn: [10.6, 11.4, .46],
};
for (const [id, spot] of Object.entries(faces)) ICONS[id] = base[id] + mug(...spot);
// round badges and tiles get cat ears
for (const [id, y, half, color] of [['close', 3.6, 8, '#C8202A'], ['check', 3.6, 8, '#2E9B5E'], ['back', 3.6, 8, '#FFF3D6'], ['online', 4.6, 7, '#2E9B5E'], ['offline', 4.6, 7, '#C8202A'], ['connecting', 4.6, 7, '#F2B632'], ['settings', 6.4, 6, GINGER], ['expand', 3.4, 8, GINGER], ['album', 2.6, 7, GINGER], ['board', 4, 9, GINGER]]) ICONS[id] = ears(12, y, half, color) + base[id];

const paw = (x, y, s, rot = 0) => at(x, y, s, `<g transform="rotate(${rot})"><rect x="-6" y="-3" width="12" height="11" rx="5.5" fill="${CREAM}" stroke="${INK}" stroke-width="1.8"/>` + [-5.2, -1.8, 1.8, 5.2].map((x2, i) => `<circle cx="${x2}" cy="${i === 0 || i === 3 ? -3.6 : -6.2}" r="2.2" fill="${CREAM}" stroke="${INK}" stroke-width="1.5"/>`).join('') + `<ellipse cx="0" cy="3" rx="3.2" ry="2.6" fill="#F2A8A0"/></g>`);
const sticker = (inner) => `<path d="M7 2.5h10l4.5 4.5v10L17 21.5H7L2.5 17V7z" fill="#F2B632" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>${inner}`;
Object.assign(ICONS, {
  coin: `<circle cx="12" cy="12" r="10.4" fill="#F2B632" stroke="${INK}" stroke-width="1.8"/><circle cx="12" cy="12" r="8.2" fill="#FFD24A"/>` + mihao(12, 12.6, .68),
  mgrd: `<circle cx="12" cy="12" r="11" fill="#5DBB46" stroke="${INK}" stroke-width="1.6"/>` + mihao(12, 13.6, .74, { hat: true }),
  user: mihao(12, 12.4, 1.04),
  room: mihao(6.8, 14.6, .62, { coat: '#2A4FA0' }) + mihao(17.2, 14.6, .62, { coat: '#C8202A' }) + mihao(12, 9.4, .64, { hat: true }),
  friends: mihao(7.4, 11.4, .7, { coat: '#C8202A' }) + mihao(16.8, 13.2, .7, { coat: '#2E9B5E' }),
  chat: `<path d="M3.5 3.5h17a1.5 1.5 0 0 1 1.5 1.5v11.5a1.5 1.5 0 0 1-1.5 1.5H11l-5 4v-4H3.5A1.5 1.5 0 0 1 2 16.500V5a1.5 1.5 0 0 1 1.500-1.500z" fill="#FFFFFF" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>` + mihao(12, 11.6, .6),
  camera: `<rect x="2" y="6.5" width="20" height="14.500" rx="2" fill="#C8202A" stroke="${INK}" stroke-width="1.8"/><path d="M7.500 6.500L9 3.500h6l1.500 3z" fill="#F2B632" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="13.600" r="5.800" fill="#FFF3D6" stroke="${INK}" stroke-width="1.600"/>` + mihao(12, 14.2, .46) + `<rect x="18.200" y="8.400" width="2.200" height="1.800" fill="#FFD24A"/>`,
  more: base.more.replace(/<rect x="3" y="3"[^>]*\/>/, '') + mihao(6.8, 7.4, .46),
  home: base.home + mug(12, 13.6, .46),
  medal: base.medal + mihao(12, 15, .46),
  season: base.season + mihao(12, 10.6, .46),
  rebirth: base.rebirth.replace(/<path d="M12 9l1 2[^>]*\/>/, '') + mihao(12.2, 12.8, .5, { hat: true }),
  quests: `<path d="M4.500 4h13v15.500a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="#FFF3D6" stroke="${INK}" stroke-width="1.800" stroke-linejoin="round"/><path d="M5.500 8.500h9M5.500 11.500h6M5.500 14.500h4" stroke="${INK}" stroke-width="1.600" stroke-linecap="round"/>` + mihao(16.2, 15.8, .56),
  map: base.map + mihao(16.8, 15.6, .48),
  paw: paw(12, 12.6, 1.1),
  wave: paw(12, 13, 1.05, -22) + `<path d="M19 4.500c1.600 1 2.500 2.500 2.600 4.300M17.800 1.800c2.400 1.200 4 3.400 4.300 6" fill="none" stroke="${INK}" stroke-width="1.500" stroke-linecap="round"/>`,
  pointer: paw(12, 12, 1.05, 180),
  night: base.night + `<path d="M7.200 12.500q1.600 1.600 3.200 0" fill="none" stroke="${INK}" stroke-width="1.300" stroke-linecap="round"/>` + hair('M10 16.500C8 16 6.800 17.500 7 20.500', 1) + hair('M11.200 16.500c1.800-.4 3.200 1 3 3.500', 1),
  festival: base.festival + mihao(17, 15.6, .46),
  ticket: sticker(mihao(12, 13, .64, { hat: true })).replace('fill="#F2B632"', 'fill="#C8202A"'),
});

// the rest: a Mihao rides along in the corner, or replaces the part that can be a head
const rider = (id, x = 17.2, y = 16.2, s = .52) => { ICONS[id] = base[id] + mihao(x, y, s); };
for (const id of ['plant', 'growAll', 'bubbleSprinkler', 'rocketSprinkler', 'trowel']) rider(id);
rider('sparkle', 7, 17, .5); rider('stars', 7.2, 16.6, .54); rider('heatwave', 17.4, 8.4, .56); rider('menu', 17.6, 16.8, .5);
ICONS.oopsShovel = base.oopsShovel + mug(12, 14.6, .46);
ICONS.frosty = base.frosty + mihao(12, 12.6, .56);
ICONS.key = base.key.replace(/<circle[^>]*\/>/g, '') + mihao(8, 12.4, .68);
ICONS.warning = ears(12, 2.4, 4.6) + base.warning;
ICONS.night = base.night + mihao(8.6, 13.4, .6);
