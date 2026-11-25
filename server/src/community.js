// $MGRD community features: holder votes, tips between players, gifts, the weekly Fireworks Pot, naming the
// village fountain, and the public burn record. Purchases (gift, pot, name) reuse the verified order flow in
// chain.js; tips are direct wallet-to-wallet transfers that the server checks on chain before announcing.
import { parseEventLogs } from 'viem';
import { TOKEN_ABI, toBase, toNumber } from '@mg/shared/chain/evm';
import { WEAR } from '@mg/shared/data/features';
import { holderTier, MGRD_POT, MGRD_NAME, MGRD_TIPS, MGRD_PER_GEM } from '@mg/shared/data/mgrd';
import { weekKey } from '@mg/shared/rules/state';
import { ownsWear } from '@mg/shared/rules/estate';
import { cleanChat } from './security.js';

export const POT_MGRD = MGRD_POT;
export const NAME_MGRD = MGRD_NAME;
export const NAME_DAYS = 7;
export const TIP_MGRD = MGRD_TIPS;
const VOTE_WEIGHT = { sprout: 1, bloom: 2, golden: 3 }; // tier-weighted: big holders count more, but not without limit

const SCHEMA = `
CREATE TABLE IF NOT EXISTS polls (id INTEGER PRIMARY KEY AUTOINCREMENT, question TEXT NOT NULL, options TEXT NOT NULL, created_at INTEGER NOT NULL, ends_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS votes (poll INTEGER NOT NULL, wallet TEXT NOT NULL, player_id TEXT NOT NULL, option INTEGER NOT NULL, weight INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(poll, wallet));
CREATE TABLE IF NOT EXISTS pot (week TEXT NOT NULL, player_id TEXT NOT NULL, amount TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS plaques (id INTEGER PRIMARY KEY AUTOINCREMENT, player_id TEXT NOT NULL, by_name TEXT NOT NULL, text TEXT NOT NULL, from_at INTEGER NOT NULL, until_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tips (signature TEXT PRIMARY KEY, from_pid TEXT NOT NULL, to_pid TEXT NOT NULL, amount TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS burns (signature TEXT PRIMARY KEY, amount TEXT NOT NULL, at INTEGER NOT NULL, note TEXT);
`;

export function registerCommunity(app, { db, rooms, need, now, config, conn, checkChain, wallet, holderOf, applyGrant, priceOf, onAnnounce }) {
  const sql = db.raw;
  sql.exec(SCHEMA);
  const q = {
    polls: sql.prepare('SELECT * FROM polls ORDER BY id DESC LIMIT 10'),
    poll: sql.prepare('SELECT * FROM polls WHERE id = ?'),
    tally: sql.prepare('SELECT option, SUM(weight) AS w, COUNT(*) AS n FROM votes WHERE poll = ? GROUP BY option'),
    myVote: sql.prepare('SELECT option FROM votes WHERE poll = ? AND (wallet = ? OR player_id = ?)'),
    vote: sql.prepare('INSERT INTO votes(poll, wallet, player_id, option, weight, at) VALUES(?, ?, ?, ?, ?, ?)'),
    potRows: sql.prepare('SELECT player_id, amount FROM pot WHERE week = ?'),
    potAdd: sql.prepare('INSERT INTO pot(week, player_id, amount, at) VALUES(?, ?, ?, ?)'),
    plaqueNow: sql.prepare('SELECT * FROM plaques WHERE from_at <= ? AND until_at > ? ORDER BY from_at LIMIT 1'),
    plaqueLast: sql.prepare('SELECT MAX(until_at) AS u FROM plaques'),
    plaqueAdd: sql.prepare('INSERT INTO plaques(player_id, by_name, text, from_at, until_at) VALUES(?, ?, ?, ?, ?)'),
    tipAdd: sql.prepare('INSERT INTO tips(signature, from_pid, to_pid, amount, at) VALUES(?, ?, ?, ?, ?)'),
    tipsTo: sql.prepare('SELECT amount FROM tips WHERE to_pid = ?'),
    burns: sql.prepare('SELECT * FROM burns ORDER BY at DESC LIMIT 20'),
    burnRows: sql.prepare('SELECT amount FROM burns'),
    lastBurn: sql.prepare('SELECT MAX(at) AS t FROM burns'),
    revenue: sql.prepare("SELECT amount FROM mgrd_orders WHERE status = 'fulfilled'"),
    name: sql.prepare('SELECT name FROM players WHERE id = ?'),
  };
  // amounts have 18 decimals, far past what SQLite can add up, so they are stored as text and summed here
  const sum = (rows) => rows.reduce((n, r) => n + BigInt(r.amount), 0n);
  const potOf = (week) => { const rows = q.potRows.all(week); return { total: sum(rows), givers: new Set(rows.map((r) => r.player_id)).size }; };
  const potGoal = toBase(config.potGoal ?? 100_000);
  const burnBps = BigInt(config.burnBps ?? 2_000);

  /** Purchases handled here (called from the shared quote flow in chain.js). */
  const purchases = {
    /** @returns {{ok:true, mgrd:number, name:string, item:string} | {ok:false, msg:string}} */
    price(p, kind, id, body) {
      if (kind === 'gift') {
        const w = WEAR[id];
        if (!w || !(w.mgrd || w.gems) || w.limited) return { ok: false, msg: 'That item cannot be gifted.' };
        const e = rooms.byPlayer.get(p.id);
        const toPid = e?.room.slots[Number(body?.to)];
        if (!toPid || toPid === p.id) return { ok: false, msg: 'Pick another gardener in your village.' };
        const st = rooms.byPlayer.get(toPid)?.member.state ?? db.loadState(toPid);
        if (st && ownsWear(st, id)) return { ok: false, msg: 'They already have that one.' };
        return { ok: true, mgrd: w.mgrd ?? w.gems * MGRD_PER_GEM, name: `Gift: ${w.name}`, item: `gift:${id}:${toPid}` };
      }
      if (kind === 'pot') {
        const amt = Number(id);
        if (!POT_MGRD.includes(amt)) return { ok: false, msg: 'Pick an amount.' };
        return { ok: true, mgrd: amt, name: 'Fireworks Pot', item: `pot:${weekKey(now())}:${amt}` };
      }
      if (kind === 'name') {
        const text = cleanChat(String(id)).slice(0, 24);
        if (text.length < 2) return { ok: false, msg: 'Pick a name (2 to 24 letters).' };
        return { ok: true, mgrd: NAME_MGRD, name: `Name the fountain "${text}"`, item: `name:${encodeURIComponent(text)}` };
      }
      return null;
    },
    /** Apply after the on-chain payment was verified. */
    grant(p, item, amount) {
      const [kind, a, b] = item.split(':');
      const t = now();
      if (kind === 'gift') {
        applyGrant(b, (s) => { s.wardrobe ??= []; if (!s.wardrobe.includes(a)) s.wardrobe.push(a); return { msg: '' }; });
        const to = rooms.byPlayer.get(b)?.member;
        if (to?.ws?.readyState === 1) to.ws.send(JSON.stringify({ t: 'toast', msg: `${p.name} sent you a gift: ${WEAR[a].name}! Find it in Your Farmer.` }));
        onAnnounce?.(p.id, `${p.name} gifted ${q.name.get(b)?.name ?? 'a friend'} the ${WEAR[a].name}!`);
        return `Gift sent: ${WEAR[a].name}!`;
      }
      if (kind === 'pot') {
        const before = potOf(a).total;
        q.potAdd.run(a, p.id, String(amount), t);
        const after = before + BigInt(amount);
        if (before < potGoal && after >= potGoal) onAnnounce?.(null, 'The Fireworks Pot is full! Fireworks over the village all week!');
        return 'Thank you! Your $MGRD is in the Fireworks Pot.';
      }
      if (kind === 'name') {
        const text = decodeURIComponent(a);
        const from = Math.max(t, q.plaqueLast.get().u ?? 0);
        q.plaqueAdd.run(p.id, p.name, text, from, from + NAME_DAYS * 86_400_000);
        onAnnounce?.(null, `${p.name} named the village fountain "${text}"${from > t ? ' (coming soon)' : ''}!`);
        return from > t ? `Booked: your name goes up on ${new Date(from).toLocaleDateString()}.` : 'Your name is on the fountain for a week!';
      }
      return '';
    },
  };

  app.get('/api/community', async (req, reply) => {
    const p = need(req, reply); if (!p) return reply;
    const t = now(), week = weekKey(t);
    const me = wallet(p.id);
    const polls = q.polls.all().map((pl) => {
      const tally = Object.fromEntries(q.tally.all(pl.id).map((r) => [r.option, { weight: r.w, voters: r.n }]));
      const options = JSON.parse(pl.options);
      return { id: pl.id, question: pl.question, options: options.map((o, i) => ({ text: o, weight: tally[i]?.weight ?? 0, voters: tally[i]?.voters ?? 0 })), endsAt: pl.ends_at, open: pl.ends_at > t, myVote: q.myVote.get(pl.id, me ?? '-', p.id)?.option ?? null };
    });
    const pot = potOf(week);
    const plaque = q.plaqueNow.get(t, t);
    // set aside = burn share of all $MGRD shop revenue so far; pending = what has not been burned yet
    const setAside = (sum(q.revenue.all()) * burnBps) / 10_000n;
    const burned = sum(q.burnRows.all());
    const pending = setAside > burned ? setAside - burned : 0n;
    const tips = q.tipsTo.all(p.id);
    return {
      polls,
      pot: { week, total: pot.total.toString(), goal: potGoal.toString(), givers: pot.givers, reached: pot.total >= potGoal, amounts: POT_MGRD, mgrd: POT_MGRD.map((u) => priceOf(u).toString()) },
      plaque: plaque ? { text: plaque.text, by: plaque.by_name, until: plaque.until_at } : null,
      name: { days: NAME_DAYS, mgrd: priceOf(NAME_MGRD).toString(), nextFree: Math.max(t, q.plaqueLast.get().u ?? 0) },
      burns: { bps: Number(burnBps), total: burned.toString(), pending: pending.toString(), list: q.burns.all().map((b) => ({ amount: b.amount, at: b.at, signature: b.signature, note: b.note })) },
      tips: { received: sum(tips).toString(), count: tips.length, amounts: TIP_MGRD },
    };
  });

  /** Public view for every player (no session needed): the fountain name and whether the pot is full. */
  app.get('/api/village-board', async () => {
    const t = now();
    const plaque = q.plaqueNow.get(t, t);
    return { plaque: plaque ? { text: plaque.text, by: plaque.by_name } : null, fireworks: potOf(weekKey(t)).total >= potGoal };
  });

  app.post('/api/vote', async (req, reply) => {
    const p = need(req, reply); if (!p) return reply;
    const pl = q.poll.get(Number(req.body?.poll));
    if (!pl || pl.ends_at <= now()) return reply.code(400).send({ error: 'That vote has closed.' });
    const opt = Number(req.body?.option);
    if (!(opt >= 0 && opt < JSON.parse(pl.options).length)) return reply.code(400).send({ error: 'Pick an option.' });
    const w = wallet(p.id);
    if (!w) return reply.code(400).send({ error: 'Connect a wallet to vote.' });
    const h = await holderOf(w);
    const tier = holderTier(h.balance + h.locked);
    if (!tier) return reply.code(403).send({ error: 'Voting needs at least the Sprout badge (1,000 $MGRD).' });
    try { q.vote.run(pl.id, w, p.id, opt, VOTE_WEIGHT[tier.id], now()); } catch { return reply.code(409).send({ error: 'You already voted on this one.' }); }
    return { ok: true, weight: VOTE_WEIGHT[tier.id] };
  });

  // ---- tips: wallet to wallet, verified on chain ------------------------------------------------------
  app.post('/api/tip/recipient', async (req, reply) => {
    const p = need(req, reply); if (!p) return reply;
    const e = rooms.byPlayer.get(p.id);
    const toPid = e?.room.slots[Number(req.body?.slot)];
    if (!toPid || toPid === p.id) return reply.code(400).send({ error: 'Pick another gardener.' });
    const to = wallet(toPid);
    if (!to) return reply.code(404).send({ error: 'That gardener has not connected a wallet yet.' });
    return { wallet: to, name: q.name.get(toPid)?.name ?? 'Gardener', amounts: TIP_MGRD };
  });
  app.post('/api/tip/confirm', async (req, reply) => {
    const p = need(req, reply); if (!p) return reply;
    if (!conn) return reply.code(503).send({ error: 'Chain features are off.' });
    // lower case, so the same transaction written another way cannot be counted twice
    const sig = String(req.body?.signature ?? '').toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(sig)) return reply.code(400).send({ error: 'That is not a transaction.' });
    const e = rooms.byPlayer.get(p.id);
    const toPid = e?.room.slots[Number(req.body?.slot)];
    const from = wallet(p.id), to = toPid && wallet(toPid);
    if (!from || !to || from === to) return reply.code(400).send({ error: 'Unknown tip.' });
    try { await checkChain(); } catch (err) { app.log.warn(err); return reply.code(502).send({ error: 'Could not reach BNB Chain. Try again in a moment.' }); }
    let tx;
    for (let i = 0; i < 8 && !tx; i++) {
      tx = await conn.getTransactionReceipt({ hash: sig }).catch(() => null);
      const depth = BigInt(config.confirmations ?? 0);
      if (tx && depth && (await conn.getBlockNumber({ cacheTime: 0 }).catch(() => 0n)) - tx.blockNumber < depth) tx = null;
      if (!tx) await new Promise((r) => setTimeout(r, 1500));
    }
    if (!tx || tx.status !== 'success') return reply.code(402).send({ error: 'Tip transaction not found.' });
    // MGRD must have moved from the tipper's linked wallet (which sent the transaction) to the recipient's
    const same = (a, b) => a.toLowerCase() === b.toLowerCase();
    if (!same(tx.from, from)) return reply.code(400).send({ error: 'That transfer was not sent by your linked wallet.' });
    const gained = parseEventLogs({ abi: TOKEN_ABI, eventName: 'Transfer', logs: tx.logs })
      .filter((l) => same(l.address, config.token) && same(l.args.from, from) && same(l.args.to, to))
      .reduce((n, l) => n + l.args.value, 0n);
    if (gained <= 0n) return reply.code(400).send({ error: 'No $MGRD reached that gardener.' });
    try { q.tipAdd.run(sig, p.id, toPid, gained.toString(), now()); } catch { return { ok: true, already: true }; }
    const amt = toNumber(gained);
    const toM = rooms.byPlayer.get(toPid)?.member;
    if (toM?.ws?.readyState === 1) toM.ws.send(JSON.stringify({ t: 'toast', msg: `${p.name} tipped you ${amt.toLocaleString('en-US')} $MGRD!` }));
    onAnnounce?.(p.id, `${p.name} tipped ${q.name.get(toPid)?.name} ${amt.toLocaleString('en-US')} $MGRD!`);
    return { ok: true, amount: amt };
  });

  return {
    purchases,
    /** Admin tool: start a vote. */
    createPoll: (question, options, days) => sql.prepare('INSERT INTO polls(question, options, created_at, ends_at) VALUES(?, ?, ?, ?)').run(question, JSON.stringify(options), now(), now() + days * 86_400_000),
    recordBurn: (signature, amount, note) => sql.prepare('INSERT INTO burns(signature, amount, at, note) VALUES(?, ?, ?, ?)').run(signature, String(amount), now(), note ?? null),
  };
}
