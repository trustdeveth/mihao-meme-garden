// Client for the garden_rewards Solana program (chain/programs/garden_rewards): addresses, instruction encoding,
// account decoding and the reward Merkle tree. Shared by the server, the browser and the admin tools so all three
// build exactly the same bytes. Hashing must match the Rust program (see leaf_hash / node_hash there).
//
// The token may belong to the classic token program or to Token-2022, and may have any number of decimals, so both
// are passed in (read them from the token itself with mintInfo()).
import { PublicKey, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import { sha256 } from '@noble/hashes/sha256';

export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
export const UPGRADEABLE_LOADER_ID = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const enc = new TextEncoder();
const LEAF_DOMAIN = enc.encode('MGRD-REWARD-V1');

// ---- bytes ---------------------------------------------------------------------------------------------
const u64 = (v) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(v), true); return b; };
const i64 = (v) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigInt64(0, BigInt(v), true); return b; };
const u32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; };
const u16 = (v) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); return b; };
export const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
export const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export const fromHex = (h) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
const cmp = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

/** Anchor instruction discriminator: first 8 bytes of sha256("global:<name>"). */
const disc = (name) => sha256(enc.encode(`global:${name}`)).slice(0, 8);
/** Anchor account discriminator: first 8 bytes of sha256("account:<Name>"). */
const accDisc = (name) => sha256(enc.encode(`account:${name}`)).slice(0, 8);

// ---- the token -----------------------------------------------------------------------------------------
/** Token program and decimals of a mint, from its account on chain (as returned by getAccountInfo). */
export function mintInfo(account) {
  if (!account) throw new Error('there is no token at that address');
  const tokenProgram = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].find((p) => p.equals(new PublicKey(account.owner)));
  if (!tokenProgram || account.data.length < 82) throw new Error('that address is not a token');
  return { tokenProgram, decimals: account.data[44] };
}

// ---- addresses -----------------------------------------------------------------------------------------
export function pdas(programId) {
  const P = new PublicKey(programId);
  const find = (...seeds) => PublicKey.findProgramAddressSync(seeds, P)[0];
  return {
    program: P,
    programData: PublicKey.findProgramAddressSync([P.toBytes()], UPGRADEABLE_LOADER_ID)[0],
    config: find(enc.encode('config')),
    vault: find(enc.encode('vault')),
    epoch: (id) => find(enc.encode('epoch'), u64(id)),
    receipt: (id, index) => find(enc.encode('receipt'), u64(id), u32(index)),
    order: (payer, orderId) => find(enc.encode('order'), new PublicKey(payer).toBytes(), orderId),
    lock: (owner) => find(enc.encode('lock'), new PublicKey(owner).toBytes()),
    lockVault: (owner) => find(enc.encode('lockvault'), new PublicKey(owner).toBytes()),
  };
}
export function ata(owner, mint, tokenProgram) {
  return PublicKey.findProgramAddressSync([new PublicKey(owner).toBytes(), new PublicKey(tokenProgram).toBytes(), new PublicKey(mint).toBytes()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];
}

const acc = (pubkey, isWritable = false, isSigner = false) => ({ pubkey: new PublicKey(pubkey), isWritable, isSigner });

/** Create the owner's token account if it does not exist yet (no-op otherwise). */
export function createAtaIdempotentIx(payer, owner, mint, tokenProgram) {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [acc(payer, true, true), acc(ata(owner, mint, tokenProgram), true), acc(owner), acc(mint), acc(SystemProgram.programId), acc(tokenProgram)],
    data: Uint8Array.of(1),
  });
}

/** A plain transfer between two token accounts (used for tips): TransferChecked, which both token programs accept. */
export function tokenTransferIx({ from, to, owner, mint, tokenProgram, decimals, amount }) {
  return new TransactionInstruction({
    programId: new PublicKey(tokenProgram),
    keys: [acc(from, true), acc(mint), acc(to, true), acc(owner, false, true)],
    data: concat(Uint8Array.of(12), u64(amount), Uint8Array.of(decimals)),
  });
}

// ---- Merkle tree ---------------------------------------------------------------------------------------
export function leafHash(programId, mint, epochId, index, claimant, amount) {
  return sha256(concat(Uint8Array.of(0), LEAF_DOMAIN, new PublicKey(programId).toBytes(), new PublicKey(mint).toBytes(), u64(epochId), u32(index), new PublicKey(claimant).toBytes(), u64(amount)));
}
export function nodeHash(a, b) { return cmp(a, b) <= 0 ? sha256(concat(Uint8Array.of(1), a, b)) : sha256(concat(Uint8Array.of(1), b, a)); }
export function verifyProof(leaf, proof, root) { let h = leaf; for (const p of proof) h = nodeHash(h, p); return cmp(h, root) === 0; }

/**
 * Tree over leaves in order (index = position). Odd nodes are carried up unchanged.
 * @returns {{root: Uint8Array, proof: (i:number)=>Uint8Array[]}}
 */
export function buildTree(leaves) {
  if (!leaves.length) throw new Error('empty tree');
  const levels = [leaves];
  while (levels.at(-1).length > 1) {
    const l = levels.at(-1), next = [];
    for (let i = 0; i < l.length; i += 2) next.push(i + 1 < l.length ? nodeHash(l[i], l[i + 1]) : l[i]);
    levels.push(next);
  }
  return {
    root: levels.at(-1)[0],
    proof(i) {
      const out = [];
      for (const l of levels.slice(0, -1)) { const s = i ^ 1; if (s < l.length) out.push(l[s]); i >>= 1; }
      return out;
    },
  };
}

// ---- instructions (account order matches the structs in lib.rs) ----------------------------------------
const ix = (A, keys, ...data) => new TransactionInstruction({ programId: A.program, keys, data: concat(...data) });

/** Name the token (once). `admin` must be the wallet that may upgrade the program. */
export function initializeIx({ programId, admin, mint, treasury, tokenProgram, recycleBps }) {
  const A = pdas(programId);
  return ix(A, [acc(admin, true, true), acc(A.program), acc(A.programData), acc(A.config, true), acc(mint), acc(A.vault, true), acc(treasury), acc(tokenProgram), acc(SystemProgram.programId)], disc('initialize'), u16(recycleBps));
}
export function updateConfigIx({ programId, admin, recycleBps = null, paused = null }) {
  const A = pdas(programId);
  const opt16 = recycleBps == null ? Uint8Array.of(0) : concat(Uint8Array.of(1), u16(recycleBps));
  const optB = paused == null ? Uint8Array.of(0) : Uint8Array.of(1, paused ? 1 : 0);
  return ix(A, [acc(admin, false, true), acc(A.config, true)], disc('update_config'), opt16, optB);
}
export function setTreasuryIx({ programId, admin, treasury }) {
  const A = pdas(programId);
  return ix(A, [acc(admin, false, true), acc(A.config, true), acc(treasury)], disc('set_treasury'));
}
export function proposeAdminIx({ programId, admin, newAdmin }) {
  const A = pdas(programId);
  return ix(A, [acc(admin, false, true), acc(A.config, true)], disc('propose_admin'), new PublicKey(newAdmin).toBytes());
}
export function acceptAdminIx({ programId, newAdmin }) {
  const A = pdas(programId);
  return ix(A, [acc(newAdmin, false, true), acc(A.config, true)], disc('accept_admin'));
}
export function openEpochIx({ programId, admin, epochId, root, total, claimDeadline }) {
  const A = pdas(programId);
  return ix(A, [acc(admin, true, true), acc(A.config, true), acc(A.epoch(epochId), true), acc(A.vault), acc(SystemProgram.programId)], disc('open_epoch'), u64(epochId), root, u64(total), i64(claimDeadline));
}
export function closeEpochIx({ programId, admin, epochId }) {
  const A = pdas(programId);
  return ix(A, [acc(admin, false, true), acc(A.config, true), acc(A.epoch(epochId), true)], disc('close_epoch'), u64(epochId));
}
export function withdrawUnreservedIx({ programId, mint, tokenProgram, admin, to, amount }) {
  const A = pdas(programId);
  return ix(A, [acc(admin, false, true), acc(A.config), acc(mint), acc(A.vault, true), acc(to, true), acc(tokenProgram)], disc('withdraw_unreserved'), u64(amount));
}
/** Claim one weekly allocation. proof: array of 32-byte Uint8Arrays (or hex strings). */
export function claimIx({ programId, mint, tokenProgram, payer, claimant, epochId, index, amount, proof }) {
  const A = pdas(programId);
  const pr = proof.map((p) => (typeof p === 'string' ? fromHex(p) : p));
  return ix(A, [acc(payer, true, true), acc(claimant, false, true), acc(A.config), acc(mint), acc(A.epoch(epochId), true), acc(A.receipt(epochId, index), true), acc(A.vault, true), acc(ata(claimant, mint, tokenProgram), true), acc(tokenProgram), acc(SystemProgram.programId)],
    disc('claim'), u64(epochId), u32(index), u64(amount), u32(pr.length), ...pr);
}
/** Pay a quoted cosmetic order before `deadline` (seconds). orderId: 16 bytes (Uint8Array or hex). */
export function payOrderIx({ programId, mint, tokenProgram, payer, treasury, orderId, amount, deadline }) {
  const A = pdas(programId);
  const id = typeof orderId === 'string' ? fromHex(orderId) : orderId;
  return ix(A, [acc(payer, true, true), acc(A.config), acc(mint), acc(A.order(payer, id), true), acc(ata(payer, mint, tokenProgram), true), acc(A.vault, true), acc(treasury, true), acc(tokenProgram), acc(SystemProgram.programId)],
    disc('pay_order'), id, u64(amount), i64(deadline));
}
/** Garden Club: lock `amount` base units for `days`. */
export function clubLockIx({ programId, mint, tokenProgram, owner, amount, days }) {
  const A = pdas(programId);
  return ix(A, [acc(owner, true, true), acc(A.config), acc(mint), acc(A.lock(owner), true), acc(A.lockVault(owner), true), acc(ata(owner, mint, tokenProgram), true), acc(tokenProgram), acc(SystemProgram.programId)],
    disc('club_lock'), u64(amount), u16(days));
}
export function clubUnlockIx({ programId, mint, tokenProgram, owner }) {
  const A = pdas(programId);
  return ix(A, [acc(owner, false, true), acc(A.config), acc(mint), acc(A.lock(owner), true), acc(A.lockVault(owner), true), acc(ata(owner, mint, tokenProgram), true), acc(tokenProgram)], disc('club_unlock'));
}

// ---- account decoding ----------------------------------------------------------------------------------
function reader(data, name) {
  const d = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (cmp(d.slice(0, 8), accDisc(name)) !== 0) throw new Error(`not a ${name} account`);
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  let o = 8;
  return {
    pk() { const p = new PublicKey(d.slice(o, o + 32)); o += 32; return p; },
    bytes(n) { const b = d.slice(o, o + n); o += n; return b; },
    u64() { const x = v.getBigUint64(o, true); o += 8; return x; },
    i64() { const x = v.getBigInt64(o, true); o += 8; return x; },
    u32() { const x = v.getUint32(o, true); o += 4; return x; },
    u16() { const x = v.getUint16(o, true); o += 2; return x; },
    u8() { return d[o++]; },
  };
}
export function decodeConfig(data) {
  const r = reader(data, 'Config');
  return { admin: r.pk(), pendingAdmin: r.pk(), mint: r.pk(), vault: r.pk(), treasury: r.pk(), recycleBps: r.u16(), paused: !!r.u8(), outstanding: r.u64() };
}
export function decodeEpoch(data) {
  const r = reader(data, 'Epoch');
  return { epochId: r.u64(), root: r.bytes(32), total: r.u64(), claimed: r.u64(), claimDeadline: r.i64(), closed: !!r.u8() };
}
export function decodeReceipt(data) {
  const r = reader(data, 'ClaimReceipt');
  return { epochId: r.u64(), index: r.u32(), claimant: r.pk(), amount: r.u64(), claimedAt: r.i64() };
}
export function decodeLock(data) {
  const r = reader(data, 'ClubLockAccount');
  return { owner: r.pk(), amount: r.u64(), lockedAt: r.i64(), unlockAt: r.i64() };
}
export function decodeOrder(data) {
  const r = reader(data, 'OrderReceipt');
  return { orderId: r.bytes(16), payer: r.pk(), amount: r.u64(), recycled: r.u64(), paidAt: r.i64() };
}

// ---- amounts -------------------------------------------------------------------------------------------
/** 12.5 tokens -> base units for a token with that many decimals (exact: no floating point multiplication). */
export function toBase(tokens, decimals) {
  const text = typeof tokens === 'number' ? tokens.toFixed(Math.min(decimals, 9)) : String(tokens).trim();
  const m = /^(\d+)(?:\.(\d*))?$/.exec(text);
  if (!m) throw new Error(`not an amount: ${tokens}`);
  const fraction = (m[2] ?? '').replace(/0+$/, '');
  if (fraction.length > decimals) throw new Error(`${tokens} has more than ${decimals} decimals`);
  return BigInt(m[1]) * 10n ** BigInt(decimals) + BigInt((fraction || '0').padEnd(decimals, '0') || '0');
}
export const toNumber = (units, decimals) => Number(units) / 10 ** decimals;
export const fromBase = (units, decimals) => toNumber(units, decimals).toLocaleString('en-US', { maximumFractionDigits: 2 });
