// Optional Solana layer (gametokenomics.md sections 8 to 13): wallet linking, weekly MGRD reward claims and the
// MGRD cosmetics shop. Off unless MG_PROGRAM_ID and MG_MGRD_MINT are set; the game works the same without it.
//
// Trust rules: the server never signs player transactions and never trusts the browser's word that it paid.
// Rewards come from finalized weekly allocations (tools/chain/finalize-week.mjs); purchases are granted only after
// the program's on-chain order receipt is read back and checked against the quote.
import { randomBytes, createPublicKey, verify as edVerify } from 'node:crypto';
import { Connection, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { pdas, ata, mintInfo, decodeConfig, decodeOrder, decodeEpoch, decodeLock, toHex, toBase, toNumber } from '@mg/shared/chain/program';
import { LIMITED, HOLDER_TIERS, holderTier, CLUB } from '@mg/shared/data/mgrd';
import { mgrdPrice, mgrdGrant } from '@mg/shared/rules/mgrd';
import { publicProfile } from '@mg/shared/rules/public';
import { registerCommunity } from './community.js';
import { WEAR } from '@mg/shared/data/features';
import { seasonPointsView, SP_CAPS, SP_DAY_CAP, SP_LABEL } from '@mg/shared/rules/season-points';
import { weekKey } from '@mg/shared/rules/state';

const PUBLIC_RPC = { devnet: 'https://api.devnet.solana.com', 'mainnet-beta': 'https://api.mainnet-beta.solana.com', localnet: 'http://127.0.0.1:8899' };
const REFRESH_MS = 5 * 60_000; // how often the program's settings are read again
const RETRY_MS = 30_000;

export function chainConfig(env = process.env) {
  const programId = env.MG_PROGRAM_ID ?? '';
  const mint = env.MG_MGRD_MINT ?? '';
  const cluster = env.MG_CHAIN_CLUSTER ?? 'devnet';
  const isKey = (k) => { try { return !!new PublicKey(k); } catch { return false; } };
  const enabled = !!(programId && mint) && isKey(programId) && isKey(mint) && Object.hasOwn(PUBLIC_RPC, cluster);
  if (!enabled && (programId || mint)) console.warn('MGRD features stay OFF: check MG_CHAIN_CLUSTER, MG_PROGRAM_ID and MG_MGRD_MINT.');
  return {
    enabled, cluster,
    rpc: env.MG_CHAIN_RPC || PUBLIC_RPC[cluster],
    programId, mint,
    // the treasury is read from the program; set MG_TREASURY only to have the server insist on one address
    treasury: env.MG_TREASURY ?? '',
    // prices are fixed $MGRD amounts in shared/src/data/mgrd.js
    shopOn: (env.MG_MGRD_SHOP ?? '1') !== '0',
    weeklyPool: Number(env.MG_WEEKLY_POOL ?? 100_000),
    potGoal: Number(env.MG_POT_GOAL ?? 100_000), // $MGRD the village needs in the weekly Fireworks Pot
    burnBps: Number(env.MG_BURN_BPS ?? 2_000), // share of $MGRD shop revenue set aside for the public burns (20%)
    quoteMs: 2 * 60_000,
  };
}

/** Ed25519 signature check for "Sign in with wallet" (Solana wallets sign raw message bytes). */
export function verifyWalletSignature(address, message, signatureB58) {
  try {
    const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(new PublicKey(address).toBytes()).toString('base64url') }, format: 'jwk' });
    return edVerify(null, Buffer.from(message, 'utf8'), key, Buffer.from(bs58.decode(signatureB58)));
  } catch { return false; }
}

export function registerChain(app, { db, rooms, sessionPlayer, now, config = chainConfig() }) {
  const sql = db.raw;
  const conn = config.enabled ? new Connection(config.rpc, 'confirmed') : null;
  const A = config.enabled ? pdas(config.programId) : null;
  const nonces = new Map(); // pid -> {nonce, message, until}
  const mintKey = config.enabled ? new PublicKey(config.mint) : null;

  // What the chain itself says about the token and the program. Until it has been read and matches the settings, the
  // token features stay off, so a wrong address can never take a payment or misprice one by a factor of a thousand.
  let token = null, checkedAt = -Infinity, checking = null, complained = '';
  async function check() {
    const [mintAccount, configAccount] = await conn.getMultipleAccountsInfo([mintKey, A.config]);
    const info = mintInfo(mintAccount);
    if (!configAccount || !configAccount.owner.equals(A.program)) throw new Error('the program has not been given its token yet (admin.mjs init)');
    const cfg = decodeConfig(configAccount.data);
    if (!cfg.mint.equals(mintKey)) throw new Error('the program was set up with a different token than MG_MGRD_MINT');
    if (config.treasury && cfg.treasury.toBase58() !== config.treasury) throw new Error("the program's treasury is not MG_TREASURY");
    return { decimals: info.decimals, tokenProgram: info.tokenProgram.toBase58(), treasury: cfg.treasury.toBase58() };
  }
  async function ready() {
    if (!config.enabled) return false;
    if (now() - checkedAt < (token ? REFRESH_MS : RETRY_MS)) return !!token;
    checking ??= check().then((t) => { token = t; complained = ''; }, (e) => {
      // a network hiccup keeps what is already known; a real mismatch switches the features off
      if (/different token|MG_TREASURY|not a token|no token/.test(e.message)) token = null;
      if (complained !== e.message) console.warn(`MGRD features: ${(complained = e.message)}`);
    }).finally(() => { checkedAt = now(); checking = null; });
    await checking;
    return !!token;
  }
  const on = () => config.enabled && !!token;
  app.addHook('preHandler', async (req) => { if (config.enabled && /^\/api\/(chain|rewards|shop|mgrd|holder|community|tip|vote|village-board)/.test(req.url)) await ready(); });
  const q = {
    wallet: sql.prepare('SELECT address, linked_at FROM wallets WHERE player_id = ?'),
    walletOwner: sql.prepare('SELECT player_id FROM wallets WHERE address = ?'),
    link: sql.prepare('INSERT INTO wallets(player_id, address, linked_at) VALUES(?, ?, ?) ON CONFLICT(player_id) DO UPDATE SET address = excluded.address, linked_at = excluded.linked_at'),
    unlink: sql.prepare('DELETE FROM wallets WHERE player_id = ?'),
    weekSum: sql.prepare('SELECT COALESCE(SUM(points), 0) AS s FROM season_points WHERE week = ?'),
    myPoints: sql.prepare('SELECT points FROM season_points WHERE player_id = ? AND week = ?'),
    allocs: sql.prepare(`SELECT a.epoch, a.idx, a.amount, a.points, a.proof, a.wallet, e.week, e.claim_deadline, e.status
      FROM reward_allocations a JOIN reward_epochs e ON e.id = a.epoch WHERE a.player_id = ? ORDER BY a.epoch DESC LIMIT 12`),
    putOrder: sql.prepare('INSERT INTO mgrd_orders(order_id, player_id, item, amount, usd, created_at, expires_at, status) VALUES(?, ?, ?, ?, ?, ?, ?, ?)'),
    order: sql.prepare('SELECT * FROM mgrd_orders WHERE order_id = ?'),
    fulfil: sql.prepare("UPDATE mgrd_orders SET status = 'fulfilled', payer = ? WHERE order_id = ? AND status = 'quoted'"),
  };
  let community = null;
  const need = (req, reply) => { const p = sessionPlayer(req); if (!p) reply.code(401).send({ error: 'No session.' }); return p; };
  const live = (pid) => rooms.byPlayer.get(pid)?.member ?? null;
  const stateOf = (pid) => live(pid)?.state ?? db.loadState(pid);

  app.get('/api/chain', async () => ({
    enabled: on(), cluster: config.cluster, rpc: config.rpc, programId: config.programId, mint: config.mint,
    treasury: token?.treasury ?? '', decimals: token?.decimals ?? null, tokenProgram: token?.tokenProgram ?? null, shop: shopOpen(),
  }));

  // ---- wallet linking: sign a one-time message --------------------------------------------------------
  app.post('/api/wallet/challenge', async (req, reply) => {
    const p = need(req, reply); if (!p) return reply;
    const nonce = randomBytes(12).toString('hex');
    const message = `Meme Garden wants to link this wallet to the gardener "${p.name}".\n\nThis only proves you own the wallet. It is not a transaction and costs nothing.\n\nNonce: ${nonce}\nIssued: ${new Date(now()).toISOString()}`;
    nonces.set(p.id, { nonce, message, until: now() + 5 * 60_000 });
    return { message, nonce };
  });
  app.post('/api/wallet/link', async (req, reply) => {
    const p = need(req, reply); if (!p) return reply;
    const { address, signature } = req.body ?? {};
    const n = nonces.get(p.id);
    if (!n || n.until < now()) return reply.code(400).send({ error: 'The link request expired. Try again.' });
    let addr;
    try { addr = new PublicKey(String(address)).toBase58(); } catch { return reply.code(400).send({ error: 'Not a Solana address.' }); }
    if (!verifyWalletSignature(addr, n.message, String(signature))) return reply.code(400).send({ error: 'The signature does not match that wallet.' });
    const other = q.walletOwner.get(addr);
    if (other && other.player_id !== p.id) return reply.code(409).send({ error: 'That wallet is linked to another gardener.' });
    nonces.delete(p.id);
    q.link.run(p.id, addr, now());
    db.audit(p.id, now(), 'wallet_link', { address: addr });
    return { address: addr };
  });
  app.post('/api/wallet/unlink', async (req, reply) => {
    const p = need(req, reply); if (!p) return reply;
    q.unlink.run(p.id);
    db.audit(p.id, now(), 'wallet_unlink', null);
    return { ok: true };
  });

  // ---- rewards: this week's points, estimate, finalized weeks to claim --------------------------------
  app.get('/api/rewards', async (req, reply) => {
    const p = need(req, reply); if (!p) return reply;
    const t = now();
    const state = stateOf(p.id) ?? {};
    const sp = seasonPointsView(state, t);
    const week = weekKey(t);
    // live points are newer than the last save; count them in the estimate
    const stored = q.myPoints.get(p.id, week)?.points ?? 0;
    const mine = Math.max(stored, sp.week === week ? sp.points : 0);
    const total = Math.max(1, q.weekSum.get(week).s - stored + mine);
    const share = Math.min(mine / total, 0.01); // per-player cap: 1% of a weekly pool
    const wallet = q.wallet.get(p.id)?.address ?? null;
    const allocations = q.allocs.all(p.id).map((a) => ({ epoch: a.epoch, week: a.week, index: a.idx, amount: a.amount, points: a.points, wallet: a.wallet, proof: JSON.parse(a.proof), deadline: a.claim_deadline, status: a.status }));
    if (on() && allocations.length) {
      try {
        const infos = await conn.getMultipleAccountsInfo(allocations.map((a) => A.receipt(a.epoch, a.index)));
        infos.forEach((info, i) => { allocations[i].claimed = !!info; });
      } catch { /* RPC down: claim status unknown */ }
    }
    return {
      chain: on(), wallet, week, points: mine, today: sp.today, dayTotal: sp.dayTotal, caps: SP_CAPS, dayCap: SP_DAY_CAP, labels: SP_LABEL,
      pool: config.weeklyPool, estimate: Math.floor(config.weeklyPool * share), weekEnds: Date.parse(`${week}T00:00:00Z`) + 7 * 86_400_000,
      allocations,
    };
  });

  // ---- $MGRD payments: shop items, eggs, decor, special avatars, soil, Grow All, limited drops -----------------
  const SHOP = Object.entries(WEAR).filter(([, w]) => w.mgrd).map(([id, w]) => ({ id, name: w.name, slot: w.slot, color: w.color, finish: w.finish, price: w.mgrd }));
  // whole $MGRD -> base units, in the token's own decimals (0 while the token is not known: nothing is sold then)
  const priceOf = (mgrdAmount) => (token ? toBase(Number(Number(mgrdAmount).toFixed(Math.min(token.decimals, 6))), token.decimals) : 0n);
  const shopOpen = () => on() && config.shopOn !== false;
  const qx = {
    sold: sql.prepare("SELECT COUNT(*) AS n FROM mgrd_orders WHERE item = ? AND status = 'fulfilled'"),
    reserved: sql.prepare("SELECT COUNT(*) AS n FROM mgrd_orders WHERE item = ? AND status = 'quoted' AND expires_at > ?"),
    setEdition: sql.prepare('UPDATE mgrd_orders SET payer = ? WHERE order_id = ?'),
  };
  const limitedView = (t) => Object.entries(LIMITED).map(([id, L]) => {
    const sold = qx.sold.get(`limited:${id}`).n;
    return { id, name: L.name, kind: L.kind, supply: L.supply, sold, left: Math.max(0, L.supply - sold - qx.reserved.get(`limited:${id}`, t).n), mgrd: priceOf(L.mgrd).toString() };
  });
  /** $MGRD price for any purchase, for showing next to the coin/gem price. */
  app.post('/api/mgrd/price', async (req, reply) => {
    const p = need(req, reply); if (!p) return reply;
    if (!shopOpen()) return { open: false };
    const r = mgrdPrice(stateOf(p.id) ?? {}, String(req.body?.kind), String(req.body?.id ?? ''), now(), rooms.seed);
    return r.ok ? { open: true, mgrd: priceOf(r.mgrd).toString(), name: r.name } : { open: true, error: r.msg };
  });
  app.get('/api/shop', async () => ({
    enabled: shopOpen(),
    items: SHOP.map((s) => ({ ...s, mgrd: priceOf(s.price).toString() })),
    limited: limitedView(now()),
    club: CLUB,
  }));
  async function quote(req, reply, kind, id) {
    const p = need(req, reply); if (!p) return reply;
    if (!shopOpen()) return reply.code(503).send({ error: 'The $MGRD shop is not open yet.' });
    if (!q.wallet.get(p.id)) return reply.code(400).send({ error: 'Connect a wallet first.' });
    const t = now();
    const special = community.purchases.price(p, kind, id, req.body);
    const r = special ?? mgrdPrice(stateOf(p.id) ?? {}, kind, id, t, rooms.seed);
    if (!r.ok) return reply.code(409).send({ error: r.msg });
    if (kind === 'limited') {
      const L = limitedView(t).find((x) => x.id === id);
      if (!L || L.left <= 0) return reply.code(409).send({ error: 'Sold out!' });
    }
    const orderId = randomBytes(16).toString('hex');
    const amount = priceOf(r.mgrd);
    q.putOrder.run(orderId, p.id, special ? r.item : `${kind}:${id}`, amount.toString(), r.mgrd, t, t + config.quoteMs, 'quoted');
    return { orderId, kind, item: id, name: r.name, amount: amount.toString(), mgrd: r.mgrd, expires: t + config.quoteMs, treasury: token.treasury, programId: config.programId, mint: config.mint, deadline: Math.floor((t + config.quoteMs) / 1000) };
  }
  app.post('/api/mgrd/quote', async (req, reply) => quote(req, reply, String(req.body?.kind ?? ''), String(req.body?.id ?? '')));
  app.post('/api/shop/quote', async (req, reply) => quote(req, reply, 'wear', String(req.body?.item ?? '')));

  app.post('/api/shop/confirm', async (req, reply) => {
    const p = need(req, reply); if (!p) return reply;
    const o = q.order.get(String(req.body?.orderId ?? ''));
    if (!o || o.player_id !== p.id) return reply.code(404).send({ error: 'Order not found.' });
    const [kind, id] = o.item.includes(':') ? o.item.split(':') : ['wear', o.item];
    if (o.status === 'fulfilled') return { ok: true, kind, item: id, already: true };
    if (!on()) return reply.code(503).send({ error: 'Chain features are off.' });
    const wallet = q.wallet.get(p.id)?.address;
    if (!wallet) return reply.code(400).send({ error: 'Connect the wallet you paid with.' });
    let info;
    try { info = await conn.getAccountInfo(A.order(wallet, Buffer.from(o.order_id, 'hex')), 'confirmed'); } catch { return reply.code(502).send({ error: 'Could not reach Solana. Try again in a moment.' }); }
    if (!info) return reply.code(402).send({ error: 'Payment not found on chain yet.' });
    if (!info.owner.equals(A.program)) return reply.code(400).send({ error: 'Not a payment receipt.' });
    const r = decodeOrder(info.data);
    if (toHex(r.orderId) !== o.order_id) return reply.code(400).send({ error: 'Receipt does not match the order.' });
    if (r.payer.toBase58() !== wallet) return reply.code(400).send({ error: 'Paid from a wallet that is not linked to you.' });
    if (r.amount < BigInt(o.amount)) return reply.code(400).send({ error: 'Paid less than the quote.' });
    if (Number(r.paidAt) * 1000 > o.expires_at + 60_000) return reply.code(400).send({ error: 'The quote expired before payment. Contact support.' });
    // things that depend on the garden right now must still be possible (the payment stays valid; retry later)
    if (['soil', 'egg', 'growall'].includes(kind)) {
      const chk = mgrdPrice(stateOf(p.id) ?? {}, kind, id, now(), rooms.seed);
      if (!chk.ok) return reply.code(409).send({ error: `Paid, but not possible right now: ${chk.msg} Your payment is kept; try again when it is possible.`, paid: true });
    }
    // grant exactly once: the row update succeeds for only one request
    if (q.fulfil.run(r.payer.toBase58(), o.order_id).changes !== 1) return { ok: true, kind, item: id, already: true };
    const edition = kind === 'limited' ? qx.sold.get(o.item).n : 0; // this order is already counted
    const msg = ['gift', 'pot', 'name'].includes(kind) ? community.purchases.grant(p, o.item, o.amount) : applyGrant(p.id, (s) => mgrdGrant(s, kind, id, { now: now(), seed: rooms.seed }, edition));
    db.audit(p.id, now(), 'mgrd_purchase', { order: o.order_id, kind, item: id, amount: o.amount, edition });
    return { ok: true, kind, item: id, edition, msg };
  });

  /** Apply a change to an online player's live state (and tell their client and the room), or to the saved state. */
  function applyGrant(pid, fn) {
    const e = rooms.byPlayer.get(pid);
    if (e) {
      const r = fn(e.member.state);
      e.member.dirty = true;
      const s = e.member.state;
      if (e.member.ws?.readyState === 1) e.member.ws.send(JSON.stringify({ t: 'sync', d: { wardrobe: s.wardrobe, eggs: s.eggs, decorInv: s.decorInv, unlockedColors: s.unlockedColors, soil: s.soil, basket: s.basket, plants: s.plants, editions: s.editions, mgrdGrowAll: s.mgrdGrowAll } }));
      e.room.pushGarden(e.member);
      return r.msg;
    }
    const s = db.loadState(pid);
    if (!s) return '';
    const r = fn(s);
    db.saveStates([{ pid, state: s }], now());
    return r.msg;
  }

  // ---- holder tier and Garden Club ---------------------------------------------------------------------
  async function holderOf(wallet) {
    const out = { balance: 0, locked: 0, unlockAt: 0 };
    if (!on() || !wallet) return out;
    const [bal, lock] = await Promise.all([
      conn.getTokenAccountBalance(ata(wallet, config.mint, token.tokenProgram)).then((b) => toNumber(b.value.amount, token.decimals)).catch(() => 0),
      conn.getAccountInfo(A.lock(wallet)).then((i) => (i ? decodeLock(i.data) : null)).catch(() => null),
    ]);
    out.balance = bal;
    if (lock) { out.locked = toNumber(lock.amount, token.decimals); out.unlockAt = Number(lock.unlockAt) * 1000; }
    return out;
  }
  app.get('/api/holder', async (req, reply) => {
    const p = need(req, reply); if (!p) return reply;
    const wallet = q.wallet.get(p.id)?.address ?? null;
    const h = await holderOf(wallet);
    const tier = holderTier(h.balance + h.locked);
    const clubActive = h.locked >= CLUB.minLock && h.unlockAt > now();
    // remember it on the player (badge next to the name, club perks) and tell the village
    applyGrant(p.id, (s) => {
      s.holder = tier?.id ?? null;
      s.club = { active: clubActive, until: clubActive ? h.unlockAt : 0 };
      if (clubActive && !(s.clubPerks ?? []).includes(CLUB.perk)) { s.clubPerks = [...(s.clubPerks ?? []), CLUB.perk]; s.decorInv ??= {}; s.decorInv[CLUB.perk] = (s.decorInv[CLUB.perk] ?? 0) + 1; }
      return { msg: '' };
    });
    const e = rooms.byPlayer.get(p.id);
    if (e) e.room.broadcast({ t: 'profile', slot: e.member.slot, ...publicProfile(e.member.state) });
    return { wallet, ...h, tier, tiers: HOLDER_TIERS, club: { ...CLUB, active: clubActive } };
  });

  /** A short message to one player's village, or to everyone when pid is null. */
  function announce(pid, msg) {
    const rs = pid ? [rooms.byPlayer.get(pid)?.room].filter(Boolean) : [...rooms.rooms.values()];
    for (const r of rs) r.broadcast({ t: 'toast', msg, kind: 'gold' });
  }
  community = registerCommunity(app, { db, rooms, need, now, config, conn, token: () => token, wallet: (pid) => q.wallet.get(pid)?.address ?? null, holderOf, applyGrant, priceOf, onAnnounce: announce });

  return { community, config, ready, readEpoch: async (id) => { const i = conn && (await conn.getAccountInfo(A.epoch(id))); return i ? decodeEpoch(i.data) : null; } };
}
