// Client for the garden_rewards Solana program (chain/programs/garden_rewards): addresses, instruction encoding,
// account decoding and the reward Merkle tree. Shared by the server, the browser and the admin tools so all three
// build exactly the same bytes. Hashing must match the Rust program (see leaf_hash / node_hash there).
import { PublicKey, TransactionInstruction, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';
import { sha256 } from '@noble/hashes/sha256';

export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
export const MGRD_DECIMALS = 6;
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

// ---- addresses -----------------------------------------------------------------------------------------
export function pdas(programId) {
  const P = new PublicKey(programId);
  const find = (...seeds) => PublicKey.findProgramAddressSync(seeds, P)[0];
  return {
    program: P,
    config: find(enc.encode('config')),
    vault: find(enc.encode('vault')),
    epoch: (id) => find(enc.encode('epoch'), u64(id)),
    receipt: (id, index) => find(enc.encode('receipt'), u64(id), u32(index)),
    order: (orderId) => find(enc.encode('order'), orderId),
    lock: (owner) => find(enc.encode('lock'), new PublicKey(owner).toBytes()),
    lockVault: (owner) => find(enc.encode('lockvault'), new PublicKey(owner).toBytes()),
  };
}
export function ata(owner, mint) {
  return PublicKey.findProgramAddressSync([new PublicKey(owner).toBytes(), TOKEN_PROGRAM_ID.toBytes(), new PublicKey(mint).toBytes()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];
}
/** Create the owner's MGRD token account if it does not exist yet (no-op otherwise). */
export function createAtaIdempotentIx(payer, owner, mint) {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: new PublicKey(payer), isSigner: true, isWritable: true },
      { pubkey: ata(owner, mint), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(owner), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(mint), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Uint8Array.of(1),
  });
}

/** Plain SPL transfer between two MGRD accounts (used for tips). */
export function tokenTransferIx({ from, to, owner, amount }) {
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [{ pubkey: new PublicKey(from), isSigner: false, isWritable: true }, { pubkey: new PublicKey(to), isSigner: false, isWritable: true }, { pubkey: new PublicKey(owner), isSigner: true, isWritable: false }],
    data: concat(Uint8Array.of(3), u64(amount)),
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

// ---- instructions -------------------------------------------------------------------------------------
const acc = (pubkey, isWritable = false, isSigner = false) => ({ pubkey: new PublicKey(pubkey), isWritable, isSigner });

export function initializeIx({ programId, admin, mint, treasury, recycleBps }) {
  const A = pdas(programId);
  return new TransactionInstruction({
    programId: A.program,
    keys: [acc(admin, true, true), acc(A.config, true), acc(mint), acc(A.vault, true), acc(treasury), acc(TOKEN_PROGRAM_ID), acc(SystemProgram.programId), acc(SYSVAR_RENT_PUBKEY)],
    data: concat(disc('initialize'), u16(recycleBps)),
  });
}
export function updateConfigIx({ programId, admin, recycleBps = null, paused = null }) {
  const A = pdas(programId);
  const opt16 = recycleBps == null ? Uint8Array.of(0) : concat(Uint8Array.of(1), u16(recycleBps));
  const optB = paused == null ? Uint8Array.of(0) : Uint8Array.of(1, paused ? 1 : 0);
  return new TransactionInstruction({ programId: A.program, keys: [acc(admin, false, true), acc(A.config, true)], data: concat(disc('update_config'), opt16, optB) });
}
export function openEpochIx({ programId, admin, epochId, root, total, claimDeadline }) {
  const A = pdas(programId);
  return new TransactionInstruction({
    programId: A.program,
    keys: [acc(admin, true, true), acc(A.config, true), acc(A.epoch(epochId), true), acc(A.vault), acc(SystemProgram.programId)],
    data: concat(disc('open_epoch'), u64(epochId), root, u64(total), i64(claimDeadline)),
  });
}
export function closeEpochIx({ programId, admin, epochId }) {
  const A = pdas(programId);
  return new TransactionInstruction({ programId: A.program, keys: [acc(admin, false, true), acc(A.config, true), acc(A.epoch(epochId), true)], data: concat(disc('close_epoch'), u64(epochId)) });
}
export function withdrawUnreservedIx({ programId, admin, to, amount }) {
  const A = pdas(programId);
  return new TransactionInstruction({ programId: A.program, keys: [acc(admin, false, true), acc(A.config), acc(A.vault, true), acc(to, true), acc(TOKEN_PROGRAM_ID)], data: concat(disc('withdraw_unreserved'), u64(amount)) });
}
/** Claim one weekly allocation. proof: array of 32-byte Uint8Arrays (or hex strings). */
export function claimIx({ programId, mint, payer, claimant, epochId, index, amount, proof }) {
  const A = pdas(programId);
  const pr = proof.map((p) => (typeof p === 'string' ? fromHex(p) : p));
  return new TransactionInstruction({
    programId: A.program,
    keys: [acc(payer, true, true), acc(claimant, false, true), acc(A.config), acc(A.epoch(epochId), true), acc(A.receipt(epochId, index), true), acc(A.vault, true), acc(ata(claimant, mint), true), acc(TOKEN_PROGRAM_ID), acc(SystemProgram.programId)],
    data: concat(disc('claim'), u64(epochId), u32(index), u64(amount), u32(pr.length), ...pr),
  });
}
/** Pay a quoted cosmetic order. orderId: 16 bytes (Uint8Array or hex). */
export function payOrderIx({ programId, mint, payer, treasury, orderId, amount }) {
  const A = pdas(programId);
  const id = typeof orderId === 'string' ? fromHex(orderId) : orderId;
  return new TransactionInstruction({
    programId: A.program,
    keys: [acc(payer, true, true), acc(A.config), acc(A.order(id), true), acc(ata(payer, mint), true), acc(A.vault, true), acc(treasury, true), acc(TOKEN_PROGRAM_ID), acc(SystemProgram.programId)],
    data: concat(disc('pay_order'), id, u64(amount)),
  });
}

/** Garden Club: lock `amount` base units for `days`. */
export function clubLockIx({ programId, mint, owner, amount, days }) {
  const A = pdas(programId);
  return new TransactionInstruction({
    programId: A.program,
    keys: [acc(owner, true, true), acc(A.config), acc(mint), acc(A.lock(owner), true), acc(A.lockVault(owner), true), acc(ata(owner, mint), true), acc(TOKEN_PROGRAM_ID), acc(SystemProgram.programId), acc(SYSVAR_RENT_PUBKEY)],
    data: concat(disc('club_lock'), u64(amount), u16(days)),
  });
}
export function clubUnlockIx({ programId, mint, owner }) {
  const A = pdas(programId);
  return new TransactionInstruction({
    programId: A.program,
    keys: [acc(owner, false, true), acc(A.config), acc(A.lock(owner), true), acc(A.lockVault(owner), true), acc(ata(owner, mint), true), acc(TOKEN_PROGRAM_ID)],
    data: disc('club_unlock'),
  });
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

/** 12.5 MGRD -> 12500000n base units; and back to a display string. */
export const toBase = (mgrd) => BigInt(Math.round(Number(mgrd) * 10 ** MGRD_DECIMALS));
export const fromBase = (units) => (Number(units) / 10 ** MGRD_DECIMALS).toLocaleString('en-US', { maximumFractionDigits: 2 });
