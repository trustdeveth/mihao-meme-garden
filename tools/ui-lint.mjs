// UI rules from gametokenomics.md 4.8-4.10: no emoji or symbol-glyph icons, no grey text, text >= 14px (13px on mobile).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (['.js', '.css', '.html'].includes(extname(p))) files.push(p); } };
walk(resolve(ROOT, 'client/src'));
files.push(resolve(ROOT, 'client/index.html'));
const ALLOWED = new Set(['\u00b2', '\u2019', '\u00b7']); // m², apostrophe, middle dot
const errors = [];
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((l, i) => {
    for (const ch of l) if (ch.codePointAt(0) > 126 && !ALLOWED.has(ch)) errors.push(`${f}:${i + 1} symbol/emoji character U+${ch.codePointAt(0).toString(16)} (use the icon sprite)`);
    if (extname(f) === '.css') {
      const fs = l.match(/font-size:\s*(\d+)px/);
      const mobile = lines.slice(0, i).some((x) => x.includes('@media')) ;
      const worldLabel = l.includes('/* world label');
      if (fs && Number(fs[1]) < (worldLabel ? 12 : mobile ? 13 : 14)) errors.push(`${f}:${i + 1} font-size ${fs[1]}px is below the minimum`);
      const c = l.match(/(?:^|[;{\s])color:\s*(#[0-9a-fA-F]{3,6}|gr[ae]y|silver)/);
      if (c) {
        const v = c[1].toLowerCase();
        const hex = v.startsWith('#') ? (v.length === 4 ? v.slice(1).split('').map((x) => x + x).join('') : v.slice(1)) : '888888';
        const [r, g, b] = [0, 2, 4].map((k) => parseInt(hex.slice(k, k + 2), 16));
        const sat = Math.max(r, g, b) - Math.min(r, g, b);
        const light = (r + g + b) / 3;
        if (sat < 18 && light > 70 && light < 200) errors.push(`${f}:${i + 1} grey text colour ${v}`);
      }
    }
  });
}
if (errors.length) { console.error(`UI lint failed (${errors.length}):\n  ${errors.join('\n  ')}`); process.exit(1); }
console.log(`UI lint OK (${files.length} files).`);
