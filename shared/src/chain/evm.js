// Client for the GardenRewards contract on BNB Chain (chain/contracts): networks, contract calls and the reward
// Merkle tree. Shared by the server, the browser and the operator tool so all three build exactly the same bytes.
// Hashing must match leafHash in GardenRewards.sol; node hashing matches OpenZeppelin's MerkleProof.
import { keccak256, encodeAbiParameters, concat, toBytes, getAddress, isAddress, defineChain, parseUnits, formatUnits } from 'viem';
import { TOKEN_ABI, REWARDS_ABI } from './abi.js';

export { TOKEN_ABI, REWARDS_ABI, getAddress, isAddress };
export const MGRD_DECIMALS = 18; // Flap tokens have 18; GardenRewards.setToken accepts nothing else

// ---- networks ------------------------------------------------------------------------------------------
export const NETWORKS = Object.freeze({
  bsc: { chainId: 56, name: 'BNB Smart Chain', rpc: 'https://bsc-dataseed.bnbchain.org', explorer: 'https://bscscan.com', symbol: 'BNB', confirmations: 3 },
  'bsc-testnet': { chainId: 97, name: 'BNB Smart Chain Testnet', rpc: 'https://bsc-testnet-dataseed.bnbchain.org', explorer: 'https://testnet.bscscan.com', symbol: 'tBNB', confirmations: 3 },
  local: { chainId: 31337, name: 'Local test chain', rpc: 'http://127.0.0.1:8545', explorer: '', symbol: 'ETH', confirmations: 0 },
});
/** A viem chain object for one of NETWORKS, optionally with another RPC address. */
export function viemChain(cluster, rpc) {
  const n = NETWORKS[cluster];
  if (!n) throw new Error(`unknown network "${cluster}" (use ${Object.keys(NETWORKS).join(', ')})`);
  return defineChain({
    id: n.chainId, name: n.name, nativeCurrency: { name: n.symbol, symbol: n.symbol, decimals: 18 },
    rpcUrls: { default: { http: [rpc || n.rpc] } },
    ...(n.explorer ? { blockExplorers: { default: { name: 'BscScan', url: n.explorer } } } : {}),
    testnet: cluster !== 'bsc',
  });
}

// ---- Merkle tree ---------------------------------------------------------------------------------------
const LEAF_DOMAIN = keccak256(toBytes('MGRD-REWARD-V1'));
const LEAF_TYPES = ['bytes32', 'uint256', 'address', 'address', 'uint256', 'uint256', 'address', 'uint256'].map((type) => ({ type }));

/** @returns {`0x${string}`} the leaf for one allocation, bound to the chain, contract, token, week, index and wallet */
export function leafHash({ chainId, rewards, token }, epochId, index, claimant, amount) {
  return keccak256(keccak256(encodeAbiParameters(LEAF_TYPES, [LEAF_DOMAIN, BigInt(chainId), getAddress(rewards), getAddress(token), BigInt(epochId), BigInt(index), getAddress(claimant), BigInt(amount)])));
}
/** Inner node: the smaller hash first, so proofs need no left/right flags. */
export const nodeHash = (a, b) => keccak256(concat(a.toLowerCase() <= b.toLowerCase() ? [a, b] : [b, a]));
export function verifyProof(leaf, proof, root) { let h = leaf; for (const p of proof) h = nodeHash(h, p); return h.toLowerCase() === root.toLowerCase(); }

/**
 * Tree over leaves in order (index = position). Odd nodes are carried up unchanged.
 * @returns {{root: `0x${string}`, proof: (i:number)=>`0x${string}`[]}}
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

// ---- contract calls (ready for viem's readContract / writeContract) ---------------------------------------
/** A server order id (32 hex characters) as the contract's bytes16. */
export function orderIdBytes(id) {
  const hex = String(id).replace(/^0x/, '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new Error('bad order id');
  return `0x${hex}`;
}
// the token can refuse inside a rewards call (not enough allowed, say), so its error names are needed to explain why
const REWARDS_CALL_ABI = [...REWARDS_ABI, ...TOKEN_ABI.filter((x) => x.type === 'error' && !REWARDS_ABI.some((y) => y.name === x.name))];
const rewardsCall = (rewards, functionName, args) => ({ address: getAddress(rewards), abi: REWARDS_CALL_ABI, functionName, args });
const tokenCall = (token, functionName, args) => ({ address: getAddress(token), abi: TOKEN_ABI, functionName, args });

export const claimCall = ({ rewards, epochId, index, claimant, amount, proof }) => rewardsCall(rewards, 'claim', [BigInt(epochId), BigInt(index), getAddress(claimant), BigInt(amount), proof]);
/** `deadline` is the quote's expiry in seconds: the contract refuses a later payment. */
export const payOrderCall = ({ rewards, orderId, amount, deadline }) => rewardsCall(rewards, 'payOrder', [orderIdBytes(orderId), BigInt(amount), BigInt(deadline)]);
export const clubLockCall = ({ rewards, amount, days }) => rewardsCall(rewards, 'clubLock', [BigInt(amount), Number(days)]);
export const clubUnlockCall = ({ rewards }) => rewardsCall(rewards, 'clubUnlock', []);
/** Let the rewards contract take exactly `amount` (the game never asks for an unlimited approval). */
export const approveCall = ({ token, rewards, amount }) => tokenCall(token, 'approve', [getAddress(rewards), BigInt(amount)]);
/** Plain transfer between two wallets (used for tips). */
export const transferCall = ({ token, to, amount }) => tokenCall(token, 'transfer', [getAddress(to), BigInt(amount)]);

/** 12.5 MGRD -> base units (exact, no floating point), a number again, and a display string. */
export const toBase = (mgrd) => parseUnits(String(mgrd), MGRD_DECIMALS);
export const toNumber = (units) => Number(formatUnits(BigInt(units), MGRD_DECIMALS));
export const fromBase = (units) => toNumber(units).toLocaleString('en-US', { maximumFractionDigits: 2 });
