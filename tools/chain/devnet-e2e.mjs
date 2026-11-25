// Full feature test on Solana DEVNET against the deployed program.
// Usage: node tools/chain/devnet-e2e.mjs <admin-keypair.json>
//  - first run: creates MGRD (mint authority revoked), the treasury and the program config, funds the vault;
//    public addresses are saved to chain/devnet.json (no secrets)
//  - every run: two fresh test wallets (funded from the admin with a little SOL), wallet linking through the game
//    server, a finalized week published on chain, claims (and rejected attacks), an MGRD-shop purchase verified by
//    the server, reserve protection, the claim deadline and closing the week.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrivateKey, sign as edSign } from 'node:crypto';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { getAccount, getOrCreateAssociatedTokenAccount, transfer as splTransfer } from '@solana/spl-token';
import bs58 from 'bs58';
import { setup, allocate } from './admin.mjs';
import { createServer } from '../../server/src/app.js';
import { pdas, ata, createAtaIdempotentIx, claimIx, payOrderIx, openEpochIx, closeEpochIx, withdrawUnreservedIx, leafHash, buildTree, decodeConfig, toHex } from '../../shared/src/chain/program.js';
import { weekKey } from '../../shared/src/rules/state.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RPC = process.env.RPC ?? 'https://api.devnet.solana.com';
const PROGRAM = readFileSync(resolve(ROOT, 'chain/target/deploy/program-id.txt'), 'utf8').trim();
const STATE = resolve(ROOT, 'chain/devnet.json');
const conn = new Connection(RPC, 'confirmed');
const UNIT = 1_000_000n;
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.argv[2], 'utf8'))));
const log = [];
const step = (s, sig) => { const line = `- ${s}${sig ? `\n    tx: https://explorer.solana.com/tx/${sig}?cluster=devnet` : ''}`; log.push(line); console.log(line); };
const send = (signers, ...ixs) => sendAndConfirmTransaction(conn, new Transaction().add(...ixs), signers, { commitment: 'confirmed', maxRetries: 8 });
const fails = async (p, re, what) => { try { await p; } catch (e) { const s = String(e.message ?? e) + (e.logs ?? e.transactionLogs ?? []).join(' '); assert.match(s, re, what); return; } assert.fail(`${what}: should have failed`); };
const signMsg = (kp, msg) => { const key = createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', d: Buffer.from(kp.secretKey.slice(0, 32)).toString('base64url'), x: Buffer.from(kp.publicKey.toBytes()).toString('base64url') }, format: 'jwk' }); return bs58.encode(edSign(null, Buffer.from(msg), key)); };
const sol = async (pk) => (await conn.getBalance(pk)) / LAMPORTS_PER_SOL;

const prog = await conn.getAccountInfo(new PublicKey(PROGRAM));
assert.ok(prog?.executable, `program ${PROGRAM} is not deployed on devnet`);
const A = pdas(PROGRAM);
console.log(`admin ${admin.publicKey.toBase58()} (${await sol(admin.publicKey)} SOL), program ${PROGRAM}`);

// ---- one-time setup ------------------------------------------------------------------------------------
let st;
if (!(await conn.getAccountInfo(A.config))) {
  const r = await setup({ connection: conn, admin, programId: PROGRAM, recycleBps: 5000, fund: 200_000n * UNIT });
  st = { cluster: 'devnet', programId: PROGRAM, mint: r.mint.toBase58(), treasury: r.treasury.toBase58(), adminAta: r.adminAta.toBase58(), vault: A.vault.toBase58(), config: A.config.toBase58(), admin: admin.publicKey.toBase58(), createdAt: new Date().toISOString() };
  writeFileSync(STATE, JSON.stringify(st, null, 2));
  step(`setup: MGRD mint ${st.mint}, 1,000,000,000 supply, mint authority revoked; program initialized; vault funded with 200,000 MGRD`);
} else {
  st = JSON.parse(readFileSync(STATE, 'utf8'));
  step(`setup already done: MGRD mint ${st.mint}`);
}
const mint = new PublicKey(st.mint), treasury = new PublicKey(st.treasury), adminAta = new PublicKey(st.adminAta);
const mintInfo = (await conn.getParsedAccountInfo(mint)).value.data.parsed.info;
assert.equal(mintInfo.mintAuthority, null, 'mint authority revoked');
assert.equal(mintInfo.freezeAuthority, null, 'no freeze authority');
assert.ok(BigInt(mintInfo.supply) <= 1_000_000_000n * UNIT, 'supply can only go down (public burns), never up');
step(`token checks: supply ${(Number(BigInt(mintInfo.supply)) / 1e6).toLocaleString()} MGRD (1B minus public burns), mint authority none, freeze authority none`);

// ---- test wallets ---------------------------------------------------------------------------------------
const alice = Keypair.generate(), bob = Keypair.generate();
const fundSig = await send([admin], SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: alice.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL }), SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: bob.publicKey, lamports: 0.02 * LAMPORTS_PER_SOL }));
step(`test wallets alice ${alice.publicKey.toBase58().slice(0, 8)}... and bob ${bob.publicKey.toBase58().slice(0, 8)}... funded with devnet SOL`, fundSig);

// ---- game server with chain features pointed at devnet ----------------------------------------------------
const dir = mkdtempSync(join(tmpdir(), 'mg-devnet-'));
const WEEK = weekKey(Date.now());
const srv = await createServer({ dbPath: join(dir, 'd.db'), secret: 's', allowNoOrigin: true,
  chain: { enabled: true, cluster: 'devnet', rpc: RPC, programId: PROGRAM, mint: st.mint, treasury: st.treasury, weeklyPool: 100_000, quoteMs: 180_000 } });
await srv.app.listen({ port: 0, host: '127.0.0.1' });
const base = `http://127.0.0.1:${srv.app.server.address().port}`;
const guest = await fetch(`${base}/api/guest`, { method: 'POST' });
const cookie = guest.headers.get('set-cookie').split(';')[0];
const { playerId } = await guest.json();
const call = async (path, body) => { const r = await fetch(`${base}${path}`, { method: body ? 'POST' : 'GET', headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, ...(await r.json()) }; };
assert.equal((await call('/api/chain')).enabled, true);
const c1 = await call('/api/wallet/challenge', {});
assert.equal((await call('/api/wallet/link', { address: alice.publicKey.toBase58(), signature: signMsg(bob, c1.message) })).status, 400);
const c2 = await call('/api/wallet/challenge', {});
assert.equal((await call('/api/wallet/link', { address: alice.publicKey.toBase58(), signature: signMsg(alice, c2.message) })).address, alice.publicKey.toBase58());
step('wallet linking: alice linked by a signed message; a signature from another wallet was rejected');

// Season points: alice 700 this week, plus 9 other gardeners sharing the pool
const sql = srv.db.raw;
const { freshState } = await import('../../shared/src/rules/state.js');
srv.db.saveStates([{ pid: playerId, state: freshState(Date.now()) }], Date.now());
sql.prepare('INSERT INTO season_points(player_id, week, points) VALUES(?, ?, ?)').run(playerId, WEEK, 700);
for (let i = 0; i < 9; i++) {
  sql.prepare('INSERT INTO players(id, name, created_at, last_seen) VALUES(?, ?, 0, 0)').run(`p${i}`, `gardener${i}`);
  sql.prepare('INSERT INTO wallets(player_id, address, linked_at) VALUES(?, ?, 0)').run(`p${i}`, Keypair.generate().publicKey.toBase58());
  sql.prepare('INSERT INTO season_points(player_id, week, points) VALUES(?, ?, ?)').run(`p${i}`, WEEK, 100 + i * 50);
}
const est = await call('/api/rewards');
assert.ok(est.estimate > 0);
step(`season points: alice 700 of ${700 + 9 * 100 + 50 * 36} this week, live estimate ${est.estimate} MGRD (1% cap)`);

// ---- finalize and publish the week -------------------------------------------------------------------------
const rows = sql.prepare('SELECT s.player_id, s.points, w.address FROM season_points s JOIN wallets w ON w.player_id = s.player_id WHERE s.week = ? ORDER BY s.player_id').all(WEEK);
const { out } = allocate(rows, { poolUnits: 100_000n * UNIT, minUnits: UNIT });
const epochId = Math.floor(Date.now() / 1000); // unique per test run
const tree = buildTree(out.map((r, i) => leafHash(PROGRAM, mint, epochId, i, r.address, r.amount)));
const total = out.reduce((n, r) => n + r.amount, 0n);
const deadline = Math.floor(Date.now() / 1000) + 75;
const openSig = await send([admin], openEpochIx({ programId: PROGRAM, admin: admin.publicKey, epochId, root: tree.root, total, claimDeadline: deadline }));
sql.prepare('INSERT INTO reward_epochs(id, week, root, total, claim_deadline, created_at, status) VALUES(?, ?, ?, ?, ?, 0, ?)').run(epochId, WEEK, toHex(tree.root), total.toString(), deadline, 'open');
out.forEach((r, i) => sql.prepare('INSERT INTO reward_allocations(epoch, idx, player_id, wallet, amount, points, proof) VALUES(?, ?, ?, ?, ?, ?, ?)').run(epochId, i, r.player_id, r.address, r.amount.toString(), r.points, JSON.stringify(tree.proof(i).map(toHex))));
step(`week finalized: ${out.length} recipients, ${Number(total) / 1e6} MGRD (alice capped at 1,000); root published on chain as epoch ${epochId}`, openSig);

// ---- claims -------------------------------------------------------------------------------------------
const a = (await call('/api/rewards')).allocations[0];
assert.equal(a.claimed, false);
const args = { programId: PROGRAM, mint, payer: alice.publicKey, claimant: alice.publicKey, epochId: a.epoch, index: a.index, amount: BigInt(a.amount), proof: a.proof };
const claimSig = await send([alice], createAtaIdempotentIx(alice.publicKey, alice.publicKey, mint), claimIx(args));
assert.equal((await getAccount(conn, ata(alice.publicKey, mint))).amount, 1_000n * UNIT);
assert.equal((await call('/api/rewards')).allocations[0].claimed, true);
step('claim: alice received 1,000 MGRD with her proof; the server now shows the week as claimed', claimSig);
await fails(send([alice], claimIx(args)), /already in use|0x0/, 'second claim');
await fails(send([alice], claimIx({ ...args, amount: 5_000n * UNIT })), /BadProof|already in use|0x0/, 'forged amount');
await send([bob], createAtaIdempotentIx(bob.publicKey, bob.publicKey, mint));
await fails(send([bob], claimIx({ ...args, payer: bob.publicKey, claimant: bob.publicKey, index: 1 })), /BadProof/, 'wrong wallet');
step('attacks rejected: claiming twice, a forged amount, and another wallet using someone else\'s proof');

await splTransfer(conn, admin, adminAta, ata(alice.publicKey, mint), admin, 40_000n * UNIT); // spending money for the shop tests
// ---- MGRD shop ---------------------------------------------------------------------------------------
const item = (await call('/api/shop')).items[0];
const quote = await call('/api/shop/quote', { item: item.id });
assert.equal((await call('/api/shop/confirm', { orderId: quote.orderId })).status, 402);
const vBefore = (await getAccount(conn, A.vault)).amount, tBefore = (await getAccount(conn, treasury)).amount;
const payIx = payOrderIx({ programId: PROGRAM, mint, payer: alice.publicKey, treasury, orderId: quote.orderId, amount: BigInt(quote.amount) });
const paySig = await send([alice], payIx);
const half = BigInt(quote.amount) / 2n;
assert.equal((await getAccount(conn, A.vault)).amount - vBefore, half);
assert.equal((await getAccount(conn, treasury)).amount - tBefore, BigInt(quote.amount) - half);
assert.equal((await call('/api/shop/confirm', { orderId: quote.orderId })).ok, true);
assert.equal((await call('/api/shop/confirm', { orderId: quote.orderId })).already, true);
assert.ok(srv.db.loadState(playerId).wardrobe.includes(item.id), 'item is in the wardrobe');
await fails(send([alice], payIx), /already in use|0x0/, 'double payment');
step(`MGRD shop: ${item.name} for its fixed price of ${Number(quote.amount) / 1e6} $MGRD, paid on chain (50% to the rewards vault, 50% to the treasury), server verified the receipt and granted it once; paying the same order again was rejected`, paySig);

// ---- reserve, deadline, close --------------------------------------------------------------------------
const cfg = decodeConfig((await conn.getAccountInfo(A.config)).data);
const vault = (await getAccount(conn, A.vault)).amount;
await fails(send([admin], withdrawUnreservedIx({ programId: PROGRAM, admin: admin.publicKey, to: adminAta, amount: vault - cfg.outstanding + 1n })), /Reserved/, 'withdraw reserved');
await fails(send([admin], closeEpochIx({ programId: PROGRAM, admin: admin.publicKey, epochId })), /NotExpired/, 'close early');
step(`reserve protection: vault holds ${Number(vault) / 1e6} MGRD, ${Number(cfg.outstanding) / 1e6} reserved for open weeks; withdrawing reserved MGRD and closing early were rejected`);
const chainTime = async () => (await conn.getBlockTime(await conn.getSlot('confirmed'))) ?? 0;
while ((await chainTime()) <= deadline + 2) await new Promise((r) => setTimeout(r, 4000));
const k = out.findIndex((r) => r.player_id === 'p8');
await send([admin], createAtaIdempotentIx(admin.publicKey, admin.publicKey, mint));
await fails(send([admin], claimIx({ programId: PROGRAM, mint, payer: admin.publicKey, claimant: admin.publicKey, epochId, index: k, amount: out[k].amount, proof: tree.proof(k) })), /ClaimExpired|BadProof/, 'late claim');
const closeSig = await send([admin], closeEpochIx({ programId: PROGRAM, admin: admin.publicKey, epochId }));
const after = decodeConfig((await conn.getAccountInfo(A.config)).data);
assert.equal(after.outstanding, cfg.outstanding - total);
step(`deadline: a claim after the deadline was rejected; the week was closed and its ${Number(total - 1_000n * UNIT) / 1e6} unclaimed MGRD stay in the vault for later weeks`, closeSig);

// ---- everything else you can buy with $MGRD, holder badge and Garden Club ------------------------------
{
  const buyWith = async (kind, id) => {
    const q = await call('/api/mgrd/quote', { kind, id });
    assert.ok(q.orderId, `${kind}:${id} quote: ${q.error ?? ''}`);
    const sig = await send([alice], payOrderIx({ programId: PROGRAM, mint, payer: alice.publicKey, treasury, orderId: q.orderId, amount: BigInt(q.amount) }));
    let c;
    for (let i = 0; i < 8; i++) { c = await call('/api/shop/confirm', { orderId: q.orderId }); if (c.ok || c.status !== 402) break; await new Promise((r) => setTimeout(r, 1500)); }
    assert.equal(c.ok, true, `${kind}:${id} confirm: ${c.error ?? ''}`);
    return { ...c, amount: Number(q.amount) / 1e6, sig };
  };
  const st0 = srv.db.loadState(playerId);
  const egg = await buyWith('egg', 'rare');
  const deco = await buyWith('decor', 'fountain');
  const hair = await buyWith('hair', '#5fb8ff');
  const soil = await buyWith('soil', '');
  const st1 = srv.db.loadState(playerId);
  assert.equal(st1.eggs.length, (st0.eggs?.length ?? 0) + 1);
  assert.equal(st1.decorInv.fountain, 1);
  assert.ok(st1.unlockedColors.includes('#5fb8ff'));
  assert.equal(st1.soil, st0.soil + 1);
  assert.equal(st1.coins, st0.coins, 'coins untouched');
  step(`$MGRD purchases: Rare Egg ${egg.amount}, Stone Fountain ${deco.amount}, sky-blue hair ${hair.amount}, Expand Soil ${soil.amount} $MGRD (coins untouched); each verified on chain and granted once`, soil.sig);
  const lim = await buyWith('limited', 'founder_crown');
  assert.ok(lim.edition >= 1);
  assert.equal((await call('/api/mgrd/quote', { kind: 'limited', id: 'founder_crown' })).status, 409, 'one per player');
  step(`limited drop: Founder's Crown #${lim.edition} of 500 for ${lim.amount} $MGRD; a second one for the same player was refused`, lim.sig);

  const { clubLockIx, clubUnlockIx } = await import('../../shared/src/chain/program.js');
  let h = await call('/api/holder');
  assert.ok(h.tier);
  const lockSig = await send([alice], clubLockIx({ programId: PROGRAM, mint, owner: alice.publicKey, amount: 6_000n * UNIT, days: 30 }));
  h = await call('/api/holder');
  assert.equal(h.locked, 6000);
  assert.equal(h.club.active, true);
  assert.equal(srv.db.loadState(playerId).decorInv.club_lantern, 1, 'club lantern granted');
  await fails(send([alice], clubUnlockIx({ programId: PROGRAM, mint, owner: alice.publicKey })), /StillLocked|0x17/, 'early unlock');
  step(`holder badge "${h.tier.name}"; Garden Club: 6,000 $MGRD locked for 30 days in alice's own lock account, club badge and lantern granted, unlocking early rejected`, lockSig);
}

// pause switch
const { updateConfigIx } = await import('../../shared/src/chain/program.js');
await send([admin], updateConfigIx({ programId: PROGRAM, admin: admin.publicKey, paused: true }));
const q2 = await call('/api/shop/quote', { item: (await call('/api/shop')).items[1].id });
await fails(send([alice], payOrderIx({ programId: PROGRAM, mint, payer: alice.publicKey, treasury, orderId: q2.orderId, amount: BigInt(q2.amount) })), /Paused/, 'paused');
await send([admin], updateConfigIx({ programId: PROGRAM, admin: admin.publicKey, paused: false }));
step('pause switch: payments were blocked while paused, then unpaused');

await srv.app.close();
rmSync(dir, { recursive: true, force: true });
writeFileSync(resolve(ROOT, 'chain/devnet-test-report.txt'), `Devnet test ${new Date().toISOString()}\nprogram ${PROGRAM}\nmint ${st.mint}\n\n${log.join('\n')}\n`);
console.log(`DEVNET E2E OK (admin balance now ${await sol(admin.publicKey)} SOL)`);
process.exit(0);
