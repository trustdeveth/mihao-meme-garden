#!/usr/bin/env node
// Operator tool for the MGRD reward program. Nothing here runs automatically; every command is explicit.
//
//   node tools/chain/admin.mjs setup    --rpc URL --keypair admin.json --program ID --metadata-uri https://<game>/token/mgrd.json [--recycle-bps 5000] [--fund 1000000] [--treasury-owner PUBKEY]
//       Creates MGRD (1,000,000,000 units, 6 decimals) owned by the admin, revokes the mint authority (no more can
//       ever be minted), creates the treasury token account, initializes the program and optionally funds the vault.
//   node tools/chain/admin.mjs finalize --week 2026-11-09 [--pool 100000] [--min 1] [--deadline-days 30] [--db server/data/meme-garden.db]
//       Computes the week's allocations from Season Points (linked wallets only, 1% per-player cap, small amounts
//       carried to next week), builds the Merkle tree and stores it. Add --send --rpc --keypair --program to publish
//       the root on chain (open_epoch); the vault must already hold enough MGRD.
//   node tools/chain/admin.mjs close    --epoch N --rpc --keypair --program      (after the claim deadline)
//   node tools/chain/admin.mjs pause    --on|--off --rpc --keypair --program
//   node tools/chain/admin.mjs status   --rpc --program
//   node tools/chain/admin.mjs poll     --question "Next festival theme?" --options "Moon Fair,Candy Week,Pirate Days" [--days 7] [--db ...]
//       Starts a holder vote (shown in the game under $MGRD Rewards > Community; votes are weighted by holder badge).
//   node tools/chain/admin.mjs burn     --amount 1000 --rpc --keypair treasury-owner.json --mint MINT [--note "October shop revenue"] [--db ...]
//       Burns $MGRD from the treasury token account and records it publicly (shown in the game with the transaction).
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram, SYSVAR_RENT_PUBKEY, sendAndConfirmTransaction } from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, setAuthority, AuthorityType, transfer as splTransfer, getAccount, burn as splBurn } from '@solana/spl-token';
import { pdas, leafHash, buildTree, toHex, initializeIx, openEpochIx, closeEpochIx, updateConfigIx, decodeConfig, decodeEpoch, MGRD_DECIMALS } from '../../shared/src/chain/program.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const cmd = args[0];
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes(`--${k}`);
const UNIT = 10n ** BigInt(MGRD_DECIMALS);
const loadKeypair = (p) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, 'utf8'))));
const conn = () => new Connection(opt('rpc', 'http://127.0.0.1:8899'), 'confirmed');
const send = (c, payer, ...ixs) => sendAndConfirmTransaction(c, new Transaction().add(...ixs), [payer]);

/** Metaplex token metadata (name, symbol and the logo link wallets show). Must be created while the mint authority exists. */
export const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
export function createMetadataIx({ mint, authority, payer, name, symbol, uri }) {
  const str = (s) => { const b = Buffer.from(s, 'utf8'); const l = Buffer.alloc(4); l.writeUInt32LE(b.length); return Buffer.concat([l, b]); };
  const metadata = PublicKey.findProgramAddressSync([Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), new PublicKey(mint).toBuffer()], METADATA_PROGRAM_ID)[0];
  // CreateMetadataAccountV3 = 33: DataV2 { name, symbol, uri, seller_fee_bps, creators: None, collection: None, uses: None }, is_mutable, collection_details: None
  const data = Buffer.concat([Buffer.from([33]), str(name), str(symbol), str(uri), Buffer.from([0, 0]), Buffer.from([0, 0, 0]), Buffer.from([1]), Buffer.from([0])]);
  return {
    metadata,
    ix: new TransactionInstruction({
      programId: METADATA_PROGRAM_ID,
      keys: [
        { pubkey: metadata, isSigner: false, isWritable: true },
        { pubkey: new PublicKey(mint), isSigner: false, isWritable: false },
        { pubkey: authority, isSigner: true, isWritable: false },
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: authority, isSigner: true, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
      data,
    }),
  };
}

export async function setup({ connection, admin, programId, recycleBps = 5000, fund = 0n, treasuryOwner = null, metadataUri = null }) {
  const mint = await createMint(connection, admin, admin.publicKey, null, MGRD_DECIMALS); // no freeze authority
  // name, $MGRD symbol and the project logo for wallets and explorers (metadata stays updatable by the admin)
  if (metadataUri) await send(connection, admin, createMetadataIx({ mint, authority: admin.publicKey, payer: admin.publicKey, name: 'Meme Garden', symbol: 'MGRD', uri: metadataUri }).ix);
  const adminAta = await getOrCreateAssociatedTokenAccount(connection, admin, mint, admin.publicKey);
  await mintTo(connection, admin, mint, adminAta.address, admin, 1_000_000_000n * UNIT);
  await setAuthority(connection, admin, mint, admin, AuthorityType.MintTokens, null); // supply is now fixed forever
  const treasury = await getOrCreateAssociatedTokenAccount(connection, admin, mint, treasuryOwner ? new PublicKey(treasuryOwner) : admin.publicKey);
  await send(connection, admin, initializeIx({ programId, admin: admin.publicKey, mint, treasury: treasury.address, recycleBps }));
  if (fund > 0n) await splTransfer(connection, admin, adminAta.address, pdas(programId).vault, admin, fund);
  return { mint, treasury: treasury.address, adminAta: adminAta.address };
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

async function finalize() {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(resolve(ROOT, opt('db', 'server/data/meme-garden.db')));
  const week = opt('week');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week ?? '')) throw new Error('--week YYYY-MM-DD (the Monday the week started) is required');
  if (db.prepare('SELECT 1 FROM reward_epochs WHERE week = ?').get(week)) throw new Error(`week ${week} is already finalized`);
  if (Date.parse(`${week}T00:00:00Z`) + 7 * 86_400_000 > Date.now() && !flag('force')) throw new Error('that week has not ended yet (use --force for testing)');
  const programId = opt('program') ?? process.env.MG_PROGRAM_ID;
  const mint = opt('mint') ?? process.env.MG_MGRD_MINT;
  if (!programId || !mint) throw new Error('--program and --mint (or MG_PROGRAM_ID / MG_MGRD_MINT) are required');
  const rows = db.prepare(`SELECT s.player_id, s.points, w.address FROM season_points s JOIN wallets w ON w.player_id = s.player_id
    JOIN players p ON p.id = s.player_id WHERE s.week = ? AND s.points > 0 AND p.banned = 0 ORDER BY s.player_id`).all(week);
  const carry = new Map(db.prepare('SELECT player_id, amount FROM reward_carry').all().map((r) => [r.player_id, BigInt(r.amount)]));
  const poolUnits = BigInt(Math.round(Number(opt('pool', '100000')) * 1e6));
  const { out, carryOut, total } = allocate(rows, { poolUnits, minUnits: BigInt(Math.round(Number(opt('min', '1')) * 1e6)), carry });
  if (!out.length) { console.log(`No claimable allocations for ${week} (${rows.length} eligible players, ${total} points).`); return; }
  const epochId = (db.prepare('SELECT MAX(id) AS m FROM reward_epochs').get().m ?? 0) + 1;
  const leaves = out.map((r, i) => leafHash(programId, mint, epochId, i, r.address, r.amount));
  const tree = buildTree(leaves);
  const sum = out.reduce((n, r) => n + r.amount, 0n);
  const deadline = Math.floor(Date.now() / 1000) + Number(opt('deadline-days', '30')) * 86_400;
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO reward_epochs(id, week, root, total, claim_deadline, created_at, status) VALUES(?, ?, ?, ?, ?, ?, ?)').run(epochId, week, toHex(tree.root), sum.toString(), deadline, Date.now(), 'finalized');
    const ins = db.prepare('INSERT INTO reward_allocations(epoch, idx, player_id, wallet, amount, points, proof) VALUES(?, ?, ?, ?, ?, ?, ?)');
    out.forEach((r, i) => ins.run(epochId, i, r.player_id, r.address, r.amount.toString(), r.points, JSON.stringify(tree.proof(i).map(toHex))));
    db.exec('DELETE FROM reward_carry');
    const c = db.prepare('INSERT INTO reward_carry(player_id, amount) VALUES(?, ?)');
    for (const [pid, a] of carryOut) c.run(pid, a.toString());
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  console.log(`Week ${week} -> epoch ${epochId}: ${out.length} recipients, ${Number(sum) / 1e6} MGRD of ${Number(poolUnits) / 1e6} pool, root ${toHex(tree.root)}`);
  if (flag('send')) {
    const c = conn(), admin = loadKeypair(opt('keypair'));
    const sig = await send(c, admin, openEpochIx({ programId, admin: admin.publicKey, epochId, root: tree.root, total: sum, claimDeadline: deadline }));
    db.prepare("UPDATE reward_epochs SET status = 'open' WHERE id = ?").run(epochId);
    console.log(`Published on chain: ${sig}`);
  } else console.log('Not published. Re-run with --send --rpc --keypair --program, or publish the root with your multisig.');
}

async function main() {
  if (cmd === 'setup') {
    const r = await setup({ connection: conn(), admin: loadKeypair(opt('keypair')), programId: opt('program'), recycleBps: Number(opt('recycle-bps', '5000')), fund: BigInt(Math.round(Number(opt('fund', '0')) * 1e6)), treasuryOwner: opt('treasury-owner'), metadataUri: opt('metadata-uri') });
    console.log(`MGRD mint ${r.mint.toBase58()} (mint authority revoked)\ntreasury ${r.treasury.toBase58()}\nSet on the server: MG_PROGRAM_ID=${opt('program')} MG_MGRD_MINT=${r.mint.toBase58()} MG_TREASURY=${r.treasury.toBase58()}`);
  } else if (cmd === 'finalize') await finalize();
  else if (cmd === 'close') {
    const admin = loadKeypair(opt('keypair'));
    console.log(await send(conn(), admin, closeEpochIx({ programId: opt('program'), admin: admin.publicKey, epochId: Number(opt('epoch')) })));
  } else if (cmd === 'pause') {
    const admin = loadKeypair(opt('keypair'));
    console.log(await send(conn(), admin, updateConfigIx({ programId: opt('program'), admin: admin.publicKey, paused: flag('on') })));
  } else if (cmd === 'poll') {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(resolve(ROOT, opt('db', 'server/data/meme-garden.db')));
    const options = String(opt('options', '')).split(',').map((s) => s.trim()).filter(Boolean);
    if (!opt('question') || options.length < 2) throw new Error('--question and at least two --options are required');
    db.exec('CREATE TABLE IF NOT EXISTS polls (id INTEGER PRIMARY KEY AUTOINCREMENT, question TEXT NOT NULL, options TEXT NOT NULL, created_at INTEGER NOT NULL, ends_at INTEGER NOT NULL)');
    const r = db.prepare('INSERT INTO polls(question, options, created_at, ends_at) VALUES(?, ?, ?, ?)').run(opt('question'), JSON.stringify(options), Date.now(), Date.now() + Number(opt('days', '7')) * 86_400_000);
    console.log(`Vote #${r.lastInsertRowid} started: ${opt('question')} (${options.join(' / ')})`);
  } else if (cmd === 'burn') {
    const c = conn(), owner = loadKeypair(opt('keypair'));
    const mint = new PublicKey(opt('mint') ?? process.env.MG_MGRD_MINT);
    const amount = BigInt(Math.round(Number(opt('amount')) * 1e6));
    if (!(amount > 0n)) throw new Error('--amount is required');
    const from = await getOrCreateAssociatedTokenAccount(c, owner, mint, owner.publicKey);
    const sig = await splBurn(c, owner, from.address, mint, owner, amount);
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(resolve(ROOT, opt('db', 'server/data/meme-garden.db')));
    db.exec('CREATE TABLE IF NOT EXISTS burns (signature TEXT PRIMARY KEY, amount TEXT NOT NULL, at INTEGER NOT NULL, note TEXT)');
    db.prepare('INSERT INTO burns(signature, amount, at, note) VALUES(?, ?, ?, ?)').run(sig, amount.toString(), Date.now(), opt('note'));
    const supply = (await c.getTokenSupply(mint)).value.uiAmountString;
    console.log(`Burned ${Number(amount) / 1e6} $MGRD (tx ${sig}). Supply now ${supply}.`);
  } else if (cmd === 'status') {
    const c = conn(), A = pdas(opt('program'));
    const info = await c.getAccountInfo(A.config);
    if (!info) return console.log('Program not initialized.');
    const cfg = decodeConfig(info.data);
    const vault = await getAccount(c, A.vault);
    console.log({ admin: cfg.admin.toBase58(), mint: cfg.mint.toBase58(), treasury: cfg.treasury.toBase58(), recycleBps: cfg.recycleBps, paused: cfg.paused, vault: Number(vault.amount) / 1e6, reserved: Number(cfg.outstanding) / 1e6 });
    if (opt('epoch')) console.log(decodeEpoch((await c.getAccountInfo(A.epoch(Number(opt('epoch'))))).data));
  } else if (cmd) throw new Error(`unknown command ${cmd}`);
  else console.log('Commands: setup, finalize, close, pause, status (see the top of this file)');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
