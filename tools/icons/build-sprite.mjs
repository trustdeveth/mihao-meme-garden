// Validates the icon set against the style rules and writes client/public/icons/sprite.svg.
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ICONS } from './icons.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const errors = [];
for (const [id, svg] of Object.entries(ICONS)) {
  if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(id)) errors.push(`${id}: bad id`);
  if (!svg.includes('#17120F')) errors.push(`${id}: missing the near-black outline`);
  if (/[^\x00-\x7F]/.test(svg)) errors.push(`${id}: non-ASCII characters (no emoji or symbol glyphs)`);
  if (/<text|<image|href=/.test(svg)) errors.push(`${id}: icons must be drawn shapes only`);
  const fills = new Set([...svg.matchAll(/fill="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1].toUpperCase()));
  if (fills.size < 1) errors.push(`${id}: needs at least one fill colour`);
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
const symbols = Object.entries(ICONS).map(([id, svg]) => `<symbol id="${id}" viewBox="0 0 24 24">${svg}</symbol>`).join('\n');
const out = resolve(ROOT, 'client/public/icons/sprite.svg');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n${symbols}\n</svg>\n`);
console.log(`sprite.svg: ${Object.keys(ICONS).length} icons`);
