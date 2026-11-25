// Full contract + backend test on a LOCAL chain (it starts Foundry's anvil itself). Nothing public is touched.
// It deploys with the operator tool, then drives the real game server: wallet linking, the weekly claim, every
// $MGRD purchase, tips, the Garden Club, burns, and the things that must be refused.
// Usage: npm run chain:e2e        (needs Foundry's anvil; run `npm run chain:build` first after contract changes)
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestClient, http, toHex } from 'viem';
import { mnemonicToAccount, generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import WebSocket from 'ws';
import { clients, send, deploy, artifact, DEAD } from './admin.mjs';
import { createServer } from '../../server/src/app.js';
import { TOKEN_ABI, REWARDS_ABI, leafHash, claimCall, payOrderCall, approveCall, transferCall, clubLockCall, clubUnlockCall } from '../../shared/src/chain/evm.js';
import { weekKey, freshState } from '../../shared/src/rules/state.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.ANVIL_PORT ?? 8599);
const RPC = `http://127.0.0.1:${PORT}`;
const UNIT = 10n ** 18n;
const M = (n) => BigInt(n) * UNIT;
const step = (s) => console.log(`- ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = promisify(execFile);

const anvil = spawn(process.env.ANVIL ?? 'anvil', ['--port', String(PORT), '--chain-id', '31337', '--silent'], { stdio: 'ignore' });
const dir = mkdtempSync(join(tmpdir(), 'mg-chain-'));
process.on('exit', () => { anvil.kill(); try { rmSync(dir, { recursive: true, force: true }); } catch { /* in use */ } });

// anvil's standard TEST accounts (public knowledge, worthless anywhere else)
const dev = (i) => mnemonicToAccount('test test test test test test test test test test test junk', { addressIndex: i });
const KEY0 = toHex(dev(0).getHdKey().privateKey);
const who = (i) => clients({ cluster: 'local', rpc: RPC, account: dev(i) });
const admin = who(0), alice = who(1), bob = who(2), treasury = who(3), stranger = who(4);
const A = alice.account.address, B = bob.account.address, T = treasury.account.address;
const node = createTestClient({ chain: admin.chain, transport: http(RPC), mode: 'anvil' });

for (let i = 0; ; i++) { try { await admin.pub.getChainId(); break; } catch { if (i > 100) throw new Error('anvil did not start'); await sleep(100); } }

let ahead = 0; // how far the chain clock has been pushed forward; the game server's clock follows it
async function timeTravel(seconds) { await node.increaseTime({ seconds }); await node.mine({ blocks: 1 }); ahead += seconds * 1000; }
const nowSec = async () => Number((await admin.pub.getBlock()).timestamp);

// 1. deploy the rewards contract FIRST; the token (launched elsewhere) is named afterwards
async function create(name, params) {
  const a = artifact(name);
  const hash = await admin.wallet.deployContract({ abi: a.abi, bytecode: a.bytecode, args: params });
  return (await admin.pub.waitForTransactionReceipt({ hash })).contractAddress;
}
const D = await deploy(admin, { treasury: T, recycleBps: 5000 });
const rw = (functionName, args = []) => admin.pub.readContract({ address: D.rewards, abi: REWARDS_ABI, functionName, args });
const onRewards = (functionName, args) => ({ address: D.rewards, abi: REWARDS_ABI, functionName, args });
/** The contract must refuse this call with the named error, and nothing is sent. */
async function refused(c, call, name, what = name) {
  try { await c.pub.simulateContract({ ...call, account: c.account }); } catch (e) {
    const got = e.walk?.((x) => x?.data?.errorName)?.data?.errorName ?? e.shortMessage ?? e.message;
    assert.equal(got, name, `${what}: refused with ${got}`);
    return;
  }
  assert.fail(`${what}: should have been refused`);
}
assert.equal(await rw('token'), '0x0000000000000000000000000000000000000000');
assert.equal(await rw('poolBalance'), 0n);
const root = `0x${'11'.repeat(32)}`;
for (const [c, call] of [[admin, onRewards('rescueOther', [A, T])], [admin, onRewards('openEpoch', [1n, root, 1n, 9_999_999_999n])], [admin, onRewards('withdrawUnreserved', [A, 0n])], [alice, onRewards('claim', [1n, 0n, A, 1n, []])], [alice, onRewards('payOrder', [`0x${'ab'.repeat(16)}`, 1n, 9_999_999_999n])], [alice, onRewards('clubLock', [1n, 30])]]) await refused(c, call, 'TokenNotSet', `${call.functionName} before the token`);
await refused(alice, clubUnlockCall({ rewards: D.rewards }), 'ZeroAmount');

const TOKEN = await create('TestToken', [admin.account.address, 18]);
const sixDecimals = await create('TestToken', [admin.account.address, 6]);
await refused(alice, onRewards('setToken', [TOKEN]), 'OwnableUnauthorizedAccount', 'a player naming the token');
await refused(admin, onRewards('setToken', [A]), 'BadToken', 'a wallet is not a token');
await refused(admin, onRewards('setToken', [D.rewards]), 'BadToken');
await refused(admin, onRewards('setToken', [sixDecimals]), 'BadToken', 'wrong decimals');

const keyFile = join(dir, 'admin.key');
writeFileSync(keyFile, `${KEY0}\n`);
const tool = async (...a) => (await run(process.execPath, [join(ROOT, 'tools/chain/admin.mjs'), ...a], { cwd: ROOT })).stdout;
const NET = ['--network', 'local', '--rpc', RPC];
assert.match(await tool('set-token', ...NET, '--rewards', D.rewards, '--token', TOKEN), /Nothing sent/);
assert.equal(await rw('token'), '0x0000000000000000000000000000000000000000', 'looking does not set it');
await assert.rejects(tool('fund', ...NET, '--rewards', D.rewards, '--amount', '5', '--key-file', keyFile), (e) => /not set yet/.test(e.stderr));
assert.match(await tool('set-token', ...NET, '--rewards', D.rewards, '--token', TOKEN, '--key-file', keyFile, '--yes'), /Token set/);
D.token = await rw('token');
const other18 = await create('TestToken', [admin.account.address, 18]);
await refused(admin, onRewards('setToken', [other18]), 'TokenAlreadySet', 'swapping the token');
const tok = (functionName, args = []) => admin.pub.readContract({ address: D.token, abi: TOKEN_ABI, functionName, args });
const balance = (a) => tok('balanceOf', [a]);
// "the developer's launch buy" goes into the reward pool
await tool('fund', ...NET, '--rewards', D.rewards, '--amount', '500000', '--key-file', keyFile);
assert.equal(await rw('poolBalance'), M(500_000));
step('contract deployed before the token; token set once only (18 decimals, owner only); reward pool funded with 500,000');

// a deploying key that must not be trusted: the safe wallet owns the contract from the first moment
{
  await assert.rejects(deploy(stranger, { owner: T }), /treasury/);
  const safe = await deploy(stranger, { owner: A, treasury: T });
  const read = (functionName) => admin.pub.readContract({ address: safe.rewards, abi: REWARDS_ABI, functionName });
  assert.equal(await read('owner'), A);
  assert.equal(await read('treasury'), T);
  await refused(stranger, { address: safe.rewards, abi: REWARDS_ABI, functionName: 'setToken', args: [D.token] }, 'OwnableUnauthorizedAccount', 'the deploying key naming the token');
  await refused(stranger, { address: safe.rewards, abi: REWARDS_ABI, functionName: 'setTreasury', args: [stranger.account.address] }, 'OwnableUnauthorizedAccount');
}
step('deployed for another owner: the deploying key has no control');

// holder dividends paid in something else can be taken out; the game token never can this way
{
  const dividend = await create('TestToken', [admin.account.address, 18]);
  const holds = (token, a) => admin.pub.readContract({ address: token, abi: TOKEN_ABI, functionName: 'balanceOf', args: [a] });
  await send(admin, transferCall({ token: dividend, to: D.rewards, amount: M(7) }));
  await admin.pub.waitForTransactionReceipt({ hash: await stranger.wallet.sendTransaction({ to: D.rewards, value: UNIT }) });
  await refused(admin, onRewards('rescueOther', [D.token, T]), 'GameToken', 'taking the game token as "something else"');
  await refused(alice, onRewards('rescueOther', [dividend, A]), 'OwnableUnauthorizedAccount');
  await refused(admin, onRewards('rescueOther', [dividend, D.rewards]), 'BadAddress');
  const before = await admin.pub.getBalance({ address: stranger.account.address });
  await tool('rescue', ...NET, '--rewards', D.rewards, '--asset', dividend, '--to', T, '--key-file', keyFile);
  await tool('rescue', ...NET, '--rewards', D.rewards, '--asset', 'bnb', '--to', stranger.account.address, '--key-file', keyFile);
  assert.equal(await holds(dividend, T), M(7));
  assert.equal(await admin.pub.getBalance({ address: stranger.account.address }), before + UNIT);
  await refused(admin, onRewards('rescueOther', ['0x0000000000000000000000000000000000000000', T]), 'ZeroAmount');
  assert.equal(await rw('poolBalance'), M(500_000), 'the pool is untouched');
}
step('BNB and other tokens that reach the contract can be taken out by the owner; the game token cannot');

// a taxed token must not be able to leave the club short
{
  const taxed = await deploy(admin, { treasury: T });
  const tax = await create('TaxToken', [A]);
  await send(admin, { address: taxed.rewards, abi: REWARDS_ABI, functionName: 'setToken', args: [tax] });
  await send(alice, approveCall({ token: tax, rewards: taxed.rewards, amount: M(100) }));
  await refused(alice, clubLockCall({ rewards: taxed.rewards, amount: M(100), days: 30 }), 'FeeOnTransfer');
}
step('a token with a transfer tax cannot be locked in the Garden Club');

const jsLeaf = leafHash({ chainId: 31337, rewards: D.rewards, token: D.token }, 7, 3, A, 1_234_567n);
assert.equal(await rw('leafHash', [7n, 3n, A, 1_234_567n]), jsLeaf, 'JavaScript and the contract hash the same');

// 2. game server with chain on; players link wallets by signature
const WEEK = weekKey(Date.now());
const chainCfg = { enabled: true, cluster: 'local', rpc: RPC, publicRpc: RPC, confirmations: 0, chainId: 31337, rewards: D.rewards, token: D.token, treasury: T, weeklyPool: 100_000, quoteMs: 300_000, burnBps: 2000, potGoal: 100_000 };
const dbPath = join(dir, 'c.db');
const srv = await createServer({ dbPath, secret: 's', now: () => Date.now() + ahead, allowNoOrigin: true, guestBurst: 20, chain: chainCfg });
await srv.app.listen({ port: 0, host: '127.0.0.1' });
const base = `http://127.0.0.1:${srv.app.server.address().port}`;
async function newPlayer() {
  const guest = await fetch(`${base}/api/guest`, { method: 'POST' });
  const cookie = guest.headers.get('set-cookie').split(';')[0];
  const { playerId } = await guest.json();
  const call = async (path, body) => { const r = await fetch(`${base}${path}`, { method: body ? 'POST' : 'GET', headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, ...(await r.json()) }; };
  return { playerId, cookie, call };
}
/** Join the village over the game socket (tips and gifts need both players there). */
async function seat(p) {
  const { ticket } = await (await fetch(`${base}/api/ws-ticket`, { method: 'POST', headers: { cookie: p.cookie } })).json();
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?ticket=${ticket}`);
  const welcome = new Promise((done, fail) => { ws.on('message', (d) => { const m = JSON.parse(String(d)); if (m.t === 'welcome') done(m); }); ws.on('error', fail); });
  await new Promise((done) => ws.on('open', done));
  ws.send(JSON.stringify({ t: 'hello', v: 1 }));
  await welcome;
  p.ws = ws;
  p.slot = srv.rooms.byPlayer.get(p.playerId).member.slot;
}
async function link(p, c, signer = c) {
  const { message } = await p.call('/api/wallet/challenge', {});
  return p.call('/api/wallet/link', { address: c.account.address.toLowerCase(), signature: await signer.account.signMessage({ message }) });
}
const me = await newPlayer(), friend = await newPlayer();
const info = await me.call('/api/chain');
assert.deepEqual([info.enabled, info.chainId, info.rewards, info.token], [true, 31337, D.rewards, D.token]);
assert.equal((await link(me, alice, bob)).status, 400, 'wrong signer rejected');
await me.call('/api/wallet/challenge', {});
assert.equal((await me.call('/api/wallet/link', { address: A, signature: '0x1234' })).status, 400, 'bad signature rejected');
assert.equal((await me.call('/api/wallet/link', { address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', signature: '0x1234' })).status, 400, 'a Solana address is rejected');
assert.equal((await link(me, alice)).address, A, 'stored in its checksummed form');
assert.equal((await link(friend, alice)).status, 409, 'one wallet, one gardener');
assert.equal((await link(friend, bob)).address, B);
step('wallets linked by signed message (wrong signer, bad signature, other chains and reused wallets rejected)');

// 3. a week of Season Points, finalized and published with the operator tool itself
const sql = srv.db.raw;
srv.db.saveStates([{ pid: me.playerId, state: freshState(Date.now()) }, { pid: friend.playerId, state: freshState(Date.now()) }], Date.now());
sql.prepare('INSERT INTO season_points(player_id, week, points) VALUES(?, ?, ?)').run(me.playerId, WEEK, 700);
for (let i = 0; i < 9; i++) {
  const pid = `p${i}`;
  sql.prepare('INSERT INTO players(id, name, created_at, last_seen) VALUES(?, ?, 0, 0)').run(pid, `bot${i}`);
  sql.prepare('INSERT INTO wallets(player_id, address, linked_at) VALUES(?, ?, 0)').run(pid, privateKeyToAccount(generatePrivateKey()).address);
  sql.prepare('INSERT INTO season_points(player_id, week, points) VALUES(?, ?, ?)').run(pid, WEEK, 100 + i * 50);
}
assert.ok((await me.call('/api/rewards')).estimate > 0, 'estimate shown');
const said = await tool('finalize', '--week', WEEK, '--force', '--db', dbPath, '--network', 'local', '--rpc', RPC, '--rewards', D.rewards, '--token', D.token, '--send', '--key-file', keyFile);
assert.match(said, /Published on chain/);
assert.ok(!said.includes(KEY0.slice(2, 20)), 'the key is never printed');
const alloc = (await me.call('/api/rewards')).allocations[0];
assert.equal(BigInt(alloc.amount), M(1_000), 'capped at 1% of the pool (1,000 MGRD)');
assert.equal(alloc.claimed, false);
await assert.rejects(tool('deploy', '--network', 'bsc', '--key-file', keyFile), (e) => /MAINNET/.test(e.stderr), 'mainnet needs an explicit flag');
await assert.rejects(tool('status', '--network', 'bsc-testnet', '--rpc', RPC, '--rewards', D.rewards), (e) => /chain 31337/.test(e.stderr), 'wrong network refused');
step('week finalized and published by the operator tool; mainnet needs --yes-mainnet; a wrong network is refused');

// 4. claim
const mine = { rewards: D.rewards, epochId: alloc.epoch, index: alloc.index, claimant: A, amount: alloc.amount, proof: alloc.proof };
await refused(alice, claimCall({ ...mine, amount: M(2_000) }), 'BadProof', 'forged amount');
await refused(bob, claimCall({ ...mine, claimant: B }), 'BadProof', "someone else's reward to my wallet");
await refused(alice, claimCall({ ...mine, epochId: 99 }), 'UnknownEpoch');
await send(alice, claimCall(mine));
assert.equal(await balance(A), M(1_000));
assert.equal((await me.call('/api/rewards')).allocations[0].claimed, true, 'server sees the claim');
await refused(alice, claimCall(mine), 'AlreadyClaimed', 'second claim');
// somebody else may pay the network fee; the tokens still go to the wallet in the proof
const other = sql.prepare("SELECT * FROM reward_allocations WHERE player_id = 'p3'").get();
await send(stranger, claimCall({ rewards: D.rewards, epochId: other.epoch, index: other.idx, claimant: other.wallet, amount: other.amount, proof: JSON.parse(other.proof) }));
assert.equal(await balance(other.wallet), BigInt(other.amount));
assert.equal(await balance(stranger.account.address), 0n);
step('claim paid once; forged, borrowed and repeated claims refused; a sponsored claim still pays the right wallet');

// 5. shop
await send(admin, transferCall({ token: D.token, to: A, amount: M(200_000) }));
await send(admin, transferCall({ token: D.token, to: B, amount: M(5_000) }));
const deadline = (q) => Math.floor(q.expires / 1000);
const payFor = async (c, q, amount = BigInt(q.amount), orderId = q.orderId) => {
  await send(c, approveCall({ token: D.token, rewards: D.rewards, amount }));
  await send(c, payOrderCall({ rewards: D.rewards, orderId, amount, deadline: deadline(q) }));
};
const shop = await me.call('/api/shop');
const item = shop.items[0];
const quote = await me.call('/api/shop/quote', { item: item.id });
assert.equal(BigInt(quote.amount), BigInt(item.price) * UNIT, 'fixed $MGRD price');
assert.equal((await me.call('/api/shop/confirm', { orderId: quote.orderId })).status, 402, 'not paid yet');
await refused(alice, payOrderCall({ rewards: D.rewards, orderId: quote.orderId, amount: quote.amount, deadline: deadline(quote) }), 'ERC20InsufficientAllowance', 'paying without allowing it');
// someone who saw the order id cannot block it or get the item with it
await payFor(bob, quote, 2n);
assert.equal((await me.call('/api/shop/confirm', { orderId: quote.orderId })).status, 402, "another wallet's payment does not count");
await send(alice, approveCall({ token: D.token, rewards: D.rewards, amount: BigInt(quote.amount) }));
const before = { pool: await rw('poolBalance'), treasury: await balance(T), alice: await balance(A) };
await refused(alice, payOrderCall({ rewards: D.rewards, orderId: quote.orderId, amount: quote.amount, deadline: (await nowSec()) - 1 }), 'QuoteExpired', 'paying after the deadline');
await send(alice, payOrderCall({ rewards: D.rewards, orderId: quote.orderId, amount: quote.amount, deadline: deadline(quote) }));
const half = BigInt(quote.amount) / 2n;
assert.equal((await rw('poolBalance')) - before.pool, half, '50% back into the reward pool');
assert.equal((await balance(T)) - before.treasury, BigInt(quote.amount) - half, '50% to the treasury');
assert.equal(before.alice - (await balance(A)), BigInt(quote.amount));
assert.equal(await tok('allowance', [A, D.rewards]), 0n, 'nothing left approved');
// with a block depth set, a brand new payment is not trusted yet
srv.chain.config.confirmations = 3;
assert.equal((await me.call('/api/shop/confirm', { orderId: quote.orderId })).status, 402, 'too fresh');
await node.mine({ blocks: 3 });
const granted = await me.call('/api/shop/confirm', { orderId: quote.orderId });
srv.chain.config.confirmations = 0;
assert.equal(granted.ok, true, granted.error);
assert.equal((await me.call('/api/shop/confirm', { orderId: quote.orderId })).already, true, 'granted only once');
assert.ok(srv.db.loadState(me.playerId).wardrobe.includes(item.id));
await send(alice, approveCall({ token: D.token, rewards: D.rewards, amount: BigInt(quote.amount) }));
await refused(alice, payOrderCall({ rewards: D.rewards, orderId: quote.orderId, amount: quote.amount, deadline: deadline(quote) }), 'AlreadyPaid', 'paying twice');
step(`shop: paid ${Number(quote.amount) / 1e18} MGRD for ${item.name} (50/50 pool/treasury), granted once; late, repeated and borrowed payments refused`);

const cheap = await me.call('/api/mgrd/quote', { kind: 'decor', id: 'fountain' });
await payFor(alice, cheap, 1n * UNIT);
assert.equal((await me.call('/api/shop/confirm', { orderId: cheap.orderId })).error, 'Paid less than the quote.');

const buy = async (kind, id) => {
  const q = await me.call('/api/mgrd/quote', { kind, id });
  assert.ok(q.orderId, `${kind}:${id} quote: ${q.error ?? ''}`);
  await payFor(alice, q);
  const c = await me.call('/api/shop/confirm', { orderId: q.orderId });
  assert.equal(c.ok, true, `${kind}:${id} confirm: ${c.error ?? ''}`);
  return { ...c, amount: Number(q.amount) / 1e18 };
};
let potOrder;
const st0 = srv.db.loadState(me.playerId);
const egg = await buy('egg', 'rare');
const deco = await buy('decor', 'fountain');
await buy('hair', '#5fb8ff');
const soil = await buy('soil', '');
const lim = await buy('limited', 'founder_crown');
const st1 = srv.db.loadState(me.playerId);
assert.equal(st1.eggs.length, (st0.eggs?.length ?? 0) + 1, 'egg in the incubator');
assert.equal(st1.decorInv.fountain, 1, 'fountain to place');
assert.ok(st1.unlockedColors.includes('#5fb8ff'), 'hair colour unlocked');
assert.equal(st1.soil, st0.soil + 1, 'soil expanded');
assert.equal(st1.coins, st0.coins, 'no coins were taken');
assert.equal(lim.edition, 1, 'limited drop #1');
assert.equal((await me.call('/api/mgrd/quote', { kind: 'limited', id: 'founder_crown' })).status, 409, 'one per player');
step(`purchases: Rare Egg ${egg.amount}, Stone Fountain ${deco.amount}, hair colour, Expand Soil ${soil.amount}, Founder's Crown #${lim.edition}; each checked on chain`);

// 5b. the Fireworks Pot: its totals are far bigger than a database integer
await payFor(alice, await me.call('/api/mgrd/quote', { kind: 'pot', id: '1000' }).then((q) => (potOrder = q)));
assert.equal((await me.call('/api/shop/confirm', { orderId: potOrder.orderId })).ok, true);
assert.equal((await me.call('/api/community')).pot.total, M(1_000).toString(), 'exact total with 18 decimals');

// 6. tips and gifts between two players in the same village
await seat(me); await seat(friend);
const rcp = await me.call('/api/tip/recipient', { slot: friend.slot });
assert.equal(rcp.wallet, B);
const tip = await send(alice, transferCall({ token: D.token, to: B, amount: M(500) }));
const wrong = await send(alice, transferCall({ token: D.token, to: T, amount: M(500) }));
const someoneElses = await send(admin, transferCall({ token: D.token, to: B, amount: M(500) }));
for (const [tx, what] of [[wrong, 'a transfer to someone else'], [someoneElses, "someone else's transfer"]]) assert.equal((await me.call('/api/tip/confirm', { signature: tx.transactionHash, slot: friend.slot })).status, 400, what);
assert.equal((await me.call('/api/tip/confirm', { signature: 'not-a-hash', slot: friend.slot })).status, 400);
assert.equal((await me.call('/api/tip/confirm', { signature: tip.transactionHash, slot: friend.slot })).amount, 500);
assert.equal((await me.call('/api/tip/confirm', { signature: `0x${tip.transactionHash.slice(2).toUpperCase()}`, slot: friend.slot })).already, true, 'one tip counts once, however it is written');
const got = (await friend.call('/api/community')).tips;
assert.deepEqual([got.count, got.received], [1, M(500).toString()]);
const gq = await me.call('/api/mgrd/quote', { kind: 'gift', id: shop.items[1].id, to: friend.slot });
assert.ok(gq.orderId, gq.error);
await payFor(alice, gq);
assert.equal((await me.call('/api/shop/confirm', { orderId: gq.orderId })).ok, true);
assert.ok(srv.rooms.byPlayer.get(friend.playerId).member.state.wardrobe.includes(shop.items[1].id), 'the friend got the gift');
step('tip verified once from the linked wallet only; gift paid by one player and delivered to the other');

// 7. holder badge and Garden Club; club tokens must be out of everyone else's reach
let h = await me.call('/api/holder');
assert.ok(h.tier, 'holder tier from wallet balance');
await send(alice, approveCall({ token: D.token, rewards: D.rewards, amount: M(60_000) }));
await refused(alice, clubLockCall({ rewards: D.rewards, amount: M(1), days: 0 }), 'BadLockDays');
await refused(alice, clubLockCall({ rewards: D.rewards, amount: M(1), days: 366 }), 'BadLockDays');
const poolBefore = await rw('poolBalance');
await send(alice, clubLockCall({ rewards: D.rewards, amount: M(60_000), days: 30 }));
assert.equal(await rw('poolBalance'), poolBefore, 'locked tokens are not part of the pool');
assert.equal(await rw('totalLocked'), M(60_000));
h = await me.call('/api/holder');
assert.equal(h.locked, 60_000);
assert.equal(h.club.active, true);
assert.equal(srv.rooms.byPlayer.get(me.playerId).member.state.decorInv.club_lantern, 1, 'club lantern granted');
await refused(alice, clubUnlockCall({ rewards: D.rewards }), 'StillLocked', 'unlock early');
await refused(bob, clubUnlockCall({ rewards: D.rewards }), 'ZeroAmount', "taking someone else's lock");
const reserved = await rw('outstanding');
await refused(admin, onRewards('withdrawUnreserved', [admin.account.address, (await rw('poolBalance')) - reserved + 1n]), 'Reserved', 'withdrawing reserved or locked funds');
await refused(admin, onRewards('openEpoch', [50n, `0x${'11'.repeat(32)}`, (await rw('poolBalance')) - reserved + 1n, BigInt((await nowSec()) + 99)]), 'VaultUnderfunded', 'a week cannot count locked tokens');
await send(admin, onRewards('withdrawUnreserved', [admin.account.address, (await rw('poolBalance')) - reserved]));
assert.equal(await balance(D.rewards), reserved + M(60_000), 'only reserved rewards and club locks remain');
step('Garden Club: locked tokens stay out of reach even when the owner withdraws everything free');

// 8. pause, permissions, ownership
await tool('pause', '--on', '--network', 'local', '--rpc', RPC, '--rewards', D.rewards, '--key-file', keyFile);
await refused(alice, clubLockCall({ rewards: D.rewards, amount: M(1), days: 1 }), 'Paused');
await refused(alice, payOrderCall({ rewards: D.rewards, orderId: 'ff'.repeat(16), amount: 5n, deadline: (await nowSec()) + 60 }), 'Paused');
await refused(alice, claimCall(mine), 'Paused');
for (const call of [onRewards('updateConfig', [0, false]), onRewards('setTreasury', [A]), onRewards('withdrawUnreserved', [A, 0n]), onRewards('openEpoch', [51n, `0x${'11'.repeat(32)}`, 1n, 9_999_999_999n]), onRewards('closeEpoch', [1n]), onRewards('transferOwnership', [A])]) await refused(alice, call, 'OwnableUnauthorizedAccount', `a player calling ${call.functionName}`);
await refused(admin, onRewards('updateConfig', [10_001, false]), 'BadBps');
await refused(admin, onRewards('setTreasury', [D.rewards]), 'BadAddress');
await refused(admin, onRewards('renounceOwnership', []), 'CannotRenounce');
await send(admin, onRewards('transferOwnership', [T]));
assert.equal(await rw('owner'), admin.account.address, 'not handed over until accepted');
await refused(stranger, onRewards('acceptOwnership', []), 'OwnableUnauthorizedAccount');
step('pause stops claims, payments and new locks; only the owner can operate; handover needs acceptance');

// 9. deadline, close; unlocking works even while paused
await refused(admin, onRewards('closeEpoch', [1n]), 'NotExpired', 'closing early');
await timeTravel(31 * 86_400);
assert.equal(await rw('paused'), true);
const had = await balance(A);
await send(alice, clubUnlockCall({ rewards: D.rewards }));
assert.equal((await balance(A)) - had, M(60_000), 'exactly what was locked comes back');
assert.equal((await me.call('/api/holder')).club.active, false);
await tool('pause', '--off', '--network', 'local', '--rpc', RPC, '--rewards', D.rewards, '--key-file', keyFile);
const late = sql.prepare("SELECT * FROM reward_allocations WHERE player_id = 'p8'").get();
await refused(stranger, claimCall({ rewards: D.rewards, epochId: late.epoch, index: late.idx, claimant: late.wallet, amount: late.amount, proof: JSON.parse(late.proof) }), 'ClaimExpired');
await tool('close', '--epoch', '1', '--network', 'local', '--rpc', RPC, '--rewards', D.rewards, '--key-file', keyFile);
assert.equal(await rw('outstanding'), 0n, 'reservation released');
await refused(admin, onRewards('closeEpoch', [1n]), 'EpochIsClosed');
step('claims stop at the deadline; closing releases the reservation; the club unlock works while paused');

// 10. public burn
const treasuryKey = join(dir, 'treasury.key');
writeFileSync(treasuryKey, `${toHex(treasury.account.getHdKey().privateKey)}\n`);
const deadBefore = await balance(DEAD);
await tool('burn', '--amount', '100', '--token', D.token, ...NET, '--key-file', treasuryKey, '--db', dbPath);
assert.equal((await balance(DEAD)) - deadBefore, M(100));
assert.equal((await me.call('/api/community')).burns.total, M(100).toString(), 'shown in the game');
assert.match(await tool('status', '--network', 'local', '--rpc', RPC, '--rewards', D.rewards), /clubLocked: 0/);
step('public burn goes to the dead address and shows in the game');

// 11. an RPC for another network must not be able to confirm anything
const wrongSrv = await createServer({ dbPath: join(dir, 'w.db'), secret: 's', allowNoOrigin: true, chain: { ...chainCfg, cluster: 'bsc-testnet', chainId: 97 } });
{
  const g = await wrongSrv.app.inject({ method: 'POST', url: '/api/guest' });
  const cookie = g.headers['set-cookie'].split(';')[0];
  const post = (url, payload) => wrongSrv.app.inject({ method: 'POST', url, headers: { cookie }, payload });
  const msg = (await post('/api/wallet/challenge', {})).json().message;
  await post('/api/wallet/link', { address: A, signature: await alice.account.signMessage({ message: msg }) });
  const q = (await post('/api/shop/quote', { item: item.id })).json();
  assert.equal((await post('/api/shop/confirm', { orderId: q.orderId })).statusCode, 502);
}
await wrongSrv.app.close();
const mixed = await createServer({ dbPath: join(dir, 'm.db'), secret: 's', allowNoOrigin: true, chain: { ...chainCfg, token: other18 } });
{
  const g = await mixed.app.inject({ method: 'POST', url: '/api/guest' });
  const cookie = g.headers['set-cookie'].split(';')[0];
  const post = (url, payload) => mixed.app.inject({ method: 'POST', url, headers: { cookie }, payload });
  const msg = (await post('/api/wallet/challenge', {})).json().message;
  await post('/api/wallet/link', { address: A, signature: await alice.account.signMessage({ message: msg }) });
  const q = (await post('/api/shop/quote', { item: item.id })).json();
  assert.equal((await post('/api/shop/confirm', { orderId: q.orderId })).statusCode, 502);
}
await mixed.app.close();
step('a server pointed at the wrong chain or the wrong token confirms nothing');

me.ws.close(); friend.ws.close();
await sleep(100);
await srv.app.close();
console.log('LOCAL CHAIN E2E OK');
process.exit(0);
