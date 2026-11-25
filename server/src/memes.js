// Meme layer on the server: speech bubbles and moments (picked from fixed lists), Beard Battle and Pointing
// Contest between two players (or against Gus), and the Meme Point awards. Cosmetic only.
import { randomInt, randomUUID } from 'node:crypto';
import { LINES, MOMENTS, DUEL } from '@mg/shared/data/memes';
import { awardMeme } from '@mg/shared/rules/memes';
import { STALLS, dist } from '@mg/shared/world/village-layout';
import { Bucket } from './security.js';

const send = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };
export const BOT_SLOT = -1;
const BEARD_MS = 2_600;

/** Give Meme Points to an online member and tell their client. */
export function giveMeme(member, kind, now) {
  const got = awardMeme(member.state, kind, now);
  if (got) { member.dirty = true; send(member.ws, { t: 'sync', d: { meme: member.state.meme } }); }
  return got;
}

export class MemeRoom {
  constructor(room, timing = {}) {
    this.room = room;
    this.timing = timing; // tests shorten the waits
    this.invites = new Map(); // target pid -> {from, kind, until}
    this.duels = new Map(); // duel id -> duel
  }

  now() { return this.room.mgr.now(); }
  memberAt(slot) { const pid = this.room.slots[slot]; return pid ? this.room.members.get(pid) : null; }
  busy(m) { return [...this.duels.values()].some((d) => d.a === m || d.b === m); }

  onMessage(m, msg) {
    m.buckets.meme ??= new Bucket(1, 6);
    // a tap in a Pointing Contest is never rate limited away: only one per duel counts
    if (msg.k === 'tap') return this.tap(m, String(msg.duel ?? ''));
    if (!m.buckets.meme.take(this.now())) return undefined;
    if (msg.k === 'say') {
      const i = Number(msg.i);
      if (Number.isInteger(i) && i >= 0 && i < LINES.length) this.room.broadcast({ t: 'meme', k: 'say', slot: m.slot, i }, m);
    } else if (msg.k === 'moment') {
      const id = String(msg.id ?? '');
      if (Object.hasOwn(MOMENTS, id)) this.room.broadcast({ t: 'meme', k: 'moment', slot: m.slot, id }, m);
    } else if (msg.k === 'duel') this.invite(m, String(msg.kind ?? ''), Number(msg.slot));
    else if (msg.k === 'accept') this.answer(m, true);
    else if (msg.k === 'decline') this.answer(m, false);
    return undefined;
  }

  tell(m, text, kind = 'bad') { send(m.ws, { t: 'toast', msg: text, kind }); }

  invite(m, kind, slot) {
    if (!Object.hasOwn(DUEL.kinds, kind)) return;
    const now = this.now();
    if (this.busy(m)) return this.tell(m, 'Finish your contest first.');
    if (now < (m.duelAt ?? 0)) return this.tell(m, `Rest your beard for ${Math.ceil((m.duelAt - now) / 1000)}s.`);
    if (slot === BOT_SLOT) {
      const gus = STALLS.find((s) => s.id === 'market');
      if (dist(m.pos, gus) > gus.reach + 3) return this.tell(m, 'Walk up to Gus at the Market first.');
      return this.start(kind, m, null);
    }
    const other = this.memberAt(slot);
    if (!other || other === m || !other.ws) return this.tell(m, 'That player is not here.');
    if (dist(m.pos, other.pos) > DUEL.range) return this.tell(m, 'Walk a little closer to them.');
    if (this.busy(other)) return this.tell(m, `${other.name} is busy.`);
    const pending = this.invites.get(other.pid);
    if (pending && pending.until > now) return this.tell(m, `${other.name} already has an invite.`);
    m.duelAt = now + DUEL.inviteMs; // one invite at a time
    this.invites.set(other.pid, { from: m, kind, until: now + DUEL.inviteMs });
    send(other.ws, { t: 'duel', ev: 'invite', from: m.slot, name: m.name, kind, until: now + DUEL.inviteMs });
    return this.tell(m, `Challenge sent to ${other.name}.`, 'info');
  }

  answer(m, yes) {
    const inv = this.invites.get(m.pid);
    if (!inv) return;
    this.invites.delete(m.pid);
    const { from, kind, until } = inv;
    if (!yes) { this.tell(from, `${m.name} said not today.`, 'info'); return; }
    if (until < this.now() || this.room.members.get(from.pid) !== from || !from.ws) { this.tell(m, 'That challenge expired.'); return; }
    if (this.busy(from) || this.busy(m)) { this.tell(m, 'Someone is already in a contest.'); return; }
    this.start(kind, from, m);
  }

  later(d, ms, fn) {
    const t = setTimeout(() => { if (!this.room.mgr.closed && this.duels.get(d.id) === d) fn(); }, ms);
    t.unref?.();
    d.timers.push(t);
  }

  start(kind, a, b) {
    const d = { id: randomUUID().slice(0, 8), kind, a, b, go: false, timers: [] };
    this.duels.set(d.id, d);
    const now = this.now();
    for (const p of [a, b]) if (p) p.duelAt = now + DUEL.cooldownMs;
    this.room.broadcast({ t: 'duel', ev: 'start', id: d.id, kind, a: a.slot, b: b ? b.slot : BOT_SLOT });
    if (kind === 'beard') {
      this.later(d, this.timing.beardMs ?? BEARD_MS, () => {
        const va = randomInt(10, 100);
        let vb = randomInt(10, 99);
        if (vb >= va) vb += 1; // never a tie
        this.finish(d, va > vb ? a : b, { values: [va, vb] });
      });
      return;
    }
    const wait = this.timing.pointWaitMs ?? randomInt(DUEL.goMinMs, DUEL.goMaxMs);
    this.later(d, wait, () => {
      d.go = true;
      this.room.broadcast({ t: 'duel', ev: 'go', id: d.id });
      if (!d.b) this.later(d, this.timing.botTapMs ?? randomInt(420, 950), () => this.finish(d, null, { reason: 'faster' }));
      this.later(d, this.timing.windowMs ?? DUEL.windowMs, () => this.finish(d, undefined, { reason: 'nobody' }));
    });
  }

  tap(m, id) {
    const d = this.duels.get(id);
    if (!d || d.kind !== 'point' || (d.a !== m && d.b !== m)) return;
    if (!d.go) this.finish(d, d.a === m ? d.b : d.a, { reason: 'early' });
    else this.finish(d, m, { reason: 'faster' });
  }

  /** winner: a member, null for Gus, undefined for a draw. */
  finish(d, winner, extra = {}) {
    if (!this.duels.delete(d.id)) return;
    d.timers.forEach(clearTimeout);
    const slot = winner === undefined ? null : winner ? winner.slot : BOT_SLOT;
    this.room.broadcast({ t: 'duel', ev: 'result', id: d.id, kind: d.kind, a: d.a.slot, b: d.b ? d.b.slot : BOT_SLOT, winner: slot, ...extra });
    if (winner) giveMeme(winner, d.b ? 'duelWin' : 'duelWinBot', this.now());
  }

  /** A member left the room: drop their invites and contests. */
  leave(m) {
    this.invites.delete(m.pid);
    for (const [pid, inv] of this.invites) if (inv.from === m) this.invites.delete(pid);
    for (const d of [...this.duels.values()]) {
      if (d.a !== m && d.b !== m) continue;
      this.duels.delete(d.id);
      d.timers.forEach(clearTimeout);
      this.room.broadcast({ t: 'duel', ev: 'cancel', id: d.id });
    }
  }
}
