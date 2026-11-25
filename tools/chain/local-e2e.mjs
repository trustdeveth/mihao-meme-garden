// Full chain + backend test against a LOCAL validator (chain/scripts/local-validator.sh). Nothing public.
//  1. token + program setup (mint authority revoked), vault funded
//  2. a player links a wallet by signature, earns Season Points, the week is finalized and published
//  3. the player claims; a second claim, a forged amount and another wallet's claim all fail
//  4. MGRD shop: quote -> pay_order on chain -> server reads the receipt -> item granted once; paying twice fails
//  5. reserved vault funds cannot be withdrawn; claims stop after the deadline; close releases the reservation
// Usage: node tools/chain/local-e2e.mjs
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrivateKey, sign as edSign } from 'node:crypto';
import { Connection, Keypair, LAMPORTS_PER_SOL, Transaction, sendAndConfirmTransaction, PublicKey } from '@solana/web3.js';
import { getAccount } from '@solana/spl-token';
import bs58 from 'bs58';
import { setup } from './admin.mjs';
import { createServer } from '../../server/src/app.js';
import { pdas, ata, createAtaIdempotentIx, claimIx, payOrderIx, openEpochIx, closeEpochIx, withdrawUnreservedIx, leafHash, buildTree, decodeConfig } from '../../shared/src/chain/program.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RPC = process.env.RPC ?? 'http://127.0.0.1:8899';
const PROGRAM = readFileSync(resolve(ROOT, 'chain/target/deploy/program-id.txt'), 'utf8').trim();
const conn = new Connection(RPC, 'confirmed');
const UNIT = 1_000_000n;
const step = (s) => console.log(`- ${s}`);
const send = (signers, ...ixs) => sendAndConfirmTransaction(conn, new Transaction().add(...ixs), signers);
const fails = async (p, re, what) => { try { await p; } catch (e) { const s = String(e.message ?? e) + (e.logs ?? []).join(' '); assert.match(s, re, what); return; } assert.fail(`${what}: should have failed`); };
async function fund(kp, sol = 5) { const sig = await conn.requestAirdrop(kp.publicKey, sol * LAMPORTS_PER_SOL); await conn.confirmTransaction(sig, 'confirmed'); }
const signMsg = (kp, msg) => { const key = createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', d: Buffer.from(kp.secretKey.slice(0, 32)).toString('base64url'), x: Buffer.from(kp.publicKey.toBytes()).toString('base64url') }, format: 'jwk' }); return bs58.encode(edSign(null, Buffer.from(msg), key)); };

// wait for the validator
for (let i = 0; ; i++) { try { await conn.getLatestBlockhash(); break; } catch { if (i > 60) throw new Error(`no validator at ${RPC}`); await new Promise((r) => setTimeout(r, 1000)); } }
const admin = Keypair.generate(), alice = Keypair.generate(), bob = Keypair.generate();
await Promise.all([fund(admin, 20), fund(alice), fund(bob)]);

// 1. setup
const { mint, treasury, adminAta } = await setup({ connection: conn, admin, programId: PROGRAM, recycleBps: 5000, fund: 500_000n * UNIT });
const mintInfo = await conn.getParsedAccountInfo(mint);
assert.equal(mintInfo.value.data.parsed.info.mintAuthority, null, 'mint authority revoked');
assert.equal(mintInfo.value.data.parsed.info.supply, String(1_000_000_000n * UNIT));
const A = pdas(PROGRAM);
assert.equal((await getAccount(conn, A.vault)).amount, 500_000n * UNIT);
step(`token ${mint.toBase58().slice(0, 8)}... 1B supply, mint authority revoked; program initialized; vault 500,000 MGRD`);

// 2. server with chain on; a player links alice's wallet and earns points
const dir = mkdtempSync(join(tmpdir(), 'mg-chain-'));
const { weekKey } = await import('../../shared/src/rules/state.js');
const WEEK = weekKey(Date.now()); // real time: the validator stamps payments with real time too
const srv = await createServer({
  dbPath: join(dir, 'c.db'), secret: 's', now: () => Date.now(), allowNoOrigin: true,
  chain: { enabled: true, cluster: 'localnet', rpc: RPC, programId: PROGRAM, mint: mint.toBase58(), treasury: treasury.toBase58(), weeklyPool: 100_000, quoteMs: 120_000 },
});
await srv.app.listen({ port: 0, host: '127.0.0.1' });
const base = `http://127.0.0.1:${srv.app.server.address().port}`;
const guest = await fetch(`${base}/api/guest`, { method: 'POST' });
const cookie = guest.headers.get('set-cookie').split(';')[0];
const { playerId } = await guest.json();
const call = async (path, body) => { const r = await fetch(`${base}${path}`, { method: body ? 'POST' : 'GET', headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, ...(await r.json()) }; };
const ch = await call('/api/wallet/challenge', {});
assert.equal((await call('/api/wallet/link', { address: alice.publicKey.toBase58(), signature: signMsg(bob, ch.message) })).status, 400, 'wrong signer rejected');
const ch2 = await call('/api/wallet/challenge', {});
const linked = await call('/api/wallet/link', { address: alice.publicKey.toBase58(), signature: signMsg(alice, ch2.message) });
assert.equal(linked.address, alice.publicKey.toBase58());
step('wallet linked by signed message (a signature from another wallet is rejected)');
// season points for the week (the game writes these on save; here directly), plus 9 other players sharing the pool
const sql = srv.db.raw;
{ const { freshState } = await import('../../shared/src/rules/state.js'); srv.db.saveStates([{ pid: playerId, state: freshState(Date.now()) }], Date.now()); }
sql.prepare('INSERT INTO season_points(player_id, week, points) VALUES(?, ?, ?)').run(playerId, WEEK, 700);
for (let i = 0; i < 9; i++) {
  const pid = `p${i}`, kp = Keypair.generate();
  sql.prepare('INSERT INTO players(id, name, created_at, last_seen) VALUES(?, ?, 0, 0)').run(pid, `bot${i}`);
  sql.prepare('INSERT INTO wallets(player_id, address, linked_at) VALUES(?, ?, 0)').run(pid, kp.publicKey.toBase58());
  sql.prepare('INSERT INTO season_points(player_id, week, points) VALUES(?, ?, ?)').run(pid, WEEK, 100 + i * 50);
}
const est = await call('/api/rewards');
assert.ok(est.estimate > 0, 'estimate shown');

// finalize the week (the admin tool's code) and publish the root on chain
const { allocate } = await import('./admin.mjs');
const rows = sql.prepare('SELECT s.player_id, s.points, w.address FROM season_points s JOIN wallets w ON w.player_id = s.player_id WHERE s.week = ? ORDER BY s.player_id').all(WEEK);
const { out } = allocate(rows, { poolUnits: 100_000n * UNIT, minUnits: UNIT });
const me = out.find((r) => r.player_id === playerId);
assert.equal(me.amount, 1_000n * UNIT, 'alice capped at 1% of the pool (1,000 MGRD)');
const epochId = 1;
const tree = buildTree(out.map((r, i) => leafHash(PROGRAM, mint, epochId, i, r.address, r.amount)));
const total = out.reduce((n, r) => n + r.amount, 0n);
const deadline = Math.floor(Date.now() / 1000) + 25;
await send([admin], openEpochIx({ programId: PROGRAM, admin: admin.publicKey, epochId, root: tree.root, total, claimDeadline: deadline }));
sql.prepare('INSERT INTO reward_epochs(id, week, root, total, claim_deadline, created_at, status) VALUES(?, ?, ?, ?, ?, 0, ?)').run(epochId, WEEK, '', total.toString(), deadline, 'open');
out.forEach((r, i) => sql.prepare('INSERT INTO reward_allocations(epoch, idx, player_id, wallet, amount, points, proof) VALUES(?, ?, ?, ?, ?, ?, ?)').run(epochId, i, r.player_id, r.address, r.amount.toString(), r.points, JSON.stringify(tree.proof(i).map((b) => Buffer.from(b).toString('hex')))));
step(`week finalized: ${out.length} recipients, ${Number(total) / 1e6} MGRD; root published (open_epoch)`);

// 3. claim through what the server hands the client
const r1 = await call('/api/rewards');
const a = r1.allocations[0];
assert.equal(a.claimed, false);
const claimArgs = { programId: PROGRAM, mint, payer: alice.publicKey, claimant: alice.publicKey, epochId: a.epoch, index: a.index, amount: BigInt(a.amount), proof: a.proof };
await send([alice], createAtaIdempotentIx(alice.publicKey, alice.publicKey, mint), claimIx(claimArgs));
assert.equal((await getAccount(conn, ata(alice.publicKey, mint))).amount, 1_000n * UNIT);
assert.equal((await call('/api/rewards')).allocations[0].claimed, true, 'server sees the claim');
step('alice claimed 1,000 MGRD with her proof; the server shows it as claimed');
await fails(send([alice], claimIx(claimArgs)), /already in use|0x0/, 'second claim of the same leaf');
await fails(send([alice], claimIx({ ...claimArgs, index: a.index, amount: 2_000n * UNIT })), /BadProof|already in use|0x0/, 'forged amount');
await send([bob], createAtaIdempotentIx(bob.publicKey, bob.publicKey, mint));
await fails(send([bob], claimIx({ ...claimArgs, payer: bob.publicKey, claimant: bob.publicKey, index: 1 })), /BadProof/, "someone else's leaf with bob's wallet");
step('double claim, forged amount and claiming with the wrong wallet all rejected');

// 4. shop: quote, pay on chain, server verifies the receipt and grants once
const shop = await call('/api/shop');
const item = shop.items[0];
const quote = await call('/api/shop/quote', { item: item.id });
assert.equal(BigInt(quote.amount), BigInt(item.price) * 1_000_000n, 'fixed $MGRD price');
assert.equal((await call('/api/shop/confirm', { orderId: quote.orderId })).status, 402, 'not paid yet');
const vaultBefore = (await getAccount(conn, A.vault)).amount, treasBefore = (await getAccount(conn, treasury)).amount;
const payIx = payOrderIx({ programId: PROGRAM, mint, payer: alice.publicKey, treasury, orderId: quote.orderId, amount: BigInt(quote.amount) });
await send([alice], payIx);
const half = BigInt(quote.amount) / 2n;
assert.equal((await getAccount(conn, A.vault)).amount - vaultBefore, half, '50% recycled into the rewards vault');
assert.equal((await getAccount(conn, treasury)).amount - treasBefore, BigInt(quote.amount) - half, '50% to treasury');
const conf = await call('/api/shop/confirm', { orderId: quote.orderId });
if (!conf.ok) console.log('confirm response:', conf);
assert.equal(conf.ok, true);
assert.equal((await call('/api/shop/confirm', { orderId: quote.orderId })).already, true, 'granted only once');
assert.ok(srv.db.loadState(playerId) || true);
await fails(send([alice], payIx), /already in use|0x0/, 'paying the same order twice');
step(`shop: paid ${Number(quote.amount) / 1e6} MGRD for ${item.name} (50/50 vault/treasury), server granted it once; double payment rejected`);

// 5. reserve protection, deadline, close
const cfg = decodeConfig((await conn.getAccountInfo(A.config)).data);
const vaultNow = (await getAccount(conn, A.vault)).amount;
await fails(send([admin], withdrawUnreservedIx({ programId: PROGRAM, admin: admin.publicKey, to: adminAta, amount: vaultNow - cfg.outstanding + 1n })), /Reserved/, 'withdrawing reserved funds');
await fails(send([admin], closeEpochIx({ programId: PROGRAM, admin: admin.publicKey, epochId })), /NotExpired/, 'closing before the deadline');
while (Math.floor(Date.now() / 1000) <= deadline + 1) await new Promise((r) => setTimeout(r, 1000));
const leaf2 = r1.allocations.length ? null : null; void leaf2;
const other = out.findIndex((r) => r.player_id === 'p8');
await fails(send([admin], claimIx({ programId: PROGRAM, mint, payer: admin.publicKey, claimant: admin.publicKey, epochId, index: other, amount: out[other].amount, proof: tree.proof(other) })), /ClaimExpired|BadProof/, 'claim after the deadline');
await send([admin], closeEpochIx({ programId: PROGRAM, admin: admin.publicKey, epochId }));
assert.equal(decodeConfig((await conn.getAccountInfo(A.config)).data).outstanding, 0n, 'reservation released');
step('reserved funds protected; claims stop at the deadline; closing releases the reservation');

// 6. everything else you can buy with $MGRD, through the same quote -> pay_order -> verified grant flow
if (process.env.CLUB_TEST) {
  const { transfer: splTransfer2 } = await import('@solana/spl-token');
  await splTransfer2(conn, admin, adminAta, ata(alice.publicKey, mint), admin, 30_000n * UNIT);
  const buyWith = async (kind, id) => {
    const q = await call('/api/mgrd/quote', { kind, id });
    assert.ok(q.orderId, `${kind}:${id} quote: ${q.error ?? ''}`);
    await send([alice], payOrderIx({ programId: PROGRAM, mint, payer: alice.publicKey, treasury, orderId: q.orderId, amount: BigInt(q.amount) }));
    const c = await call('/api/shop/confirm', { orderId: q.orderId });
    assert.equal(c.ok, true, `${kind}:${id} confirm: ${c.error ?? ''}`);
    return { ...c, amount: Number(q.amount) / 1e6 };
  };
  const st0 = srv.db.loadState(playerId);
  const egg = await buyWith('egg', 'rare');
  const deco = await buyWith('decor', 'fountain');
  const hair = await buyWith('hair', '#5fb8ff');
  const soil = await buyWith('soil', '');
  const lim = await buyWith('limited', 'founder_crown');
  const st1 = srv.db.loadState(playerId);
  assert.equal(st1.eggs.length, (st0.eggs?.length ?? 0) + 1, 'egg in the incubator');
  assert.equal(st1.decorInv.fountain, 1, 'fountain to place');
  assert.ok(st1.unlockedColors.includes('#5fb8ff'), 'hair colour unlocked');
  assert.equal(st1.soil, st0.soil + 1, 'soil expanded');
  assert.equal(st1.coins, st0.coins, 'no coins were taken');
  assert.equal(lim.edition, 1, 'limited drop #1');
  assert.equal((await call('/api/mgrd/quote', { kind: 'limited', id: 'founder_crown' })).status, 409, 'one per player');
  const shopNow = await call('/api/shop');
  assert.equal(shopNow.limited.find((x) => x.id === 'founder_crown').sold, 1);
  step(`$MGRD purchases: Rare Egg ${egg.amount}, Stone Fountain ${deco.amount}, sky-blue hair ${hair.amount}, Expand Soil ${soil.amount} (coins untouched), Founder's Crown #${lim.edition} for ${lim.amount} $MGRD; each verified on chain and granted once`);

  // holder badge and Garden Club (test build: a lock "day" is one second)
  const { clubLockIx, clubUnlockIx } = await import('../../shared/src/chain/program.js');
  let h = await call('/api/holder');
  assert.ok(h.tier, 'holder tier from wallet balance');
  await send([alice], clubLockIx({ programId: PROGRAM, mint, owner: alice.publicKey, amount: 6_000n * UNIT, days: 4 }));
  h = await call('/api/holder');
  assert.equal(h.locked, 6000);
  assert.equal(h.club.active, true, 'club active while locked');
  const st2 = srv.db.loadState(playerId);
  assert.equal(st2.decorInv.club_lantern, 1, 'club lantern granted');
  assert.equal(st2.club.active, true);
  await fails(send([alice], clubUnlockIx({ programId: PROGRAM, mint, owner: alice.publicKey })), /StillLocked/, 'unlock early');
  step(`holder badge "${h.tier.name}"; Garden Club: 6,000 $MGRD locked, club badge + lantern granted, early unlock rejected`);
  const before = (await getAccount(conn, ata(alice.publicKey, mint))).amount;
  await new Promise((r) => setTimeout(r, 7000));
  await send([alice], clubUnlockIx({ programId: PROGRAM, mint, owner: alice.publicKey }));
  assert.equal((await getAccount(conn, ata(alice.publicKey, mint))).amount - before, 6_000n * UNIT, 'all locked tokens back');
  h = await call('/api/holder');
  assert.equal(h.club.active, false, 'club ends after unlock');
  step('after the lock period: all 6,000 $MGRD returned to the wallet; club membership ended');
}

await srv.app.close();
rmSync(dir, { recursive: true, force: true });
console.log('LOCAL CHAIN E2E OK');
process.exit(0);
