// Posting to X. The game makes the meme picture and opens X with the words filled in. X's post link cannot carry
// a file, so on a computer the picture is put online on the game's server and its link goes in the post: X shows
// it as a large preview. (Phones share the file itself.) The player always presses Post. Nothing is posted
// automatically or rewarded, and no X account, key or login is ever handled by the game.
import { CHALLENGE_TAG } from '@mg/shared/data/memes';

export const CAPTIONS = [
  'any last words?', 'mihao', 'me checking my garden at 3am', 'the official has arrived',
  'this harvest is very mihao', 'my beard is longer than yours', 'not very mihao of you', 'i am inspecting your carrots',
];
export const STYLES = [['classic', 'Classic meme'], ['bubble', 'White bar'], ['fried', 'Deep fried'], ['crusty', 'Old and crusty']];
const WIDTH = 1200;

function lines(g, text, max) {
  const out = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && g.measureText(next).width > max) { out.push(line); line = word; } else line = next;
  }
  if (line) out.push(line);
  return out.slice(0, 5);
}

/** A meme picture made from a game screenshot: a caption in one of a few classic styles. */
export function memeCard(shot, caption, style) {
  const w = Math.min(WIDTH, shot.width), h = Math.round((w * shot.height) / shot.width);
  const size = Math.round(w / 15);
  const text = caption.trim().toUpperCase();
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = style === 'bubble' ? `700 ${Math.round(size * 0.72)}px "Baloo 2", Arial, sans-serif` : style === 'crusty' ? `400 ${size}px Papyrus, "Times New Roman", serif` : `400 ${size}px Impact, "Arial Black", sans-serif`;
  g.font = font;
  const rows = text ? lines(g, style === 'bubble' || style === 'crusty' ? caption.trim() : text, w * 0.92) : [];
  const bar = style === 'bubble' && rows.length ? Math.round(rows.length * size * 0.92 + size * 0.7) : 0;
  c.width = w; c.height = h + bar;

  if (style === 'crusty') { // shrunk and blown up again, like a picture that has been saved too many times
    const small = document.createElement('canvas');
    small.width = Math.round(w / 3.2); small.height = Math.round(h / 3.2);
    small.getContext('2d').drawImage(shot, 0, 0, small.width, small.height);
    if ('filter' in g) g.filter = 'saturate(.8) contrast(.92) brightness(1.08)';
    g.drawImage(small, 0, 0, w, h);
  } else {
    if (style === 'fried' && 'filter' in g) g.filter = 'saturate(2.7) contrast(1.55) brightness(1.06)';
    g.drawImage(shot, 0, bar, w, h);
  }
  g.filter = 'none';
  if (style === 'fried') { // grain and a hot glow
    for (let i = 0; i < (w * h) / 240; i++) { g.fillStyle = i % 2 ? 'rgba(255,255,255,.16)' : 'rgba(60,10,0,.2)'; g.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
    const glow = g.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, w * 0.7);
    glow.addColorStop(0, 'rgba(255,200,0,0)'); glow.addColorStop(1, 'rgba(255,60,0,.38)');
    g.fillStyle = glow; g.fillRect(0, 0, w, h);
  }

  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'top';
  g.lineJoin = 'round';
  if (bar) { g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, w, bar); }
  rows.forEach((row, i) => {
    if (style === 'bubble') { g.fillStyle = '#17120F'; g.fillText(row, w / 2, size * 0.3 + i * size * 0.92); return; }
    const y = size * 0.35 + i * size * 1.08;
    if (style === 'crusty') return; // drawn below, down the left side so it never covers the face
    g.lineWidth = size / 6; g.strokeStyle = '#000000'; g.strokeText(row, w / 2, y);
    g.fillStyle = style === 'fried' ? '#FFF35C' : '#FFFFFF'; g.fillText(row, w / 2, y);
  });
  if (style === 'crusty' && rows.length) {
    g.textAlign = 'left';
    g.fillStyle = '#0D0D0D';
    g.shadowColor = 'rgba(255,255,255,.85)'; g.shadowBlur = size / 5;
    lines(g, caption.trim(), w * 0.27).forEach((row, i) => g.fillText(row, size * 0.45, h * 0.36 + i * size * 1.15));
    g.shadowBlur = 0;
  }
  return c;
}

/** The game's public address, added to posts. Local test addresses are left out: nobody else can open them. */
export function shareLink(loc = location, configured = import.meta.env?.VITE_SHARE_URL) {
  if (configured) return configured;
  const local = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/.test(loc.hostname);
  return !local && loc.protocol === 'https:' ? loc.origin : '';
}
export const postText = (caption) => [caption.trim() || 'mihao', CHALLENGE_TAG, shareLink()].filter(Boolean).join(' ');
export const intentUrl = (text) => `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`;

const phone = () => matchMedia('(pointer: coarse)').matches;
/** Phones can hand the picture or clip straight to the X app through their own share menu. */
export function canShareFile(file) {
  try { return phone() && !!navigator.canShare?.({ files: [file] }); } catch { return false; }
}
/** X shows large previews about 1.91 wide for every 1 tall, and cuts off whatever does not fit. */
export const CARD = { w: 1200, h: 628 };
/** The whole picture, fitted inside X's preview shape so the words are never cut off. The sides are filled with a blur of it. */
export function previewShape(picture) {
  const c = document.createElement('canvas');
  c.width = CARD.w; c.height = CARD.h;
  const g = c.getContext('2d');
  g.fillStyle = '#17120F';
  g.fillRect(0, 0, c.width, c.height);
  const cover = Math.max(CARD.w / picture.width, CARD.h / picture.height);
  if ('filter' in g) {
    g.filter = 'blur(22px) brightness(.55)';
    g.drawImage(picture, (CARD.w - picture.width * cover) / 2, (CARD.h - picture.height * cover) / 2, picture.width * cover, picture.height * cover);
    g.filter = 'none';
  }
  const fit = Math.min(CARD.w / picture.width, CARD.h / picture.height);
  g.drawImage(picture, (CARD.w - picture.width * fit) / 2, (CARD.h - picture.height * fit) / 2, picture.width * fit, picture.height * fit);
  return c;
}

/** The picture as a JPEG small enough to upload. */
async function jpegOf(canvas) {
  for (const quality of [0.9, 0.75, 0.6]) {
    const blob = await new Promise((done) => canvas.toBlob(done, 'image/jpeg', quality));
    if (blob && blob.size < 1_400_000) return blob;
  }
  throw new Error('The picture is too big to share.');
}
/** Put the picture on the game's server. Resolves to {url, public}; public is false where X cannot reach it. */
export async function uploadPicture(canvas) {
  const r = await fetch('/api/share', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'image/jpeg' }, body: await jpegOf(previewShape(canvas)), signal: AbortSignal.timeout(20_000) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? 'The picture could not be put online.');
  return data;
}
/**
 * The post with the picture's link last (X previews the last link). The plain game link is dropped, since the
 * picture's page links to the game, and the words are shortened if needed to fit (X counts a link as 23).
 */
export function textWithPicture(words, url, home = shareLink()) {
  let text = home ? words.split(home).join('') : words;
  text = text.replace(/[ \t]{2,}/g, ' ').trim();
  if (text.length > 256) text = `${text.slice(0, 255).trimEnd()}\u2026`;
  return `${text} ${url}`.trim();
}
/**
 * Open the X tab during the click (browsers block tabs opened later), then send it to X when the words are ready.
 * Returns null if the browser blocked the tab.
 */
export function reserveTab() {
  const tab = window.open('', '_blank');
  if (!tab) return null;
  try { tab.opener = null; tab.document.title = 'Opening X'; tab.document.body.textContent = 'Putting your picture online...'; } catch { /* some browsers do not let us write in it */ }
  return tab;
}
/** Open X with the words filled in. Returns false if the browser blocked the new tab. */
export function openX(text) {
  const w = window.open(intentUrl(text), '_blank');
  if (w) w.opener = null;
  return !!w;
}
export async function copyPicture(blob) {
  try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); return true; } catch { return false; }
}
