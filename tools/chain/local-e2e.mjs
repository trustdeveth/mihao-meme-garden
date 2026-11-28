// The whole token layer against a private local Solana network: the real game server and the real admin tool.
// Build first (chain/scripts/build.sh and build.sh --test), then: npm run chain:e2e. Nothing public.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrivateKey, sign as edSign } from 'node:crypto';
import { Keypair, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAccount } from '@solana/spl-token';
import bs58 from 'bs58';
import WebSocket from 'ws';
import { isTestNetwork } from './admin.mjs';
import { startValidator, airdrop, makeToken, programId, wait, RPC } from './local-net.mjs';
import { createServer } from '../../server/src/app.js';
import { chainConfig } from '../../server/src/chain.js';
import * as P from '../../shared/src/chain/program.js';
import { freshState, weekKey } from '../../shared/src/rules/state.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PROGRAM = programId();
const A = P.pdas(PROGRAM);
const step = (s) => console.log(`  - ${s}`);
const signMessage = (kp, text) => {
  const key = createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', d: Buffer.from(kp.secretKey.slice(0, 32)).toString('base64url'), x: Buffer.from(kp.publicKey.toBytes()).toString('base64url') }, format: 'jwk' });
  return bs58.encode(edSign(null, Buffer.from(text), key));
};

// the admin tool must never treat an unknown network as a test network
for (const [host, genesis, expected] of [['api.mainnet-beta.solana.com', 'anything-else', false], ['my-rpc.example.com', 'anything-else', false], ['api.devnet.solana.com', 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG', true], ['127.0.0.1', 'x', true]]) {
  assert.equal(await isTestNetwork({ rpcEndpoint: `https://${host}`, getGenesisHash: async () => genesis }), expected, host);
}

async function scenario(kind, tokenProgram, decimals) {
  console.log(`\n${kind}, ${decimals} decimals`);
  const admin = Keypair.generate(), alice = Keypair.generate(), bob = Keypair.generate();
  const net = await startValidator(admin.publicKey);
  const dir = mkdtempSync(join(tmpdir(), 'mg-sol-'));
  let srv = null;
  const sockets = [];
  try {
    const { conn } = net;
    await Promise.all([airdrop(conn, admin, 20), airdrop(conn, alice), airdrop(conn, bob)]);
    const UNIT = 10n ** BigInt(decimals);
    const send = (signers, ...ixs) => sendAndConfirmTransaction(conn, new Transaction().add(...ixs), signers, { commitment: 'confirmed' });
    const holding = async (account) => (await getAccount(conn, account, 'confirmed', tokenProgram)).amount;
    const adminFile = join(dir, 'admin.json');
    writeFileSync(adminFile, JSON.stringify([...admin.secretKey])); // a throwaway test wallet, deleted below
    const db = join(dir, 'game.db');
    const tool = async (...a) => (await promisify(execFile)(process.execPath, ['--no-warnings', resolve(ROOT, 'tools/chain/admin.mjs'), ...a, '--rpc', RPC], { cwd: ROOT })).stdout;
    const { mint, mine } = await makeToken(conn, admin, { tokenProgram, decimals });
    const T = { programId: PROGRAM, mint, tokenProgram };

    // 1. the server stays off until the program really has this token
    const config = chainConfig({ MG_CHAIN_CLUSTER: 'localnet', MG_PROGRAM_ID: PROGRAM, MG_MGRD_MINT: mint.toBase58() });
    let skew = 0;
    srv = await createServer({ dbPath: db, secret: 's', now: () => Date.now() + skew, allowNoOrigin: true, chain: config, guestRate: 100, guestBurst: 100 });
    await srv.app.listen({ port: 0, host: '127.0.0.1' });
    const base = `http://127.0.0.1:${srv.app.server.address().port}`;
    const player = async () => {
      const r = await fetch(`${base}/api/guest`, { method: 'POST' });
      const cookie = r.headers.get('set-cookie').split(';')[0];
      const { playerId } = await r.json();
      const call = async (path, body) => { const x = await fetch(`${base}${path}`, { method: body ? 'POST' : 'GET', headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: x.status, ...(await x.json()) }; };
      return { playerId, cookie, call };
    };
    const me = await player(), friend = await player();
    assert.equal((await me.call('/api/chain')).enabled, false);
    assert.equal((await me.call('/api/shop')).enabled, false);

    // the admin tool: check, a dry run that sends nothing, then the real set-up
    assert.match(await tool('check-token', '--mint', mint.toBase58()), /accepts this token/);
    assert.match(await tool('init', '--mint', mint.toBase58(), '--program', PROGRAM, '--keypair', adminFile), /Nothing was sent/);
    assert.equal(await conn.getAccountInfo(A.config), null, 'a dry run changes nothing');
    assert.match(await tool('init', '--mint', mint.toBase58(), '--program', PROGRAM, '--keypair', adminFile, '--yes'), /Done\. Treasury account/);
    skew += 60_000; // past the server's retry pause
    const chain = await me.call('/api/chain');
    assert.deepEqual([chain.enabled, chain.decimals, chain.tokenProgram, chain.mint], [true, decimals, tokenProgram.toBase58(), mint.toBase58()]);
    assert.equal(chain.treasury, mine.toBase58());
    skew = 0; // back to real time: in the test build a Garden Club "day" is one second, so the clocks must agree
    assert.match(await tool('fund', '--amount', '500000', '--program', PROGRAM, '--keypair', adminFile, '--yes'), /\w{40,}/);
    assert.equal(await holding(A.vault), 500_000n * UNIT);
    step('token features stay off until the program has this token; the admin tool checks, sets up and funds it');

    // 2. wallet linking by signature
    const link = async (who, kp) => { const c = await who.call('/api/wallet/challenge', {}); return who.call('/api/wallet/link', { address: kp.publicKey.toBase58(), signature: signMessage(kp, c.message) }); };
    const c1 = await me.call('/api/wallet/challenge', {});
    assert.equal((await me.call('/api/wallet/link', { address: alice.publicKey.toBase58(), signature: signMessage(bob, c1.message) })).status, 400);
    assert.equal((await link(me, alice)).address, alice.publicKey.toBase58());
    assert.equal((await link(friend, bob)).address, bob.publicKey.toBase58());
    step('wallets are linked only by their own signature');

    // 3. a week of rewards: Season Points -> admin tool finalizes and publishes -> the player claims
    const sql = srv.db.raw;
    const WEEK = weekKey(Date.now());
    for (const p of [me, friend]) if (!srv.db.loadState(p.playerId)) srv.db.saveStates([{ pid: p.playerId, state: freshState(Date.now()) }], Date.now());
    sql.prepare('INSERT INTO season_points(player_id, week, points) VALUES(?, ?, ?)').run(me.playerId, WEEK, 700);
    for (let i = 0; i < 9; i++) {
      sql.prepare('INSERT INTO players(id, name, created_at, last_seen) VALUES(?, ?, 0, 0)').run(`p${i}`, `bot${i}`);
      sql.prepare('INSERT INTO wallets(player_id, address, linked_at) VALUES(?, ?, 0)').run(`p${i}`, Keypair.generate().publicKey.toBase58());
      sql.prepare('INSERT INTO season_points(player_id, week, points) VALUES(?, ?, ?)').run(`p${i}`, WEEK, 100 + i * 50);
    }
    assert.ok((await me.call('/api/rewards')).estimate > 0);
    assert.match(await tool('finalize', '--week', WEEK, '--force', '--program', PROGRAM, '--db', db, '--send', '--keypair', adminFile), /Published on chain/);
    const mineNow = (await me.call('/api/rewards')).allocations[0];
    assert.equal(BigInt(mineNow.amount), 1000n * UNIT, 'capped at 1% of the 100,000 pool');
    assert.equal(mineNow.claimed, false);
    const claim = P.claimIx({ ...T, payer: alice.publicKey, claimant: alice.publicKey, epochId: mineNow.epoch, index: mineNow.index, amount: BigInt(mineNow.amount), proof: mineNow.proof });
    const aliceAta = P.ata(alice.publicKey, mint, tokenProgram);
    await send([alice], P.createAtaIdempotentIx(alice.publicKey, alice.publicKey, mint, tokenProgram), claim);
    assert.equal(await holding(aliceAta), 1000n * UNIT);
    assert.equal((await me.call('/api/rewards')).allocations[0].claimed, true);
    await assert.rejects(send([alice], claim));
    step('a week is finalized and published by the tool, claimed once with the data the server hands out');

    // 4. the shop: quote -> pay on chain -> the server reads the receipt -> granted once; every kind of purchase
    await send([admin], P.createAtaIdempotentIx(admin.publicKey, bob.publicKey, mint, tokenProgram),
      P.tokenTransferIx({ from: mine, to: aliceAta, owner: admin.publicKey, mint, tokenProgram, decimals, amount: 60_000n * UNIT }));
    const pay = async (q, who = alice) => send([who], P.payOrderIx({ ...T, payer: who.publicKey, treasury: chain.treasury, orderId: q.orderId, amount: BigInt(q.amount), deadline: q.deadline }));
    const buyWith = async (kind, id, extra = {}) => {
      const q = await me.call('/api/mgrd/quote', { kind, id, ...extra });
      assert.ok(q.orderId, `${kind}:${id} quote: ${q.error ?? ''}`);
      assert.equal((await me.call('/api/shop/confirm', { orderId: q.orderId })).status, 402, 'not paid yet');
      await pay(q);
      const done = await me.call('/api/shop/confirm', { orderId: q.orderId });
      assert.equal(done.ok, true, `${kind}:${id} confirm: ${done.error ?? ''}`);
      assert.equal((await me.call('/api/shop/confirm', { orderId: q.orderId })).already, true, 'granted only once');
      return { ...done, quote: q };
    };
    const item = (await me.call('/api/shop')).items[0];
    assert.equal(BigInt(item.mgrd), BigInt(item.price) * UNIT, 'priced in the token\'s own decimals');
    const [vaultBefore, treasuryBefore] = [await holding(A.vault), await holding(mine)];
    const first = await buyWith('wear', item.id);
    assert.equal((await holding(A.vault)) - vaultBefore, BigInt(first.quote.amount) / 2n);
    assert.equal((await holding(mine)) - treasuryBefore, BigInt(first.quote.amount) - BigInt(first.quote.amount) / 2n);
    await assert.rejects(pay(first.quote), 'the same order cannot be paid twice');
    const before = srv.db.loadState(me.playerId);
    await buyWith('egg', 'rare');
    await buyWith('decor', 'fountain');
    await buyWith('hair', '#5fb8ff');
    await buyWith('soil', '');
    const crown = await buyWith('limited', 'founder_crown');
    const after = srv.db.loadState(me.playerId);
    assert.deepEqual([after.eggs.length, after.decorInv.fountain, after.unlockedColors.includes('#5fb8ff'), after.soil, after.coins], [(before.eggs?.length ?? 0) + 1, 1, true, before.soil + 1, before.coins]);
    assert.equal(crown.edition, 1);
    assert.equal((await me.call('/api/mgrd/quote', { kind: 'limited', id: 'founder_crown' })).status, 409);
    step('shop: outfit, egg, decoration, hair colour, soil and a limited drop, each checked on chain and granted once');

    // 5. village things: the pot, a tip between neighbours, holder badge and Garden Club
    const join_ = async (who) => {
      const { ticket } = await who.call('/api/ws-ticket', {});
      const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?ticket=${ticket}`);
      sockets.push(ws);
      return new Promise((res, rej) => { ws.on('error', rej); ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: 1 }))); ws.on('message', (d) => { const m = JSON.parse(String(d)); if (m.t === 'welcome') res(m); }); });
    };
    await join_(me);
    const neighbour = await join_(friend);
    const pot = (await me.call('/api/community')).pot;
    await buyWith('pot', String(pot.amounts[0]));
    const community = await me.call('/api/community');
    assert.equal(BigInt(community.pot.total), BigInt(community.pot.mgrd[0]));
    assert.equal(BigInt(community.pot.goal), 100_000n * UNIT);
    assert.ok(BigInt(community.burns.pending) > 0n);
    const to = await me.call('/api/tip/recipient', { slot: neighbour.you.slot });
    assert.equal(to.wallet, bob.publicKey.toBase58());
    const tipAmount = BigInt(to.amounts[0]) * UNIT;
    const tip = await send([alice], P.createAtaIdempotentIx(alice.publicKey, bob.publicKey, mint, tokenProgram),
      P.tokenTransferIx({ from: aliceAta, to: P.ata(bob.publicKey, mint, tokenProgram), owner: alice.publicKey, mint, tokenProgram, decimals, amount: tipAmount }));
    assert.equal((await me.call('/api/tip/confirm', { signature: tip, slot: neighbour.you.slot })).amount, to.amounts[0]);
    assert.equal((await me.call('/api/tip/confirm', { signature: tip, slot: neighbour.you.slot })).already, true);
    assert.equal(BigInt((await friend.call('/api/community')).tips.received), tipAmount);
    let holder = await me.call('/api/holder');
    assert.ok(holder.tier);
    await send([alice], P.clubLockIx({ ...T, owner: alice.publicKey, amount: 6000n * UNIT, days: 6 }));
    holder = await me.call('/api/holder');
    assert.deepEqual([holder.locked, holder.club.active], [6000, true]);
    await assert.rejects(send([alice], P.clubUnlockIx({ ...T, owner: alice.publicKey })));
    const held = await holding(aliceAta);
    await wait(8000);
    await send([alice], P.clubUnlockIx({ ...T, owner: alice.publicKey }));
    assert.equal((await holding(aliceAta)) - held, 6000n * UNIT);
    assert.equal((await me.call('/api/holder')).club.active, false);
    step('village fund, verified tips, holder badge and Garden Club');

    // 6. a burn through the tool, and a server pointed at the wrong token keeps everything off
    assert.match(await tool('burn', '--amount', '10', '--program', PROGRAM, '--keypair', adminFile, '--db', db, '--note', 'test'), /Burned 10 MGRD/);
    assert.match(await tool('status', '--program', PROGRAM), /shareKeptForRewards: '50%'/);
    const other = await makeToken(conn, admin, { tokenProgram, decimals });
    const wrong = await createServer({ dbPath: join(dir, 'wrong.db'), secret: 's', allowNoOrigin: true, chain: chainConfig({ MG_CHAIN_CLUSTER: 'localnet', MG_PROGRAM_ID: PROGRAM, MG_MGRD_MINT: other.mint.toBase58() }) });
    const answer = (await wrong.app.inject({ url: '/api/chain' })).json();
    assert.deepEqual([answer.enabled, answer.shop], [false, false]);
    await wrong.app.close();
    step('burns are recorded; a server set to a different token keeps the token features off');
  } finally {
    for (const ws of sockets) ws.close();
    await srv?.app.close();
    await net.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

await scenario('Classic Solana token', TOKEN_PROGRAM_ID, 6);
await scenario('Token-2022 token', TOKEN_2022_PROGRAM_ID, 9);
console.log('\nSOLANA GAME TEST OK');
process.exit(0);
