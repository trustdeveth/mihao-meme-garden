// The Solana client code (shared/src/chain/program.js) must build exactly what the program expects.
// The program itself is tested on a local network: node tools/chain/solana-program-test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import { leafHash, buildTree, verifyProof, toHex, pdas, ata, mintInfo, claimIx, payOrderIx, initializeIx, tokenTransferIx, toBase, toNumber, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '../src/chain/program.js';

const PROGRAM = '4buGybqEKaVm4cQzvdmcwpkZrz94qea4a4yhe97GBNfP';
const pk = (n) => new PublicKey(new Uint8Array(32).fill(n));

test('leaf hash matches the Rust test vector', () => {
  // printed by `cargo test leaf_vector` (it uses a fixed program address of 32 sevens)
  assert.equal(toHex(leafHash(pk(7), pk(9), 7, 3, pk(4), 1_234_567)), 'b8885da0677f2ebb96802b72393e42acaf0e6221a3d394a5bbeac722749b5348');
});

test('every proof verifies and no field can be changed', () => {
  const leaves = Array.from({ length: 7 }, (_, i) => leafHash(PROGRAM, pk(9), 2, i, pk(i + 1), 1000 + i));
  const t = buildTree(leaves);
  for (let i = 0; i < leaves.length; i++) {
    assert.ok(verifyProof(leaves[i], t.proof(i), t.root));
    assert.ok(!verifyProof(leafHash(PROGRAM, pk(9), 2, i, pk(i + 1), 1001 + i), t.proof(i), t.root));
    assert.ok(!verifyProof(leafHash(PROGRAM, pk(9), 3, i, pk(i + 1), 1000 + i), t.proof(i), t.root));
  }
});

test('instructions use the token\'s own program', () => {
  for (const tokenProgram of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const common = { programId: PROGRAM, mint: pk(9), tokenProgram };
    const claim = claimIx({ ...common, payer: pk(1), claimant: pk(1), epochId: 4, index: 2, amount: 50, proof: [new Uint8Array(32)] });
    assert.equal(claim.keys.length, 10);
    assert.equal(claim.keys[5].pubkey.toBase58(), pdas(PROGRAM).receipt(4, 2).toBase58());
    assert.equal(claim.keys[7].pubkey.toBase58(), ata(pk(1), pk(9), tokenProgram).toBase58());
    assert.equal(claim.data.length, 8 + 8 + 4 + 8 + 4 + 32);
    const pay = payOrderIx({ ...common, payer: pk(1), treasury: pk(5), orderId: '00112233445566778899aabbccddeeff', amount: 10, deadline: 99 });
    assert.equal(pay.data.length, 8 + 16 + 8 + 8);
    assert.notEqual(pdas(PROGRAM).order(pk(1), new Uint8Array(16)).toBase58(), pdas(PROGRAM).order(pk(2), new Uint8Array(16)).toBase58(), 'each payer has their own receipts');
    const init = initializeIx({ ...common, admin: pk(1), treasury: pk(5), recycleBps: 5000 });
    assert.equal(init.keys[2].pubkey.toBase58(), pdas(PROGRAM).programData.toBase58(), 'the setup shows the program data, which names who may do it');
    const tip = tokenTransferIx({ from: pk(2), to: pk(3), owner: pk(1), mint: pk(9), tokenProgram, decimals: 9, amount: 5n });
    assert.deepEqual([tip.programId.toBase58(), tip.data[0], tip.data[9]], [tokenProgram.toBase58(), 12, 9]);
  }
  assert.notEqual(ata(pk(1), pk(9), TOKEN_PROGRAM_ID).toBase58(), ata(pk(1), pk(9), TOKEN_2022_PROGRAM_ID).toBase58());
});

test('decimals and token program come from the token itself; amounts are exact', () => {
  const data = new Uint8Array(82);
  data[44] = 9;
  assert.deepEqual(mintInfo({ owner: TOKEN_2022_PROGRAM_ID, data }), { tokenProgram: TOKEN_2022_PROGRAM_ID, decimals: 9 });
  assert.throws(() => mintInfo({ owner: pk(1), data }), /not a token/);
  assert.throws(() => mintInfo(null), /no token/);
  assert.equal(toBase(1500, 6), 1_500_000_000n);
  assert.equal(toBase('12.5', 9), 12_500_000_000n);
  assert.equal(toBase(1_000_000_000, 9), 10n ** 18n);
  assert.throws(() => toBase('0.1234567', 6), /decimals/);
  assert.equal(toNumber(toBase(2.5, 6), 6), 2.5);
});
