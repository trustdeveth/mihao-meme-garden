#!/usr/bin/env node
// Operator tool for the MGRD reward program on Solana. Nothing here runs automatically; every command is explicit.
// Order: deploy the program (see chain/README.md), launch the token, check-token, init, fund, then weekly work.
//
// Chain commands take --rpc URL (default: a local test network), --program ID and, to send anything,
// --keypair wallet.json. Sending to anything but a local, dev or test network also needs --yes-mainnet.
//
//   check-token    --mint MINT --rpc URL
//       Reads the token and says whether the program accepts it. Sends nothing.
//   init           --mint MINT --rpc --program --keypair [--recycle-bps 5000] [--treasury-owner PUBKEY] [--yes]
//       Gives the deployed program its token. Works ONCE and only with the program's upgrade-authority wallet, which
//       becomes the admin. Without --yes it only checks and shows what it would do.
//   fund           --amount TOKENS --rpc --program --keypair [--yes]   puts tokens from your wallet into the rewards vault
//   status         --rpc --program [--epoch N]
//   finalize       --week 2026-11-09 --rpc --program [--pool 100000] [--min 1] [--deadline-days 30] [--db FILE]
//       Computes the week's allocations from Season Points (linked wallets only, 1% per-player cap, small amounts
//       carried over), builds the Merkle tree and stores it. Add --send --keypair to publish it (open_epoch).
//   close          --epoch N --rpc --program --keypair          after the claim deadline
//   pause          --on | --off  --rpc --program --keypair
//   set-treasury   --treasury-owner PUBKEY --rpc --program --keypair
//   new-admin      --admin PUBKEY --rpc --program --keypair      step 1: propose
//   accept-admin   --rpc --program --keypair                     step 2: run with the new admin's wallet
//   poll           --question "..." --options "A,B,C" [--days 7] [--db FILE]
//   burn           --amount TOKENS --rpc --program --keypair treasury-owner.json [--note "..."] [--db FILE]
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { getMint, getExtensionTypes, ExtensionType, getAccount, getOrCreateAssociatedTokenAccount, transferChecked, burnChecked } from '@solana/spl-token';
import {
  pdas, ata, mintInfo, leafHash, buildTree, toHex, toBase, toNumber, TOKEN_2022_PROGRAM_ID, createAtaIdempotentIx, initializeIx, openEpochIx, closeEpochIx,
  updateConfigIx, setTreasuryIx, proposeAdminIx, acceptAdminIx, decodeConfig, decodeEpoch,
} from '../../shared/src/chain/program.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const cmd = args[0];
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes(`--${k}`);
const need = (k) => { const v = opt(k); if (!v || v.startsWith('--')) throw new Error(`--${k} is required`); return v; };
const send = (c, signer, ...ixs) => sendAndConfirmTransaction(c, new Transaction().add(...ixs), [signer], { commitment: 'confirmed' });

const TEST_GENESIS = new Set(['EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG', '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY']); // devnet, testnet
/** True only when it is certain no real money is involved: a network on this computer, or Solana's dev or test net. */
export async function isTestNetwork(connection) {
  const host = new URL(connection.rpcEndpoint).hostname;
  if (['127.0.0.1', 'localhost'].includes(host)) return true;
  return TEST_GENESIS.has(await connection.getGenesisHash());
}

const loadKeypair = (file) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(file, 'utf8')))); // never printed
const connect = () => new Connection(opt('rpc', 'http://127.0.0.1:8899'), 'confirmed');
/** The signing wallet, after making sure a real network was asked for on purpose. */
async function signer(connection) {
  if (!(await isTestNetwork(connection)) && !flag('yes-mainnet')) throw new Error('this is not a test network: add --yes-mainnet if you really mean to send it');
  return loadKeypair(need('keypair'));
}

/** What the program will think of a token. Sends nothing. */
export async function inspectToken(connection, mintAddress) {
  const mintKey = new PublicKey(mintAddress);
  const { tokenProgram, decimals } = mintInfo(await connection.getAccountInfo(mintKey));
  const m = await getMint(connection, mintKey, 'confirmed', tokenProgram);
  const extensions = tokenProgram.equals(TOKEN_2022_PROGRAM_ID) ? getExtensionTypes(m.tlvData).map((t) => ExtensionType[t] ?? `unknown (${t})`) : [];
  const problems = [];
  if (m.mintAuthority) problems.push('more of it can still be minted (mint authority not revoked)');
  if (m.freezeAuthority) problems.push('accounts can be frozen (it has a freeze authority)');
  for (const e of extensions) if (!['MetadataPointer', 'TokenMetadata'].includes(e)) problems.push(`it has the Token-2022 extension ${e}, which the program refuses`);
  return { mint: mintKey, tokenProgram, kind: tokenProgram.equals(TOKEN_2022_PROGRAM_ID) ? 'Token-2022' : 'classic SPL token', decimals, supply: toNumber(m.supply, decimals), extensions, problems };
}

/** The wallet that can still change the program's code, or null if nobody can. */
export async function upgradeAuthority(connection, programId) {
  const info = await connection.getAccountInfo(pdas(programId).programData);
  if (!info) throw new Error('that program is not deployed on this network (or was not deployed as upgradeable)');
  return info.data[12] ? new PublicKey(info.data.subarray(13, 45)) : null;
}

/** Give the program its token and treasury. Once only. */
export async function initProgram({ connection, admin, programId, mint, recycleBps = 5000, treasuryOwner = null }) {
  const { tokenProgram } = mintInfo(await connection.getAccountInfo(new PublicKey(mint)));
  const owner = treasuryOwner ? new PublicKey(treasuryOwner) : admin.publicKey;
  const treasury = ata(owner, mint, tokenProgram);
  await send(connection, admin,
    createAtaIdempotentIx(admin.publicKey, owner, mint, tokenProgram),
    initializeIx({ programId, admin: admin.publicKey, mint, treasury, tokenProgram, recycleBps }));
  return { treasury, tokenProgram };
}

/** The program's settings, read from the chain, with the token's decimals. */
export async function readProgram(connection, programId) {
  const A = pdas(programId);
  const info = await connection.getAccountInfo(A.config);
  if (!info) throw new Error('the program has not been given its token yet (use init)');
  const cfg = decodeConfig(info.data);
  const token = mintInfo(await connection.getAccountInfo(cfg.mint));
  return { A, cfg, ...token };
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

async function finalize() {
  const week = opt('week');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week ?? '')) throw new Error('--week YYYY-MM-DD (the Monday the week started) is required');
  if (Date.parse(`${week}T00:00:00Z`) + 7 * 86_400_000 > Date.now() && !flag('force')) throw new Error('that week has not ended yet (use --force for testing)');
  const c = connect(), programId = need('program');
  const { cfg, decimals } = await readProgram(c, programId); // the token and its decimals come from the chain
  const admin = flag('send') ? await signer(c) : null;
  const db = await openDatabase();
  if (db.prepare('SELECT 1 FROM reward_epochs WHERE week = ?').get(week)) throw new Error(`week ${week} is already finalized`);
  const rows = db.prepare(`SELECT s.player_id, s.points, w.address FROM season_points s JOIN wallets w ON w.player_id = s.player_id
    JOIN players p ON p.id = s.player_id WHERE s.week = ? AND s.points > 0 AND p.banned = 0 ORDER BY s.player_id`).all(week);
  const carry = new Map(db.prepare('SELECT player_id, amount FROM reward_carry').all().map((r) => [r.player_id, BigInt(r.amount)]));
  const poolUnits = toBase(opt('pool', '100000'), decimals);
  const { out, carryOut, total } = allocate(rows, { poolUnits, minUnits: toBase(opt('min', '1'), decimals), carry });
  if (!out.length) { console.log(`No claimable allocations for ${week} (${rows.length} eligible players, ${total} points).`); return; }
  const epochId = (db.prepare('SELECT MAX(id) AS m FROM reward_epochs').get().m ?? 0) + 1;
  const leaves = out.map((r, i) => leafHash(programId, cfg.mint, epochId, i, r.address, r.amount));
  const tree = buildTree(leaves);
  const sum = out.reduce((n, r) => n + r.amount, 0n);
  const deadline = Math.floor(Date.now() / 1000) + Number(opt('deadline-days', '30')) * 86_400;
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO reward_epochs(id, week, root, total, claim_deadline, created_at, status) VALUES(?, ?, ?, ?, ?, ?, ?)').run(epochId, week, toHex(tree.root), sum.toString(), deadline, Date.now(), 'finalized');
    const ins = db.prepare('INSERT INTO reward_allocations(epoch, idx, player_id, wallet, amount, points, proof) VALUES(?, ?, ?, ?, ?, ?, ?)');
    out.forEach((r, i) => ins.run(epochId, i, r.player_id, r.address, r.amount.toString(), r.points, JSON.stringify(tree.proof(i).map(toHex))));
    db.exec('DELETE FROM reward_carry');
    const keep = db.prepare('INSERT INTO reward_carry(player_id, amount) VALUES(?, ?)');
    for (const [pid, a] of carryOut) keep.run(pid, a.toString());
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  console.log(`Week ${week} -> epoch ${epochId}: ${out.length} recipients, ${toNumber(sum, decimals)} MGRD of ${toNumber(poolUnits, decimals)} pool, root ${toHex(tree.root)}`);
  if (admin) {
    const sig = await send(c, admin, openEpochIx({ programId, admin: admin.publicKey, epochId, root: tree.root, total: sum, claimDeadline: deadline }));
    db.prepare("UPDATE reward_epochs SET status = 'open' WHERE id = ?").run(epochId);
    console.log(`Published on chain: ${sig}`);
  } else console.log('Not published. To publish: add --send --keypair, or publish the root with your multisig. (This week is now stored as finalized.)');
}

async function main() {
  if (cmd === 'check-token') {
    const r = await inspectToken(connect(), need('mint'));
    console.log({ token: r.mint.toBase58(), kind: r.kind, decimals: r.decimals, supply: r.supply, extensions: r.extensions });
    console.log(r.problems.length ? `The program would REFUSE this token:\n  - ${r.problems.join('\n  - ')}` : 'The program accepts this token.');
    if (r.problems.length) process.exitCode = 1;
  } else if (cmd === 'init') {
    const c = connect(), programId = need('program'), mint = need('mint');
    const r = await inspectToken(c, mint);
    const authority = await upgradeAuthority(c, programId);
    const recycleBps = Number(opt('recycle-bps', '5000'));
    if (!Number.isInteger(recycleBps) || recycleBps < 0 || recycleBps > 10_000) throw new Error('--recycle-bps must be 0 to 10000');
    console.log({ program: programId, token: r.mint.toBase58(), kind: r.kind, decimals: r.decimals, supply: r.supply, onlyThisWalletCanInit: authority?.toBase58() ?? 'nobody', treasuryOwner: opt('treasury-owner') ?? 'the signing wallet', shareKeptForRewards: `${recycleBps / 100}%` });
    if (r.problems.length) throw new Error(`the program would refuse this token:\n  - ${r.problems.join('\n  - ')}`);
    if (!flag('yes')) { console.log('Nothing was sent. Check the token address letter by letter: this works only once. Then run again with --yes.'); return; }
    const admin = await signer(c);
    if (!authority?.equals(admin.publicKey)) throw new Error(`this wallet is not the program's upgrade authority (${authority?.toBase58() ?? 'there is none'})`);
    const done = await initProgram({ connection: c, admin, programId, mint, recycleBps, treasuryOwner: opt('treasury-owner') });
    console.log(`Done. Treasury account: ${done.treasury.toBase58()}\nSet on the server: MG_CHAIN_CLUSTER=<devnet|mainnet-beta> MG_PROGRAM_ID=${programId} MG_MGRD_MINT=${mint}`);
  } else if (cmd === 'fund') {
    const c = connect(), { A, cfg, decimals, tokenProgram } = await readProgram(c, need('program'));
    const amount = toBase(need('amount'), decimals);
    console.log(`Send ${toNumber(amount, decimals)} MGRD (token ${cfg.mint.toBase58()}) from your wallet to the rewards vault ${A.vault.toBase58()}.`);
    if (!flag('yes')) { console.log('Nothing was sent. Run again with --yes.'); return; }
    const owner = await signer(c);
    console.log(await transferChecked(c, owner, ata(owner.publicKey, cfg.mint, tokenProgram), cfg.mint, A.vault, owner, amount, decimals, [], { commitment: 'confirmed' }, tokenProgram));
  } else if (cmd === 'status') {
    const c = connect(), programId = need('program');
    const authority = await upgradeAuthority(c, programId);
    console.log(`Program code can be changed by: ${authority?.toBase58() ?? 'nobody (final)'}`);
    const { A, cfg, decimals, tokenProgram } = await readProgram(c, programId);
    const vault = await getAccount(c, A.vault, 'confirmed', tokenProgram);
    console.log({ admin: cfg.admin.toBase58(), proposedAdmin: cfg.pendingAdmin.equals(PublicKey.default) ? 'none' : cfg.pendingAdmin.toBase58(), token: cfg.mint.toBase58(), decimals, treasury: cfg.treasury.toBase58(), shareKeptForRewards: `${cfg.recycleBps / 100}%`, paused: cfg.paused, vault: toNumber(vault.amount, decimals), reserved: toNumber(cfg.outstanding, decimals) });
    if (opt('epoch')) console.log(decodeEpoch((await c.getAccountInfo(A.epoch(Number(opt('epoch'))))).data));
  } else if (cmd === 'finalize') await finalize();
  else if (cmd === 'close') {
    const c = connect(), admin = await signer(c);
    console.log(await send(c, admin, closeEpochIx({ programId: need('program'), admin: admin.publicKey, epochId: Number(need('epoch')) })));
  } else if (cmd === 'pause') {
    if (flag('on') === flag('off')) throw new Error('say --on or --off');
    const c = connect(), admin = await signer(c);
    console.log(await send(c, admin, updateConfigIx({ programId: need('program'), admin: admin.publicKey, paused: flag('on') })));
  } else if (cmd === 'set-treasury') {
    const c = connect(), programId = need('program'), { cfg, tokenProgram } = await readProgram(c, programId);
    const owner = new PublicKey(need('treasury-owner'));
    const admin = await signer(c);
    console.log(await send(c, admin, createAtaIdempotentIx(admin.publicKey, owner, cfg.mint, tokenProgram), setTreasuryIx({ programId, admin: admin.publicKey, treasury: ata(owner, cfg.mint, tokenProgram) })));
  } else if (cmd === 'new-admin') {
    const c = connect(), newAdmin = new PublicKey(need('admin')), admin = await signer(c);
    console.log(await send(c, admin, proposeAdminIx({ programId: need('program'), admin: admin.publicKey, newAdmin })));
    console.log(`Proposed. Nothing changes until ${newAdmin.toBase58()} runs accept-admin.`);
  } else if (cmd === 'accept-admin') {
    const c = connect(), next = await signer(c);
    console.log(await send(c, next, acceptAdminIx({ programId: need('program'), newAdmin: next.publicKey })));
  } else if (cmd === 'poll') {
    const db = await openDatabase();
    const options = String(opt('options', '')).split(',').map((s) => s.trim()).filter(Boolean);
    if (!opt('question') || options.length < 2) throw new Error('--question and at least two --options are required');
    db.exec('CREATE TABLE IF NOT EXISTS polls (id INTEGER PRIMARY KEY AUTOINCREMENT, question TEXT NOT NULL, options TEXT NOT NULL, created_at INTEGER NOT NULL, ends_at INTEGER NOT NULL)');
    const r = db.prepare('INSERT INTO polls(question, options, created_at, ends_at) VALUES(?, ?, ?, ?)').run(opt('question'), JSON.stringify(options), Date.now(), Date.now() + Number(opt('days', '7')) * 86_400_000);
    console.log(`Vote #${r.lastInsertRowid} started: ${opt('question')} (${options.join(' / ')})`);
  } else if (cmd === 'burn') {
    const c = connect(), { cfg, decimals, tokenProgram } = await readProgram(c, need('program'));
    const amount = toBase(need('amount'), decimals);
    const owner = await signer(c);
    const from = await getOrCreateAssociatedTokenAccount(c, owner, cfg.mint, owner.publicKey, false, 'confirmed', undefined, tokenProgram);
    const sig = await burnChecked(c, owner, from.address, cfg.mint, owner, amount, decimals, [], { commitment: 'confirmed' }, tokenProgram);
    const db = await openDatabase();
    db.exec('CREATE TABLE IF NOT EXISTS burns (signature TEXT PRIMARY KEY, amount TEXT NOT NULL, at INTEGER NOT NULL, note TEXT)');
    db.prepare('INSERT INTO burns(signature, amount, at, note) VALUES(?, ?, ?, ?)').run(sig, amount.toString(), Date.now(), opt('note'));
    console.log(`Burned ${toNumber(amount, decimals)} MGRD (transaction ${sig}). Supply now ${(await c.getTokenSupply(cfg.mint)).value.uiAmountString}.`);
  } else if (cmd) throw new Error(`unknown command ${cmd}`);
  else console.log('Commands: check-token, init, fund, status, finalize, close, pause, set-treasury, new-admin, accept-admin, poll, burn (see the top of this file)');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
