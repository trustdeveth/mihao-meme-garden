// Sessions, guest names, WebSocket tickets, rate limits and the chat filter.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const token = (bytes = 32) => randomBytes(bytes).toString('base64url');

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function recoveryCode() {
  const b = randomBytes(12);
  let s = '';
  for (let i = 0; i < 12; i++) s += ALPHA[b[i] % ALPHA.length];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}
export const normalizeRecovery = (c) => String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const ADJ = ['Plucky', 'Sunny', 'Jolly', 'Breezy', 'Zesty', 'Cheeky', 'Dewy', 'Merry', 'Snappy', 'Fuzzy', 'Peppy', 'Bouncy', 'Witty', 'Cozy', 'Spry', 'Mellow'];
const NOUN = ['Radish', 'Turnip', 'Sprout', 'Pumpkin', 'Clover', 'Acorn', 'Tomato', 'Beanpole', 'Parsnip', 'Melon', 'Pepper', 'Daisy', 'Thistle', 'Mango', 'Kiwi', 'Fern'];
export function guestName() {
  const b = randomBytes(3);
  return `${ADJ[b[0] % ADJ.length]} ${NOUN[b[1] % NOUN.length]} ${100 + (b[2] % 900)}`;
}

/** Short-lived signed WebSocket ticket: base64url(pid.exp.nonce).sig */
export function makeTicket(secret, pid, now, ttlMs = 30_000) {
  const body = Buffer.from(`${pid}.${now + ttlMs}.${token(9)}`).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}
export function readTicket(secret, ticket, now) {
  const [body, sig] = String(ticket ?? '').split('.');
  if (!body || !sig) return null;
  const want = createHmac('sha256', secret).update(body).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const [pid, exp] = Buffer.from(body, 'base64url').toString().split('.');
  if (!pid || !(Number(exp) > now)) return null;
  return { pid };
}

/** Token bucket: `rate` tokens per second, up to `burst`. */
export class Bucket {
  constructor(rate, burst) { this.rate = rate; this.burst = burst; this.tokens = burst; this.at = 0; }
  take(now, n = 1) {
    if (this.at) this.tokens = Math.min(this.burst, this.tokens + ((now - this.at) / 1000) * this.rate);
    this.at = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

// A small word list; replace with a maintained list before public launch.
const BLOCKED = ['fuck', 'shit', 'bitch', 'cunt', 'nigger', 'faggot', 'retard', 'whore', 'slut', 'dick', 'pussy', 'asshole'];
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i' };
const fold = (s) => s.toLowerCase().replace(/[013457@$!]/g, (c) => LEET[c] ?? c).replace(/(.)\1+/g, '$1');

// Control, zero-width and bidi characters (built from code points so the source stays plain ASCII).
const INVISIBLE = new RegExp(`[${[[0x00, 0x1f], [0x7f, 0x7f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff]]
  .map(([a, b]) => String.fromCharCode(a) + '-' + String.fromCharCode(b)).join('')}]`, 'g');

/** Normalize and filter a chat line. Returns null when nothing is left. */
export function cleanChat(text) {
  let s = String(text ?? '').normalize('NFKC');
  s = s.replace(INVISIBLE, '');
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  s = s.slice(0, 140);
  s = s.replace(/\b(?:https?:\/\/|www\.)\S+|\b\S+\.(?:com|net|org|io|gg|xyz|ru|cn)\b\S*/gi, '[link]');
  s = s.split(' ').map((w) => (BLOCKED.some((b) => fold(w).includes(b)) ? '*'.repeat(Math.min(w.length, 6)) : w)).join(' ');
  return s;
}
