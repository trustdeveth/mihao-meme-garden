// Devnet test of the $MGRD community features with two players in the same village:
// tips, gifts, the Fireworks Pot, naming the fountain, holder votes, a public burn, and $MGRD-only eggs/decor.
// Usage: node tools/chain/devnet-community.mjs <admin-keypair.json>   (RPC=... optional)
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createPrivateKey, sign as edSign } from 'node:crypto';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { getAccount, transfer as splTransfer, burn as splBurn } from '@solana/spl-token';
import bs58 from 'bs58';
import { createServer } from '../../server/src/app.js';
import { ata, createAtaIdempotentIx, payOrderIx, tokenTransferIx } from '../../shared/src/chain/program.js';
import { freshState } from '../../shared/src/rules/state.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WebSocket = createRequire(resolve(ROOT, 'server/package.json'))('ws');
const RPC = process.env.RPC ?? 'https://api.devnet.solana.com';
const st = JSON.parse(readFileSync(resolve(ROOT, 'chain/devnet.json'), 'utf8'));
const conn = new Connection(RPC, 'confirmed');
const UNIT = 1_000_000n;
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.argv[2], 'utf8'))));
const mint = new PublicKey(st.mint), treasury = new PublicKey(st.treasury), adminAta = new PublicKey(st.adminAta);
const log = [];
const step = (s, sig) => { const l = `- ${s}${sig ? `\n    tx: https://explorer.solana.com/tx/${sig}?cluster=devnet` : ''}`; log.push(l); console.log(l); };
const send = (signers, ...ixs) => sendAndConfirmTransaction(conn, new Transaction().add(...ixs), signers, { commitment: 'confirmed', maxRetries: 8 });
const signMsg = (kp, msg) => { const key = createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', d: Buffer.from(kp.secretKey.slice(0, 32)).toString('base64url'), x: Buffer.from(kp.publicKey.toBytes()).toString('base64url') }, format: 'jwk' }); return bs58.encode(edSign(null, Buffer.from(msg), key)); };

// server pointed at devnet; a low pot goal so the test can fill it
const dir = mkdtempSync(join(tmpdir(), 'mg-comm-'));
const srv = await createServer({ dbPath: join(dir, 'c.db'), secret: 's', allowNoOrigin: true,
  chain: { enabled: true, cluster: 'devnet', rpc: RPC, programId: st.programId, mint: st.mint, treasury: st.treasury, weeklyPool: 100_000, quoteMs: 180_000, potGoal: 500, burnBps: 2000 } });
await srv.app.listen({ port: 0, host: '127.0.0.1' });
const base = `http://127.0.0.1:${srv.app.server.address().port}`;

/** A player: guest session, wallet, linked, and connected to the game (so both share a village). */
async function player(kp) {
  const g = await fetch(`${base}/api/guest`, { method: 'POST' });
  const cookie = g.headers.get('set-cookie').split(';')[0];
  const { playerId } = await g.json();
  const call = async (path, body) => { const r = await fetch(`${base}${path}`, { method: body ? 'POST' : 'GET', headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, ...(await r.json()) }; };
  const { message } = await call('/api/wallet/challenge', {});
  assert.ok((await call('/api/wallet/link', { address: kp.publicKey.toBase58(), signature: signMsg(kp, message) })).address);
  const { ticket } = await call('/api/ws-ticket', {});
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?ticket=${ticket}`);
  const msgs = [];
  let slot = -1;
  ws.on('message', (d) => { const m = JSON.parse(String(d)); msgs.push(m); if (m.t === 'welcome') slot = m.you.slot; });
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ t: 'hello', v: 1 }));
  while (slot < 0) await new Promise((r) => setTimeout(r, 50));
  let seq = 0;
  const act = (a, p = {}) => new Promise((res) => { const id = ++seq; const h = (d) => { const m = JSON.parse(String(d)); if (m.t === 'res' && m.id === id) { ws.off('message', h); res(m); } }; ws.on('message', h); ws.send(JSON.stringify({ t: 'act', id, a, p })); });
  return { kp, playerId, call, ws, msgs, slot, act };
}
async function payQuote(p, body) {
  const q = await p.call('/api/mgrd/quote', body);
  assert.ok(q.orderId, `quote ${JSON.stringify(body)}: ${q.error ?? ''}`);
  const sig = await send([p.kp], payOrderIx({ programId: st.programId, mint, payer: p.kp.publicKey, treasury, orderId: q.orderId, amount: BigInt(q.amount) }));
  let c;
  for (let i = 0; i < 8; i++) { c = await p.call('/api/shop/confirm', { orderId: q.orderId }); if (c.ok || c.status !== 402) break; await new Promise((r) => setTimeout(r, 1500)); }
  assert.equal(c.ok, true, `confirm: ${c.error ?? ''}`);
  return { ...c, sig, amount: Number(q.amount) / 1e6 };
}

const aliceKp = Keypair.generate(), bobKp = Keypair.generate();
await send([admin], SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: aliceKp.publicKey, lamports: 0.06 * LAMPORTS_PER_SOL }), SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: bobKp.publicKey, lamports: 0.03 * LAMPORTS_PER_SOL }));
await send([admin], createAtaIdempotentIx(admin.publicKey, aliceKp.publicKey, mint), createAtaIdempotentIx(admin.publicKey, bobKp.publicKey, mint));
await splTransfer(conn, admin, adminAta, ata(aliceKp.publicKey, mint), admin, 20_000n * UNIT);
const alice = await player(aliceKp), bob = await player(bobKp);
assert.equal(srv.rooms.byPlayer.get(alice.playerId).room, srv.rooms.byPlayer.get(bob.playerId).room, 'same village');
step(`two gardeners in the same village, wallets linked; alice holds 20,000 $MGRD, bob none`);

// $MGRD-only eggs and decor: coins are refused
await alice.act('travel', { to: 'pets' });
assert.equal((await alice.act('buyEgg', { id: 'common' })).code, 'mgrd');
await alice.act('travel', { to: 'seeds' });
assert.equal((await alice.act('buyDecor', { id: 'crate' })).code, 'mgrd');
const egg = await payQuote(alice, { kind: 'egg', id: 'common' });
step(`pet eggs and decorations are $MGRD-only: buying with coins is refused; a Common Egg for ${egg.amount} $MGRD works`, egg.sig);

// tip: wallet to wallet, verified on chain, announced
const rcp = await alice.call('/api/tip/recipient', { slot: bob.slot });
assert.equal(rcp.wallet, bobKp.publicKey.toBase58());
const tipSig = await send([aliceKp], tokenTransferIx({ from: ata(aliceKp.publicKey, mint), to: ata(bobKp.publicKey, mint), owner: aliceKp.publicKey, amount: 50n * UNIT }));
const tip = await alice.call('/api/tip/confirm', { signature: tipSig, slot: bob.slot });
assert.equal(tip.amount, 50);
assert.equal((await alice.call('/api/tip/confirm', { signature: tipSig, slot: bob.slot })).already, true, 'one tip counted once');
assert.equal((await getAccount(conn, ata(bobKp.publicKey, mint))).amount, 50n * UNIT);
await new Promise((r) => setTimeout(r, 300));
assert.ok(bob.msgs.some((m) => m.t === 'toast' && /tipped you 50/.test(m.msg)), 'bob was told');
step('tip: alice sent bob 50 $MGRD wallet to wallet; the server checked it on chain, told bob and the village, and counts it once', tipSig);

// gift
const gift = await payQuote(alice, { kind: 'gift', id: 'shirt_aurora', to: bob.slot });
const bobState = srv.rooms.byPlayer.get(bob.playerId).member.state;
assert.ok(bobState.wardrobe.includes('shirt_aurora'), 'bob got the shirt');
assert.ok(!(srv.rooms.byPlayer.get(alice.playerId).member.state.wardrobe ?? []).includes('shirt_aurora'), 'not alice');
assert.equal((await alice.call('/api/mgrd/quote', { kind: 'gift', id: 'shirt_aurora', to: bob.slot })).status, 409, 'cannot gift what they already own');
step(`gift: alice bought the Aurora Shirt for bob (${gift.amount} $MGRD); it went into bob's wardrobe`, gift.sig);

// fireworks pot (goal 500 for the test)
const pot = await payQuote(alice, { kind: 'pot', id: '1000' });
const vb = await (await fetch(`${base}/api/village-board`)).json();
assert.equal(vb.fireworks, true, 'pot full -> fireworks');
step(`Fireworks Pot: alice put in ${pot.amount} $MGRD; the pot is full, so the plaza shows fireworks for everyone`, pot.sig);

// name the fountain
const nm = await payQuote(alice, { kind: 'name', id: 'Alice Springs' });
const vb2 = await (await fetch(`${base}/api/village-board`)).json();
assert.equal(vb2.plaque.text, 'Alice Springs');
step(`naming: alice named the fountain "Alice Springs" for 7 days (${nm.amount} $MGRD); everyone sees the plaque`, nm.sig);

// votes
srv.chain.community.createPoll('Next festival theme?', ['Moon Fair', 'Candy Week', 'Pirate Days'], 7);
const pl = (await alice.call('/api/community')).polls[0];
const v = await alice.call('/api/vote', { poll: pl.id, option: 1 });
assert.equal(v.ok, true);
assert.equal((await alice.call('/api/vote', { poll: pl.id, option: 0 })).status, 409, 'one vote per wallet');
assert.equal((await bob.call('/api/vote', { poll: pl.id, option: 2 })).status, 403, 'bob (50 $MGRD) is below Sprout');
const after = (await alice.call('/api/community')).polls[0];
assert.equal(after.options[1].weight, v.weight);
step(`holder vote: alice (badge weight ${v.weight}) voted "Candy Week"; a second vote and a vote below the Sprout badge were refused`);

// public burn from the treasury, recorded and shown
const pendingBefore = BigInt((await alice.call('/api/community')).burns.pending);
assert.ok(pendingBefore > 0n, '20% of shop revenue waiting for the next burn');
const before = BigInt((await conn.getTokenSupply(mint)).value.amount);
const burnSig = await splBurn(conn, admin, treasury, mint, admin, 100n * UNIT);
srv.chain.community.recordBurn(burnSig, 100n * UNIT, 'devnet test burn');
const supply = BigInt((await conn.getTokenSupply(mint)).value.amount);
assert.equal(before - supply, 100n * UNIT, 'supply went down by 100');
const cm = await alice.call('/api/community');
assert.equal(cm.burns.total, String(100n * UNIT));
assert.equal(BigInt(cm.burns.pending), pendingBefore > 100n * UNIT ? pendingBefore - 100n * UNIT : 0n, 'pending = set aside minus burned');
step(`public burn: 100 $MGRD burned from the treasury (total supply now ${(Number(supply) / 1e6).toLocaleString('en-US')}); the game lists it with its transaction; of the ${Number(pendingBefore) / 1e6} $MGRD set aside (20% of shop revenue), ${Number(cm.burns.pending) / 1e6} still waits for the next burn`, burnSig);

alice.ws.close(); bob.ws.close();
await srv.app.close();
rmSync(dir, { recursive: true, force: true });
writeFileSync(resolve(ROOT, 'chain/devnet-community-report.txt'), `Devnet community test ${new Date().toISOString()}\n\n${log.join('\n')}\n`);
console.log(`DEVNET COMMUNITY OK (admin ${(await conn.getBalance(admin.publicKey)) / 1e9} SOL)`);
process.exit(0);
