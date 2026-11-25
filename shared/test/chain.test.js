// The JS reward-proof code must hash exactly like the Rust program (chain/programs/garden_rewards).
import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import { leafHash, buildTree, verifyProof, toHex, pdas, claimIx, payOrderIx } from '../src/chain/program.js';

const PROGRAM = '4buGybqEKaVm4cQzvdmcwpkZrz94qea4a4yhe97GBNfP';
const pk = (n) => new PublicKey(new Uint8Array(32).fill(n));

test('leaf hash matches the Rust test vector', () => {
  // printed by `cargo test leaf_vector` in chain/ (program id 4buGy...)
  assert.equal(toHex(leafHash(PROGRAM, pk(9), 7, 3, pk(4), 1_234_567)), 'c88c2436f106d90aea05a8607305b37b8b59369f44ac11b302c79129031f7328');
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

test('instructions carry the right accounts', () => {
  const ix = claimIx({ programId: PROGRAM, mint: pk(9), payer: pk(1), claimant: pk(1), epochId: 4, index: 2, amount: 50, proof: [new Uint8Array(32)] });
  assert.equal(ix.keys.length, 9);
  assert.equal(ix.keys[4].pubkey.toBase58(), pdas(PROGRAM).receipt(4, 2).toBase58());
  assert.equal(ix.data.length, 8 + 8 + 4 + 8 + 4 + 32);
  const po = payOrderIx({ programId: PROGRAM, mint: pk(9), payer: pk(1), treasury: pk(5), orderId: '00112233445566778899aabbccddeeff', amount: 10 });
  assert.equal(po.data.length, 8 + 16 + 8);
});
