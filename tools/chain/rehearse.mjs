// Rehearses the rewards contract with a REAL token on a private copy (fork) of BNB Smart Chain mainnet, running on
// this computer with Foundry's anvil. Nothing is sent to the real chain and no real key is used. Run it with your own
// token's address before `set-token`, which works only once.
// Usage: npm run chain:rehearse -- --token 0x.. [--rpc <BSC mainnet RPC>]
// It deploys a throwaway rewards contract on the copy, borrows tokens there from a holder, and checks that every
// amount arrives in full: before the token moves to the exchange, and (for Flap's tax token) after a simulated move.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createTestClient, http, parseAbi, parseEther, getAddress, isAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { clients, send, deploy, describeToken, flapDetails, DEAD } from './admin.mjs';
import { NETWORKS, TOKEN_ABI, REWARDS_ABI, leafHash, buildTree, toBase, toNumber, claimCall, payOrderCall, approveCall, transferCall, clubLockCall, clubUnlockCall } from '../../shared/src/chain/evm.js';

const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
if (!isAddress(opt('token') ?? '')) { console.error('--token 0x.. (a token on BSC mainnet) is required'); process.exit(1); }
const TOKEN = getAddress(opt('token'));
const FORK = opt('rpc', 'https://bsc-rpc.publicnode.com');
const PORT = Number(process.env.ANVIL_PORT ?? 8597);
const RPC = `http://127.0.0.1:${PORT}`;
const PORTAL = '0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0'; // Flap's launch contract: holds the unsold supply
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const step = (s) => console.log(`- ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const anvil = spawn(process.env.ANVIL ?? 'anvil', ['--port', String(PORT), '--fork-url', FORK, '--silent'], { stdio: 'ignore' });
process.on('exit', () => anvil.kill());

async function main() {
  const probe = clients({ cluster: 'bsc', rpc: RPC });
  for (let i = 0; ; i++) { try { await probe.pub.getChainId(); break; } catch { if (i > 300) throw new Error('the local copy did not start'); await sleep(200); } }
  assert.equal(await probe.pub.getChainId(), NETWORKS.bsc.chainId, 'the RPC to copy must be BSC mainnet');
  const node = createTestClient({ chain: probe.chain, transport: http(RPC, { timeout: 60_000 }), mode: 'anvil' });

  // brand-new wallets that exist only in the copy, each given pretend BNB
  const wallet = async () => { const c = clients({ cluster: 'bsc', rpc: RPC, account: privateKeyToAccount(generatePrivateKey()) }); await node.setBalance({ address: c.account.address, value: parseEther('100') }); return c; };
  const owner = await wallet(), player = await wallet(), treasury = await wallet(), anyone = await wallet();
  const O = owner.account.address, P = player.account.address, T = treasury.account.address;
  /** A client that sends as an address of the copied chain (possible only on a local copy). */
  const as = async (address) => {
    await node.impersonateAccount({ address });
    await node.setBalance({ address, value: parseEther('100') });
    const c = clients({ cluster: 'bsc', rpc: RPC, account: privateKeyToAccount(generatePrivateKey()) });
    return {
      call: async (call) => {
        const { createWalletClient } = await import('viem');
        const w = createWalletClient({ account: address, chain: c.chain, transport: http(RPC, { timeout: 60_000 }) });
        const hash = await w.writeContract(call);
        const r = await c.pub.waitForTransactionReceipt({ hash });
        assert.equal(r.status, 'success', `${call.functionName} from ${address} failed`);
        return r;
      },
    };
  };

  const t = await describeToken(owner, TOKEN);
  const f = await flapDetails(owner, TOKEN);
  const holds = (a, token = TOKEN) => owner.pub.readContract({ address: token, abi: TOKEN_ABI, functionName: 'balanceOf', args: [a] });
  step(`token ${t.decimals} decimals; ${f.reviewed ? `Flap tax token V3: buy ${f.buyBps / 100}%, sell ${f.sellBps / 100}%, dividends ${f.dividendToken ?? 'none'}` : 'NOT the reviewed Flap tax token'}`);

  const D = await deploy(owner, { treasury: T });
  const rw = (functionName, params = []) => owner.pub.readContract({ address: D.rewards, abi: REWARDS_ABI, functionName, args: params });
  const onRewards = (functionName, params) => ({ address: D.rewards, abi: REWARDS_ABI, functionName, args: params });
  await send(owner, onRewards('setToken', [TOKEN]));
  step('contract deployed on the copy and the token set');

  const source = opt('holder') ? getAddress(opt('holder')) : PORTAL;
  const available = await holds(source);
  assert.ok(available > toBase(100), `${source} holds too few tokens to borrow; pass --holder 0x.. (a wallet that holds the token)`);
  const budget = available > toBase(20_000_000) ? toBase(20_000_000) : available;
  const part = (percent) => (budget * BigInt(percent)) / 100n;
  const lender = await as(source);
  await lender.call({ address: TOKEN, abi: TOKEN_ABI, functionName: 'transfer', args: [O, part(80)] });
  await lender.call({ address: TOKEN, abi: TOKEN_ABI, functionName: 'transfer', args: [P, part(20)] });
  assert.equal(await holds(O), part(80));
  assert.equal(await holds(P), part(20));

  /** Move tokens `by` exactly: each listed address must gain (or lose) exactly that much. */
  async function exact(what, expected, action) {
    const before = await Promise.all(expected.map(([a]) => holds(a)));
    await action();
    for (const [i, [a, change]] of expected.entries()) assert.equal((await holds(a)) - before[i], change, `${what}: ${a} did not change by the full amount`);
  }

  let epoch = 0n, order = 0;
  async function round() {
    const pool = part(30), reward = part(1), pay = part(2), lock = part(3);
    await exact('fund', [[D.rewards, pool], [O, -pool]], () => send(owner, transferCall({ token: TOKEN, to: D.rewards, amount: pool })));

    epoch += 1n;
    const tree = buildTree([leafHash({ chainId: NETWORKS.bsc.chainId, rewards: D.rewards, token: TOKEN }, Number(epoch), 0, P, reward)]);
    const now = (await owner.pub.getBlock()).timestamp;
    await send(owner, onRewards('openEpoch', [epoch, tree.root, reward, now + 86_400n * 30n]));
    await exact('claim', [[P, reward], [D.rewards, -reward]], () => send(anyone, claimCall({ rewards: D.rewards, epochId: Number(epoch), index: 0, claimant: P, amount: reward, proof: tree.proof(0) })));

    order += 1;
    await send(player, approveCall({ token: TOKEN, rewards: D.rewards, amount: pay }));
    await exact('shop payment', [[P, -pay], [D.rewards, pay / 2n], [T, pay - pay / 2n]], () => send(player, payOrderCall({ rewards: D.rewards, orderId: `0x${String(order).padStart(32, '0')}`, amount: pay, deadline: Number(now) + 3600 })));

    await send(player, approveCall({ token: TOKEN, rewards: D.rewards, amount: lock }));
    await exact('club lock', [[P, -lock], [D.rewards, lock]], () => send(player, clubLockCall({ rewards: D.rewards, amount: lock, days: 1 })));
    await node.increaseTime({ seconds: 90_000 });
    await node.mine({ blocks: 1 });
    await exact('club unlock', [[P, lock], [D.rewards, -lock]], () => send(player, clubUnlockCall({ rewards: D.rewards })));

    await exact('tip between wallets', [[P, -toBase(1)], [anyone.account.address, toBase(1)]], () => send(player, transferCall({ token: TOKEN, to: anyone.account.address, amount: toBase(1) })));
    const spare = (await rw('poolBalance')) - (await rw('outstanding'));
    await exact('owner withdraws free pool', [[O, spare], [D.rewards, -spare]], () => send(owner, onRewards('withdrawUnreserved', [O, spare])));
    await exact('burn', [[DEAD, toBase(1)], [O, -toBase(1)]], () => send(owner, transferCall({ token: TOKEN, to: DEAD, amount: toBase(1) })));
  }
  await round();
  step('every amount arrived in full: fund, claim, shop payment, club lock and unlock, tip, withdrawal, burn');

  if (!f.reviewed) return console.log('REHEARSAL OK for the current state only. This token was not recognised, so no move to the exchange was simulated.');

  if (f.state === 0) {
    const flap = parseAbi(['function owner() view returns (address)', 'function startMigration()', 'function finalizeMigration()']);
    const tokenOwner = await as(await owner.pub.readContract({ address: TOKEN, abi: flap, functionName: 'owner' }));
    await tokenOwner.call({ address: TOKEN, abi: flap, functionName: 'startMigration' });
    await tokenOwner.call({ address: TOKEN, abi: flap, functionName: 'finalizeMigration' });
    step('simulated the move to the exchange (tax now switched on)');
  }
  const pool = await owner.pub.readContract({ address: TOKEN, abi: parseAbi(['function mainPool() view returns (address)']), functionName: 'mainPool' });
  if (f.sellBps > 0) {
    const sold = toBase(10), before = await holds(pool);
    await send(player, transferCall({ token: TOKEN, to: pool, amount: sold }));
    assert.equal((await holds(pool)) - before, sold - (sold * BigInt(f.sellBps)) / 10_000n);
    step(`control check: a transfer into the trading pool IS taxed (${f.sellBps / 100}%)`);
  }
  await round();
  step('with the tax on, every game transfer still arrived in full');

  if (!f.dividendToken) return console.log('REHEARSAL OK (this token pays no holder dividends)');
  if (f.dividendToken !== WBNB) return console.log(`REHEARSAL OK for transfers. Dividends are paid in ${f.dividendToken}: their payout was not simulated.`);

  // dividends in BNB: the contract must be able to get its share out again, however it is delivered
  const abi = parseAbi(['function deposit() payable', 'function approve(address, uint256) returns (bool)', 'function deposit(uint256) returns (bool)', 'function withdrawableDividends(address) view returns (uint256)', 'function withdrawDividendsFor(address) returns (bool)', 'function withdrawDividendsFor(address, bool) returns (bool)']);
  const only = (name, inputs) => abi.filter((x) => x.name === name && x.inputs.length === inputs);
  await send(owner, transferCall({ token: TOKEN, to: D.rewards, amount: part(30) }));
  const payDividend = async () => {
    await send(anyone, { address: WBNB, abi: only('deposit', 0), functionName: 'deposit', value: parseEther('5') });
    await send(anyone, { address: WBNB, abi: only('approve', 2), functionName: 'approve', args: [f.dividend, parseEther('5')] });
    await send(anyone, { address: f.dividend, abi: only('deposit', 1), functionName: 'deposit', args: [parseEther('5')] });
    const due = await owner.pub.readContract({ address: f.dividend, abi: only('withdrawableDividends', 1), functionName: 'withdrawableDividends', args: [D.rewards] });
    assert.ok(due > 0n, 'the contract earned no dividend (its balance may be under the dividend minimum)');
    return due;
  };
  let due = await payDividend();
  await send(anyone, { address: f.dividend, abi: only('withdrawDividendsFor', 2), functionName: 'withdrawDividendsFor', args: [D.rewards, false] });
  assert.equal(await holds(D.rewards, WBNB), due);
  await send(owner, onRewards('rescueOther', [WBNB, T]));
  assert.equal(await holds(T, WBNB), due);
  due = await payDividend();
  await send(anyone, { address: f.dividend, abi: only('withdrawDividendsFor', 1), functionName: 'withdrawDividendsFor', args: [D.rewards] });
  assert.equal(await owner.pub.getBalance({ address: D.rewards }), due);
  const had = await owner.pub.getBalance({ address: T });
  await send(owner, onRewards('rescueOther', ['0x0000000000000000000000000000000000000000', T]));
  assert.equal((await owner.pub.getBalance({ address: T })) - had, due);
  step(`holder dividends reached the contract as WBNB and as BNB, and both were taken out (${toNumber(due).toFixed(6)} BNB the second time)`);
  console.log('REHEARSAL OK');
}

main().then(() => process.exit(0), (e) => { console.error(`REHEARSAL FAILED: ${e.shortMessage ?? e.message ?? e}`); process.exit(1); });
