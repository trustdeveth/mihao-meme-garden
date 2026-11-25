// Optional BNB Chain layer (gametokenomics.md sections 8 to 13): wallet linking, weekly MGRD reward claims and the
// MGRD cosmetics shop. Off unless MG_REWARDS_CONTRACT and MG_MGRD_TOKEN are set; the game works the same without it.
//
// Trust rules: the server never signs player transactions and never trusts the browser's word that it paid.
// Rewards come from finalized weekly allocations (tools/chain/admin.mjs finalize); purchases are granted only after
// the contract's order receipt is read back and checked against the quote.
import { randomBytes } from 'node:crypto';
import { createPublicClient, http, recoverMessageAddress } from 'viem';
import { NETWORKS, viemChain, getAddress, isAddress, orderIdBytes, toBase, toNumber, REWARDS_ABI, TOKEN_ABI, MGRD_DECIMALS } from '@mg/shared/chain/evm';
import { LIMITED, HOLDER_TIERS, holderTier, CLUB } from '@mg/shared/data/mgrd';
import { mgrdPrice, mgrdGrant } from '@mg/shared/rules/mgrd';
import { publicProfile } from '@mg/shared/rules/public';
import { registerCommunity } from './community.js';
import { WEAR } from '@mg/shared/data/features';
import { seasonPointsView, SP_CAPS, SP_DAY_CAP, SP_LABEL } from '@mg/shared/rules/season-points';
import { weekKey } from '@mg/shared/rules/state';

export function chainConfig(env = process.env) {
  const cluster = env.MG_CHAIN_CLUSTER || 'bsc-testnet';
  const net = NETWORKS[cluster];
  const rewards = env.MG_REWARDS_CONTRACT ?? '';
  const token = env.MG_MGRD_TOKEN ?? '';
  const treasury = env.MG_TREASURY ?? '';
  const enabled = !!(net && isAddress(rewards) && isAddress(token));
  if (!enabled && (rewards || token)) console.warn('MGRD features stay OFF: check MG_CHAIN_CLUSTER, MG_REWARDS_CONTRACT and MG_MGRD_TOKEN.');
  return {
    enabled,
    cluster,
    chainId: net?.chainId ?? 0,
    // the server's RPC may carry a private key in its address, so the browser gets its own (public) one
    rpc: env.MG_CHAIN_RPC || net?.rpc || '',
    publicRpc: env.MG_CHAIN_PUBLIC_RPC || net?.rpc || '',
    confirmations: Number(env.MG_CONFIRMATIONS ?? net?.confirmations ?? 3),
    rewards, token,
    treasury: isAddress(treasury) ? treasury : '',
    // the $MGRD shop opens when the treasury is set (prices are fixed $MGRD amounts in shared/src/data/mgrd.js)
    shopOn: (env.MG_MGRD_SHOP ?? '1') !== '0',
    weeklyPool: Number(env.MG_WEEKLY_POOL ?? 100_000),
    potGoal: Number(env.MG_POT_GOAL ?? 100_000), // $MGRD the village needs in the weekly Fireworks Pot
    burnBps: Number(env.MG_BURN_BPS ?? 2_000), // share of $MGRD shop revenue set aside for the public burns (20%)
    quoteMs: 5 * 60_000, // paying takes up to two wallet confirmations (allow the amount, then pay)
  };
}

/** "Sign in with wallet": was this message signed by the wallet (EIP-191 personal_sign)? */
export async function verifyWalletSignature(address, message, signature) {
  try {
    if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) return false;
    return (await recoverMessageAddress({ message, signature })) === getAddress(address);
  } catch { return false; }
}

export function registerChain(app, { db, rooms, sessionPlayer, now, config = chainConfig() }) {
  const sql = db.raw;
  const conn = config.enabled ? createPublicClient({ chain: viemChain(config.cluster, config.rpc), transport: http(config.rpc || undefined, { timeout: 10_000 }) }) : null;
  const read = (functionName, args, blockNumber) => conn.readContract({ address: config.rewards, abi: REWARDS_ABI, functionName, args, ...(blockNumber ? { blockNumber } : {}) });
  // an RPC for another network must never be able to "confirm" a payment
  let rightChain = false;
  async function checkChain() {
    if (rightChain) return;
    const id = await conn.getChainId();
    if (id !== (config.chainId ?? NETWORKS[config.cluster].chainId)) throw new Error(`the RPC is for chain ${id}, not ${config.cluster}`);
    // and the contract must be using the same token as the game
    const set = await read('token', []);
    if (set.toLowerCase() !== config.token.toLowerCase()) throw new Error(`the rewards contract's token is ${set}, not MG_MGRD_TOKEN (run set-token first?)`);
    rightChain = true;
  }
  /** The newest block that already has enough blocks on top of it to be trusted. */
  async function safeBlock() {
    await checkChain();
    const depth = BigInt(config.confirmations ?? NETWORKS[config.cluster].confirmations);
    if (!depth) return undefined;
    return (await conn.getBlockNumber({ cacheTime: 0 })) - depth;
  }
  const nonces = new Map(); // pid -> {nonce, message, until}
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
  /** The player's linked BNB Chain wallet, or null (an address from another chain does not count). */
  const walletOf = (pid) => { const a = q.wallet.get(pid)?.address; return a && isAddress(a) ? a : null; };
  const need = (req, reply) => { const p = sessionPlayer(req); if (!p) reply.code(401).send({ error: 'No session.' }); return p; };
  const live = (pid) => rooms.byPlayer.get(pid)?.member ?? null;
  const stateOf = (pid) => live(pid)?.state ?? db.loadState(pid);

  app.get('/api/chain', async () => ({
    enabled: config.enabled, cluster: config.cluster, chainId: config.chainId ?? NETWORKS[config.cluster]?.chainId ?? 0,
    rpc: config.publicRpc || NETWORKS[config.cluster]?.rpc || '', explorer: NETWORKS[config.cluster]?.explorer ?? '',
    rewards: config.rewards ?? '', token: config.token ?? '',
    treasury: config.treasury, decimals: MGRD_DECIMALS, shop: config.enabled && config.shopOn !== false && !!config.treasury,
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
    try { addr = getAddress(String(address)); } catch { return reply.code(400).send({ error: 'Not a BNB Chain wallet address.' }); }
    if (!(await verifyWalletSignature(addr, n.message, String(signature)))) return reply.code(400).send({ error: 'The signature does not match that wallet.' });
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
    const wallet = walletOf(p.id);
    const allocations = q.allocs.all(p.id).map((a) => ({ epoch: a.epoch, week: a.week, index: a.idx, amount: a.amount, points: a.points, wallet: a.wallet, proof: JSON.parse(a.proof), deadline: a.claim_deadline, status: a.status }));
    if (conn && allocations.length) {
      try {
        await checkChain();
        const done = await Promise.all(allocations.map((a) => read('isClaimed', [BigInt(a.epoch), BigInt(a.index)])));
        done.forEach((claimed, i) => { allocations[i].claimed = claimed; });
      } catch { /* RPC down: claim status unknown */ }
    }
    return {
      chain: config.enabled, wallet, week, points: mine, today: sp.today, dayTotal: sp.dayTotal, caps: SP_CAPS, dayCap: SP_DAY_CAP, labels: SP_LABEL,
      pool: config.weeklyPool, estimate: Math.floor(config.weeklyPool * share), weekEnds: Date.parse(`${week}T00:00:00Z`) + 7 * 86_400_000,
      allocations,
    };
  });

  // ---- $MGRD payments: shop items, eggs, decor, special avatars, soil, Grow All, limited drops -----------------
  const SHOP = Object.entries(WEAR).filter(([, w]) => w.mgrd).map(([id, w]) => ({ id, name: w.name, slot: w.slot, color: w.color, finish: w.finish, price: w.mgrd }));
  const priceOf = (mgrdAmount) => toBase(mgrdAmount); // $MGRD -> base units, exactly
  const shopOpen = () => config.enabled && config.shopOn !== false && !!config.treasury;
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
    if (!walletOf(p.id)) return reply.code(400).send({ error: 'Connect a wallet first.' });
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
    return { orderId, kind, item: id, name: r.name, amount: amount.toString(), mgrd: r.mgrd, expires: t + config.quoteMs, treasury: config.treasury, rewards: config.rewards, token: config.token };
  }
  app.post('/api/mgrd/quote', async (req, reply) => quote(req, reply, String(req.body?.kind ?? ''), String(req.body?.id ?? '')));
  app.post('/api/shop/quote', async (req, reply) => quote(req, reply, 'wear', String(req.body?.item ?? '')));

  app.post('/api/shop/confirm', async (req, reply) => {
    const p = need(req, reply); if (!p) return reply;
    const o = q.order.get(String(req.body?.orderId ?? ''));
    if (!o || o.player_id !== p.id) return reply.code(404).send({ error: 'Order not found.' });
    const [kind, id] = o.item.includes(':') ? o.item.split(':') : ['wear', o.item];
    if (o.status === 'fulfilled') return { ok: true, kind, item: id, already: true };
    if (!conn) return reply.code(503).send({ error: 'Chain features are off.' });
    const wallet = walletOf(p.id);
    if (!wallet) return reply.code(400).send({ error: 'Connect the wallet you paid with.' });
    // receipts are stored per paying wallet, so only a payment from the linked wallet counts
    let receipt;
    try { receipt = await read('orders', [wallet, orderIdBytes(o.order_id)], await safeBlock()); } catch (err) { app.log.warn(err); return reply.code(502).send({ error: 'Could not reach BNB Chain. Try again in a moment.' }); }
    const [paid, , paidAt] = receipt;
    if (!paidAt) return reply.code(402).send({ error: 'Payment not found on chain yet.' });
    if (paid < BigInt(o.amount)) return reply.code(400).send({ error: 'Paid less than the quote.' });
    if (Number(paidAt) * 1000 > o.expires_at + 60_000) return reply.code(400).send({ error: 'The quote expired before payment. Contact support.' });
    // things that depend on the garden right now must still be possible (the payment stays valid; retry later)
    if (['soil', 'egg', 'growall'].includes(kind)) {
      const chk = mgrdPrice(stateOf(p.id) ?? {}, kind, id, now(), rooms.seed);
      if (!chk.ok) return reply.code(409).send({ error: `Paid, but not possible right now: ${chk.msg} Your payment is kept; try again when it is possible.`, paid: true });
    }
    // grant exactly once: the row update succeeds for only one request
    if (q.fulfil.run(wallet, o.order_id).changes !== 1) return { ok: true, kind, item: id, already: true };
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
    if (!conn || !wallet) return out;
    const [bal, lock] = await Promise.all([
      conn.readContract({ address: config.token, abi: TOKEN_ABI, functionName: 'balanceOf', args: [wallet] }).then(toNumber).catch(() => 0),
      read('locks', [wallet]).catch(() => null),
    ]);
    out.balance = bal;
    if (lock && lock[0] > 0n) { out.locked = toNumber(lock[0]); out.unlockAt = Number(lock[2]) * 1000; }
    return out;
  }
  app.get('/api/holder', async (req, reply) => {
    const p = need(req, reply); if (!p) return reply;
    const wallet = walletOf(p.id);
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
  community = registerCommunity(app, { db, rooms, need, now, config, conn, checkChain, wallet: walletOf, holderOf, applyGrant, priceOf, onAnnounce: announce });

  return {
    community, config,
    readEpoch: async (id) => { if (!conn) return null; const [root, total, claimed, claimDeadline, closed] = await read('epochs', [BigInt(id)]); return total ? { root, total, claimed, claimDeadline, closed } : null; },
  };
}
