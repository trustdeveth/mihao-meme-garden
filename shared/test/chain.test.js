// The JS reward-proof code must hash exactly like the contract (chain/contracts/GardenRewards.sol).
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, encodeFunctionData } from 'viem';
import { leafHash, buildTree, verifyProof, claimCall, payOrderCall, approveCall, orderIdBytes, toBase, toNumber, viemChain, NETWORKS, REWARDS_ABI } from '../src/chain/evm.js';

const addr = (n) => `0x${n.toString(16).padStart(2, '0').repeat(20)}`;
const WHERE = { chainId: 97, rewards: addr(0x11), token: addr(0x22) };

test('leaf hash matches the contract (value returned by the contract itself; npm run chain:e2e also compares them live)', () => {
  assert.equal(leafHash(WHERE, 7, 3, addr(4), 1_234_567n), '0xe6f590a48ea65838e7e86cf902384d189b9a1923d9a44a42b71b8bbccb8fe085');
});

test('every proof verifies and no field can be changed', () => {
  const leaves = Array.from({ length: 7 }, (_, i) => leafHash(WHERE, 2, i, addr(i + 1), 1000 + i));
  const t = buildTree(leaves);
  for (let i = 0; i < leaves.length; i++) {
    const proof = t.proof(i);
    assert.ok(verifyProof(leaves[i], proof, t.root));
    for (const forged of [
      leafHash(WHERE, 2, i, addr(i + 1), 1001 + i), leafHash(WHERE, 3, i, addr(i + 1), 1000 + i), leafHash(WHERE, 2, i + 1, addr(i + 1), 1000 + i),
      leafHash(WHERE, 2, i, addr(99), 1000 + i), leafHash({ ...WHERE, chainId: 56 }, 2, i, addr(i + 1), 1000 + i),
      leafHash({ ...WHERE, rewards: addr(0x33) }, 2, i, addr(i + 1), 1000 + i), leafHash({ ...WHERE, token: addr(0x33) }, 2, i, addr(i + 1), 1000 + i),
    ]) assert.ok(!verifyProof(forged, proof, t.root));
  }
});

test('contract calls carry the right values', () => {
  const data = (c) => decodeFunctionData({ abi: c.abi, data: encodeFunctionData(c) });
  const claim = data(claimCall({ rewards: WHERE.rewards, epochId: 4, index: 2, claimant: addr(1), amount: '50', proof: [`0x${'00'.repeat(32)}`] }));
  assert.equal(claim.functionName, 'claim');
  assert.deepEqual(claim.args.slice(0, 2), [4n, 2n]);
  const pay = data(payOrderCall({ rewards: WHERE.rewards, orderId: '00112233445566778899aabbccddeeff', amount: '10', deadline: 99 }));
  assert.deepEqual(pay.args, ['0x00112233445566778899aabbccddeeff', 10n, 99n]);
  const ok = data(approveCall({ token: WHERE.token, rewards: WHERE.rewards, amount: 10n }));
  assert.equal(ok.args[1], 10n, 'only the exact amount is approved');
  assert.throws(() => orderIdBytes('abc'));
});

test('networks, 18-decimal amounts and what the contract cannot do', () => {
  assert.deepEqual([NETWORKS.bsc.chainId, NETWORKS['bsc-testnet'].chainId], [56, 97]);
  assert.equal(viemChain('bsc-testnet').id, 97);
  assert.throws(() => viemChain('solana'));
  assert.equal(toBase(1500), 1500n * 10n ** 18n, 'no floating point error');
  assert.equal(toBase('12.5'), 125n * 10n ** 17n);
  assert.equal(toNumber(toBase(1_000_000_000)), 1_000_000_000);
  const names = REWARDS_ABI.filter((x) => x.type === 'function').map((x) => x.name);
  assert.ok(names.includes('setToken'));
  assert.ok(!names.some((n) => /mint|upgrade|rescue|sweep/i.test(n)));
});
