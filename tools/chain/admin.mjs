#!/usr/bin/env node
// Operator tool for the MGRD contracts on BNB Chain. Nothing here runs automatically; every command is explicit.
// --network is bsc-testnet (default), bsc or local. Sending anything on bsc (real money) also needs --yes-mainnet.
// The signing key is read from --key-file (a file holding one 0x private key) or MG_ADMIN_KEY. It is never printed.
//
//   node tools/chain/admin.mjs new-wallet --out chain/keys/testnet.key
//       Creates a new key for TESTING and prints only its address (fund it from the BNB Chain testnet faucet).
//   node tools/chain/admin.mjs deploy   --key-file F [--treasury 0x..] [--recycle-bps 5000] [--new-owner 0x..]
//       Deploys GardenRewards only. The token is launched separately (on Flap) and named afterwards. Optionally
//       proposes a new owner (for example a multisig), which must then accept.
//   node tools/chain/admin.mjs set-token --token 0x.. --rewards 0x.. [--key-file F --yes]
//       Shows the token's details. With --key-file and --yes it names that token in the contract. THIS WORKS ONCE.
//   node tools/chain/admin.mjs fund     --amount 1000000 --rewards 0x.. --key-file F
//       Moves tokens (for example the developer's launch buy) from the key's wallet into the reward pool.
//   node tools/chain/admin.mjs finalize --week 2026-11-09 --rewards 0x.. --token 0x.. [--pool 100000] [--min 1] [--deadline-days 30] [--db ...]
//       Computes the week's allocations from Season Points (linked wallets only, 1% per-player cap, small amounts
//       carried to next week), builds the Merkle tree and stores it. Add --send --key-file to publish the root
//       (openEpoch); the pool must already hold enough MGRD. Without --send it prints the data for a multisig.
//   node tools/chain/admin.mjs close    --epoch N --rewards 0x.. --key-file F      (after the claim deadline)
//   node tools/chain/admin.mjs pause    --on|--off --rewards 0x.. --key-file F
//   node tools/chain/admin.mjs status   --rewards 0x.. [--epoch N]
//   node tools/chain/admin.mjs poll     --question "Next festival theme?" --options "Moon Fair,Candy Week" [--days 7] [--db ...]
//       Starts a holder vote (shown in the game under $MGRD Rewards > Community; votes are weighted by holder badge).
//   node tools/chain/admin.mjs burn     --amount 1000 --token 0x.. --key-file treasury.key [--note "..."] [--db ...]
//       Sends tokens from the key's wallet (use the treasury's) to the dead address, where nobody can ever move
//       them, and records it publicly (shown with the transaction). The token's total supply number stays the same.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http, encodeFunctionData } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { NETWORKS, viemChain, leafHash, buildTree, getAddress, isAddress, toBase, toNumber, REWARDS_ABI, TOKEN_ABI, MGRD_DECIMALS } from '../../shared/src/chain/evm.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const cmd = args[0];
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes(`--${k}`);
const units = (mgrd) => toBase(mgrd ?? '0');
const whole = (u) => toNumber(u);
export const DEAD = '0x000000000000000000000000000000000000dEaD';
const NONE = '0x0000000000000000000000000000000000000000';
export const artifact = (name) => JSON.parse(readFileSync(resolve(ROOT, `chain/artifacts/${name}.json`), 'utf8'));

const network = () => opt('network', process.env.MG_CHAIN_CLUSTER || 'bsc-testnet');
const address = (value, what) => { if (!value || !isAddress(value)) throw new Error(`${what} is required (a 0x address)`); return getAddress(value); };
const rewardsAddress = () => address(opt('rewards') ?? process.env.MG_REWARDS_CONTRACT, '--rewards');
const tokenAddress = () => address(opt('token') ?? process.env.MG_MGRD_TOKEN, '--token');

export function clients({ cluster, rpc, account = null }) {
  const chain = viemChain(cluster, rpc);
  const transport = http(rpc || NETWORKS[cluster].rpc, { timeout: 20_000 });
  const pub = createPublicClient({ chain, transport, pollingInterval: cluster === 'local' ? 100 : 1500 });
  return { cluster, chain, pub, account, wallet: account ? createWalletClient({ account, chain, transport }) : null };
}
/** Check the RPC really is the chosen network before reading or sending anything. */
async function sameChain(c) {
  const id = await c.pub.getChainId();
  if (id !== c.chain.id) throw new Error(`the RPC is for chain ${id}, but --network ${c.cluster} is chain ${c.chain.id}`);
}
/** Try the call first (so a refusal says why), send it, and wait until it succeeded. */
export async function send(c, call) {
  const { request } = await c.pub.simulateContract({ ...call, account: c.account });
  const hash = await c.wallet.writeContract(request);
  const receipt = await c.pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`transaction ${hash} failed`);
  return receipt;
}
async function create(c, name, params) {
  const a = artifact(name);
  const hash = await c.wallet.deployContract({ abi: a.abi, bytecode: a.bytecode, args: params });
  const receipt = await c.pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error(`deploying ${name} failed (${hash})`);
  return getAddress(receipt.contractAddress);
}

/** Deploy the rewards contract (the deployer is its first owner). The token is named later with setToken. */
export async function deploy(c, { treasury = null, recycleBps = 5000, newOwner = null } = {}) {
  const me = c.account.address;
  const pay = treasury ? getAddress(treasury) : me;
  const rewards = await create(c, 'GardenRewards', [pay, recycleBps, me]);
  if (newOwner) await send(c, { address: rewards, abi: REWARDS_ABI, functionName: 'transferOwnership', args: [getAddress(newOwner)] });
  return { rewards, treasury: pay, owner: me };
}

/** What a token says about itself, to check before naming it for good. */
export async function describeToken(c, token) {
  if (!(await c.pub.getCode({ address: token }))) throw new Error(`there is no contract at ${token} on ${c.cluster}`);
  const [name, symbol, decimals, supply] = await Promise.all(['name', 'symbol', 'decimals', 'totalSupply'].map((functionName) => c.pub.readContract({ address: token, abi: TOKEN_ABI, functionName })));
  return { name, symbol, decimals, supply };
}

/**
 * Weekly allocation (section 11.1): share = pool x points / total, capped at 1% of the pool; amounts below the
 * minimum are carried to the next week. Pure function so it can be tested.
 */
export function allocate(rows, { poolUnits, minUnits, capBps = 100, carry = new Map() }) {
  const total = rows.reduce((n, r) => n + BigInt(r.points), 0n);
  const cap = (poolUnits * BigInt(capBps)) / 10_000n;
  const out = [], carryOut = new Map();
  if (total === 0n) return { out, carryOut, total };
  for (const r of rows) {
    let amt = (poolUnits * BigInt(r.points)) / total;
    if (amt > cap) amt = cap;
    amt += carry.get(r.player_id) ?? 0n;
    if (amt < minUnits) { if (amt > 0n) carryOut.set(r.player_id, amt); continue; }
    out.push({ ...r, amount: amt });
  }
  return { out, carryOut, total };
}

const openDatabase = async () => { const { DatabaseSync } = await import('node:sqlite'); return new DatabaseSync(resolve(ROOT, opt('db', process.env.MG_DB ?? 'server/data/meme-garden.db'))); };

/** Text from a token we did not write, printed without control characters. */
const plain = (s) => String(s).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '?').slice(0, 60);

/** The signing account. Errors never include the key. */
function signer() {
  const file = opt('key-file');
  const raw = (file ? readFileSync(file, 'utf8') : process.env.MG_ADMIN_KEY ?? '').trim();
  if (!raw) throw new Error('give the signing key with --key-file FILE or MG_ADMIN_KEY');
  try { return privateKeyToAccount(raw.startsWith('0x') ? raw : `0x${raw}`); } catch { throw new Error('that is not a valid private key'); }
}
async function signing() {
  if (network() === 'bsc' && !flag('yes-mainnet')) throw new Error('this would send on BNB Smart Chain MAINNET (real money). Add --yes-mainnet only if you really mean it.');
  const c = clients({ cluster: network(), rpc: opt('rpc', process.env.MG_CHAIN_RPC), account: signer() });
  await sameChain(c);
  return c;
}
async function reading() {
  const c = clients({ cluster: network(), rpc: opt('rpc', process.env.MG_CHAIN_RPC) });
  await sameChain(c);
  return c;
}

async function finalize() {
  const week = opt('week');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week ?? '')) throw new Error('--week YYYY-MM-DD (the Monday the week started) is required');
  const rewards = rewardsAddress(), token = tokenAddress();
  const chainId = viemChain(network()).id;
  const signed = flag('send') ? await signing() : null; // fail before saving anything if the key or network is wrong
  const db = await openDatabase();
  if (db.prepare('SELECT 1 FROM reward_epochs WHERE week = ?').get(week)) throw new Error(`week ${week} is already finalized`);
  if (Date.parse(`${week}T00:00:00Z`) + 7 * 86_400_000 > Date.now() && !flag('force')) throw new Error('that week has not ended yet (use --force for testing)');
  const rows = db.prepare(`SELECT s.player_id, s.points, w.address FROM season_points s JOIN wallets w ON w.player_id = s.player_id
    JOIN players p ON p.id = s.player_id WHERE s.week = ? AND s.points > 0 AND p.banned = 0 ORDER BY s.player_id`).all(week)
    .filter((r) => isAddress(r.address));
  const carry = new Map(db.prepare('SELECT player_id, amount FROM reward_carry').all().map((r) => [r.player_id, BigInt(r.amount)]));
  const poolUnits = units(opt('pool', '100000'));
  const { out, carryOut, total } = allocate(rows, { poolUnits, minUnits: units(opt('min', '1')), carry });
  if (!out.length) { console.log(`No claimable allocations for ${week} (${rows.length} eligible players, ${total} points).`); return; }
  const epochId = (db.prepare('SELECT MAX(id) AS m FROM reward_epochs').get().m ?? 0) + 1;
  const tree = buildTree(out.map((r, i) => leafHash({ chainId, rewards, token }, epochId, i, r.address, r.amount)));
  const sum = out.reduce((n, r) => n + r.amount, 0n);
  const deadline = Math.floor(Date.now() / 1000) + Number(opt('deadline-days', '30')) * 86_400;
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO reward_epochs(id, week, root, total, claim_deadline, created_at, status) VALUES(?, ?, ?, ?, ?, ?, ?)').run(epochId, week, tree.root, sum.toString(), deadline, Date.now(), 'finalized');
    const ins = db.prepare('INSERT INTO reward_allocations(epoch, idx, player_id, wallet, amount, points, proof) VALUES(?, ?, ?, ?, ?, ?, ?)');
    out.forEach((r, i) => ins.run(epochId, i, r.player_id, getAddress(r.address), r.amount.toString(), r.points, JSON.stringify(tree.proof(i))));
    db.exec('DELETE FROM reward_carry');
    const c = db.prepare('INSERT INTO reward_carry(player_id, amount) VALUES(?, ?)');
    for (const [pid, a] of carryOut) c.run(pid, a.toString());
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  console.log(`Week ${week} -> epoch ${epochId}: ${out.length} recipients, ${whole(sum)} MGRD of ${whole(poolUnits)} pool, root ${tree.root}`);
  const call = { address: rewards, abi: REWARDS_ABI, functionName: 'openEpoch', args: [BigInt(epochId), tree.root, sum, BigInt(deadline)] };
  if (signed) {
    const r = await send(signed, call);
    db.prepare("UPDATE reward_epochs SET status = 'open' WHERE id = ?").run(epochId);
    console.log(`Published on chain: ${r.transactionHash}`);
  } else console.log(`Not published. To publish with a multisig, send this to ${rewards}:\n${encodeFunctionData(call)}`);
}

async function main() {
  if (cmd === 'new-wallet') {
    const out = opt('out');
    if (!out) throw new Error('--out FILE is required');
    if (existsSync(out)) throw new Error(`${out} already exists; not overwriting a key`);
    const key = generatePrivateKey();
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(out, `${key}\n`, { mode: 0o600, flag: 'wx' });
    console.log(`New test wallet ${privateKeyToAccount(key).address}\nIts private key is in ${out}. Keep it private, never commit it, and do not send real funds to it.`);
  } else if (cmd === 'deploy') {
    const c = await signing();
    const file = resolve(ROOT, `chain/deployment-${c.cluster}.json`);
    if (c.cluster !== 'local' && existsSync(file)) throw new Error(`${file} already exists: this network has a deployment. Move that file away only if you really mean to deploy again.`);
    const r = await deploy(c, { treasury: opt('treasury'), recycleBps: Number(opt('recycle-bps', '5000')), newOwner: opt('new-owner') });
    const record = { network: c.cluster, chainId: c.chain.id, ...r, token: '', deployedAt: new Date().toISOString() };
    if (c.cluster !== 'local') writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
    console.log(record);
    console.log(`Next, after the token is launched: set-token --network ${c.cluster} --rewards ${r.rewards} --token <address>`);
    if (opt('new-owner')) console.log(`The new owner must call acceptOwnership() on ${r.rewards}.`);
  } else if (cmd === 'set-token') {
    const token = tokenAddress(), rewards = rewardsAddress(), really = flag('yes');
    const c = really ? await signing() : await reading();
    const t = await describeToken(c, token);
    console.log(`Token ${token}\n  name ${plain(t.name)}\n  symbol ${plain(t.symbol)}\n  decimals ${t.decimals}\n  total supply ${whole(t.supply).toLocaleString('en-US')}`);
    if (t.decimals !== MGRD_DECIMALS) throw new Error(`the contract and the game need ${MGRD_DECIMALS} decimals`);
    if (!really) return console.log('Nothing sent. Check the address against the launch page, check the token has NO transfer tax, then add --key-file and --yes. This can only be done once.');
    const r = await send(c, { address: rewards, abi: REWARDS_ABI, functionName: 'setToken', args: [token] });
    const file = resolve(ROOT, `chain/deployment-${c.cluster}.json`);
    if (c.cluster !== 'local' && existsSync(file)) writeFileSync(file, `${JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), token }, null, 2)}\n`);
    console.log(`Token set (${r.transactionHash}). Set on the server:\n  MG_CHAIN_CLUSTER=${c.cluster}\n  MG_REWARDS_CONTRACT=${rewards}\n  MG_MGRD_TOKEN=${token}\n  MG_TREASURY=<the contract's treasury, see status>`);
  } else if (cmd === 'fund') {
    const amount = units(opt('amount'));
    if (!(amount > 0n)) throw new Error('--amount is required');
    const c = await signing(), rewards = rewardsAddress();
    const token = await c.pub.readContract({ address: rewards, abi: REWARDS_ABI, functionName: 'token' });
    if (token === NONE) throw new Error('the token is not set yet: tokens sent now could not be used until set-token');
    const r = await send(c, { address: token, abi: TOKEN_ABI, functionName: 'transfer', args: [rewards, amount] });
    const pool = await c.pub.readContract({ address: rewards, abi: REWARDS_ABI, functionName: 'poolBalance' });
    console.log(`Moved ${whole(amount).toLocaleString('en-US')} into the pool (${r.transactionHash}). The pool now holds ${whole(pool).toLocaleString('en-US')}.`);
  } else if (cmd === 'finalize') await finalize();
  else if (cmd === 'close') {
    const c = await signing();
    console.log((await send(c, { address: rewardsAddress(), abi: REWARDS_ABI, functionName: 'closeEpoch', args: [BigInt(opt('epoch'))] })).transactionHash);
  } else if (cmd === 'pause') {
    if (flag('on') === flag('off')) throw new Error('use --on or --off');
    const c = await signing(), rewards = rewardsAddress();
    const bps = await c.pub.readContract({ address: rewards, abi: REWARDS_ABI, functionName: 'recycleBps' });
    console.log((await send(c, { address: rewards, abi: REWARDS_ABI, functionName: 'updateConfig', args: [bps, flag('on')] })).transactionHash);
  } else if (cmd === 'poll') {
    const db = await openDatabase();
    const options = String(opt('options', '')).split(',').map((s) => s.trim()).filter(Boolean);
    if (!opt('question') || options.length < 2) throw new Error('--question and at least two --options are required');
    db.exec('CREATE TABLE IF NOT EXISTS polls (id INTEGER PRIMARY KEY AUTOINCREMENT, question TEXT NOT NULL, options TEXT NOT NULL, created_at INTEGER NOT NULL, ends_at INTEGER NOT NULL)');
    const r = db.prepare('INSERT INTO polls(question, options, created_at, ends_at) VALUES(?, ?, ?, ?)').run(opt('question'), JSON.stringify(options), Date.now(), Date.now() + Number(opt('days', '7')) * 86_400_000);
    console.log(`Vote #${r.lastInsertRowid} started: ${opt('question')} (${options.join(' / ')})`);
  } else if (cmd === 'burn') {
    const amount = units(opt('amount'));
    if (!(amount > 0n)) throw new Error('--amount is required');
    const token = tokenAddress(), c = await signing();
    const r = await send(c, { address: token, abi: TOKEN_ABI, functionName: 'transfer', args: [DEAD, amount] });
    const db = await openDatabase();
    db.exec('CREATE TABLE IF NOT EXISTS burns (signature TEXT PRIMARY KEY, amount TEXT NOT NULL, at INTEGER NOT NULL, note TEXT)');
    db.prepare('INSERT INTO burns(signature, amount, at, note) VALUES(?, ?, ?, ?)').run(r.transactionHash, amount.toString(), Date.now(), opt('note'));
    const gone = await c.pub.readContract({ address: token, abi: TOKEN_ABI, functionName: 'balanceOf', args: [DEAD] });
    console.log(`Sent ${whole(amount)} $MGRD to the dead address (tx ${r.transactionHash}). It now holds ${whole(gone).toLocaleString('en-US')}.`);
  } else if (cmd === 'status') {
    const c = await reading(), rewards = rewardsAddress();
    const read = (functionName, params = []) => c.pub.readContract({ address: rewards, abi: REWARDS_ABI, functionName, args: params });
    const [owner, pendingOwner, token, treasury, recycleBps, paused, pool, reserved, locked] = await Promise.all(['owner', 'pendingOwner', 'token', 'treasury', 'recycleBps', 'paused', 'poolBalance', 'outstanding', 'totalLocked'].map((f) => read(f)));
    console.log({ network: c.cluster, owner, pendingOwner, token, treasury, recycleBps, paused, pool: whole(pool), reserved: whole(reserved), clubLocked: whole(locked) });
    if (opt('epoch')) console.log(await read('epochs', [BigInt(opt('epoch'))]));
  } else if (cmd) throw new Error(`unknown command ${cmd}`);
  else console.log('Commands: new-wallet, deploy, set-token, fund, finalize, close, pause, status, poll, burn (see the top of this file)');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.shortMessage ?? e.message ?? e); process.exit(1); });
