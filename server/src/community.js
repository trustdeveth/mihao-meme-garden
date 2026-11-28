// $MGRD community features: holder votes, tips between players, gifts, the weekly Fireworks Pot, naming the
// village fountain, and the public burn record. Purchases (gift, pot, name) reuse the verified order flow in
// chain.js; tips are direct wallet-to-wallet transfers that the server checks on chain before announcing.
import { PublicKey } from '@solana/web3.js';
import { ata, toBase, toNumber } from '@mg/shared/chain/program';
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

export function registerCommunity(app, { db, rooms, need, now, config, conn, token, wallet, holderOf, applyGrant, priceOf, onAnnounce }) {
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
    tipRows: sql.prepare('SELECT amount FROM tips WHERE to_pid = ?'),
    burns: sql.prepare('SELECT * FROM burns ORDER BY at DESC LIMIT 20'),
    burnRows: sql.prepare('SELECT amount FROM burns'),
    lastBurn: sql.prepare('SELECT MAX(at) AS t FROM burns'),
    revenueRows: sql.prepare("SELECT amount FROM mgrd_orders WHERE status = 'fulfilled' AND created_at > ?"),
    name: sql.prepare('SELECT name FROM players WHERE id = ?'),
  };
  const sum = (rows) => rows.reduce((n, r) => n + BigInt(r.amount), 0n);
  const potOf = (week) => { const rows = q.potRows.all(week); return { s: sum(rows), n: new Set(rows.map((r) => r.player_id)).size }; };
  /** The weekly goal in base units; null while the token is not known. */
  const potGoal = () => (token() ? toBase(config.potGoal ?? 100_000, token().decimals) : null);
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
        const before = potOf(a).s;
        q.potAdd.run(a, p.id, String(amount), t);
        const after = before + BigInt(amount);
        const goal = potGoal();
        if (goal !== null && before < goal && after >= goal) onAnnounce?.(null, 'The Fireworks Pot is full! Fireworks over the village all week!');
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
    const goal = potGoal();
    const plaque = q.plaqueNow.get(t, t);
    // set aside = burn share of all $MGRD shop revenue so far; pending = what has not been burned yet
    const setAside = (sum(q.revenueRows.all(0)) * burnBps) / 10_000n;
    const burned = sum(q.burnRows.all());
    const pending = setAside > burned ? setAside - burned : 0n;
    const received = q.tipRows.all(p.id);
    return {
      polls,
      pot: { week, total: String(pot.s), goal: String(goal ?? 0n), givers: pot.n, reached: goal !== null && pot.s >= goal, amounts: POT_MGRD, mgrd: POT_MGRD.map((u) => priceOf(u).toString()) },
      plaque: plaque ? { text: plaque.text, by: plaque.by_name, until: plaque.until_at } : null,
      name: { days: NAME_DAYS, mgrd: priceOf(NAME_MGRD).toString(), nextFree: Math.max(t, q.plaqueLast.get().u ?? 0) },
      burns: { bps: Number(burnBps), total: String(burned), pending: pending.toString(), list: q.burns.all().map((b) => ({ amount: b.amount, at: b.at, signature: b.signature, note: b.note })) },
      tips: { received: String(sum(received)), count: received.length, amounts: TIP_MGRD },
    };
  });

  /** Public view for every player (no session needed): the fountain name and whether the pot is full. */
  app.get('/api/village-board', async () => {
    const t = now();
    const plaque = q.plaqueNow.get(t, t);
    const goal = potGoal();
    return { plaque: plaque ? { text: plaque.text, by: plaque.by_name } : null, fireworks: goal !== null && potOf(weekKey(t)).s >= goal };
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
    if (!conn || !token()) return reply.code(503).send({ error: 'Chain features are off.' });
    const sig = String(req.body?.signature ?? '');
    const e = rooms.byPlayer.get(p.id);
    const toPid = e?.room.slots[Number(req.body?.slot)];
    const from = wallet(p.id), to = toPid && wallet(toPid);
    if (!from || !to) return reply.code(400).send({ error: 'Unknown tip.' });
    let tx;
    for (let i = 0; i < 6 && !tx; i++) {
      tx = await conn.getParsedTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }).catch(() => null);
      if (!tx) await new Promise((r) => setTimeout(r, 1500));
    }
    if (!tx || tx.meta?.err) return reply.code(402).send({ error: 'Tip transaction not found.' });
    // the token balance of the recipient's $MGRD account must have gone up, sent by the tipper's linked wallet
    const toAta = ata(to, config.mint, token().tokenProgram).toBase58();
    const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58());
    const signer = tx.transaction.message.accountKeys.find((k) => k.signer)?.pubkey.toBase58();
    if (signer !== from) return reply.code(400).send({ error: 'That transfer was not sent by your linked wallet.' });
    const bal = (list) => list?.find((b) => keys[b.accountIndex] === toAta && b.mint === config.mint)?.uiTokenAmount.amount ?? '0';
    const gained = BigInt(bal(tx.meta.postTokenBalances)) - BigInt(bal(tx.meta.preTokenBalances));
    if (gained <= 0n) return reply.code(400).send({ error: 'No $MGRD reached that gardener.' });
    try { q.tipAdd.run(sig, p.id, toPid, gained.toString(), now()); } catch { return { ok: true, already: true }; }
    const amt = toNumber(gained, token().decimals);
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

export { PublicKey };
