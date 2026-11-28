// The admin cats, in the order of their numbers (1 is the first). Each id has a model in
// client/public/models/admins and a gift zip in output/gifts (see tools/models/admins).
export const ADMIN_CATS = Object.freeze([
  ['green-hoodie', 'Green Hoodie'], ['orange-bun', 'Orange Bun'], ['turban-cape', 'Turban Cape'], ['helmet-pilot', 'Helmet Pilot'],
  ['team-china', 'Team China'], ['lucky-dice', 'Lucky Dice'], ['thermal', 'Thermal Vision'], ['red-puffer', 'Red Puffer'],
  ['pink-hair', 'Pink Hair'], ['cinnamon-knight', 'Cinnamon Knight'], ['ansem', 'Ansem'],
].map(([id, name], i) => Object.freeze({ id, name, number: i + 1 })));

/** A cat from its number (4) or id ('helmet-pilot'); anything else gives null. */
export const adminCat = (key) => ADMIN_CATS.find((c) => c.id === key || c.number === key) ?? null;
