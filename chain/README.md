# MGRD on BNB Chain: contracts, integration and operations

Optional token layer for Meme Garden, built to `gametokenomics.md` sections 8 to 13 (written for Solana; the rules
are the same here). The game runs the same without it. **Nothing is deployed**: not on BNB testnet and not on
mainnet. It has been tested on a local chain, and both deployments have been simulated on a BNB testnet node.
There has been **no independent security review**.

## What is on chain

**The token is not part of this repository.** It is launched on Flap. Flap's documentation gives its tokens a
1,000,000,000 maximum supply and 18 decimals, and also offers tax tokens. **Launch it with no tax.**

One Solidity contract in `contracts/` (Solidity 0.8.28, OpenZeppelin 5.6.1) is deployed: **`GardenRewards`**. It is
**not upgradeable**. It is deployed *before* the token exists; the owner names the token with `setToken` **once**, and
it can never be changed. (`contracts/test/` holds two stand-in tokens used only by the tests.)

| Function | Who | What |
|---|---|---|
| `setToken(token)` | owner, once | Names the 18-decimal game token. Until then nothing that moves tokens works. A wrong address cannot be corrected: deploy again |
| `openEpoch(id, root, total, deadline)` | owner | Publishes a week's Merkle root; the pool must hold enough for every open week |
| `claim(id, index, wallet, amount, proof)` | anyone (usually the player) | Pays the fixed allocation to the wallet in the proof, once. Someone else may pay the network fee |
| `closeEpoch(id)` | owner, after the deadline | Stops claims; unclaimed tokens stay in the pool for later weeks |
| `payOrder(orderId, amount, deadline)` | player | Pays a quoted shop order; `recycleBps` (default 50%) stays in the pool, the rest goes to the treasury. Once per wallet and order id; refused after the quote's deadline |
| `clubLock(amount, days)` / `clubUnlock()` | player | Garden Club: lock for 1 to 365 days, then take back exactly that amount. A lock where less than the full amount arrives (a transfer tax) is refused. Unlocking works while paused |
| `withdrawUnreserved(to, amount)` | owner | Takes pool tokens no open week needs. Cannot touch reserved rewards or club locks |
| `updateConfig(recycleBps, paused)`, `setTreasury` | owner | Pause stops claims, payments and new locks |
| `transferOwnership` then `acceptOwnership` | owner, then new owner | Two-step handover. `renounceOwnership` is disabled |

Weekly rewards and club locks share the contract's token balance. `totalLocked` keeps the club part apart: the pool
is `balance - totalLocked`.

A reward leaf is `keccak256(keccak256(abi.encode("MGRD-REWARD-V1" hash, chain id, rewards contract, token, week,
index, wallet, amount)))`, so a proof cannot be reused on another chain, contract, week or wallet. The same hashing
is in `shared/src/chain/evm.js`; the tests check that the two agree.

## What the player's wallet does

- **Connect:** MetaMask, Trust Wallet, Binance Wallet or another EVM wallet. Linking signs a message; it costs nothing.
  The game asks the wallet to switch to (or add) the right BNB network. Smart-contract wallets cannot link yet.
- **Pay or lock:** two confirmations, first to allow **exactly** that amount (never unlimited), then the action.
- **Fees:** every transaction needs a little BNB.
- **Ticker:** the game's screens say $MGRD. If the launched token has another ticker, change the wording.

## Build and test

Needs [Foundry](https://getfoundry.sh) (`forge`, `anvil`) on the machine that builds or tests the contracts. The game
server does not need it: the compiled contracts are saved in `artifacts/`.

```bash
npm run chain:build    # after changing a contract: compiles, then updates artifacts/ and shared/src/chain/abi.js
npm run chain:e2e      # starts a local chain: deploy, link, claim, shop, tips, club, burn, and what must be refused
```

## Deploy, launch, connect

```bash
# 1. deploy the contract (before the token). --treasury receives the treasury half of shop payments;
#    --new-owner proposes a safer owner (hardware wallet or multisig), which must call acceptOwnership()
npm run chain:admin -- deploy --network <net> --key-file <file> --treasury 0x<wallet> [--new-owner 0x<wallet>]
# 2. launch the token on Flap, with NO tax
# 3. look at the token's details first (sends nothing), then name it. THIS WORKS ONCE.
npm run chain:admin -- set-token --network <net> --rewards 0x<contract> --token 0x<token>
npm run chain:admin -- set-token --network <net> --rewards 0x<contract> --token 0x<token> --key-file <owner file> --yes
# 4. fund the reward pool with the tokens from the developer's launch buy (from the wallet that holds them)
npm run chain:admin -- fund --network <net> --rewards 0x<contract> --amount <tokens> --key-file <file>
```

`<net>` is `bsc-testnet` or `bsc`. On `bsc` every sending command also needs `--yes-mainnet`. Once ownership has moved
to a multisig, send `setToken` from the multisig instead.

**Keys:** `--key-file` is a file holding one private key. Create it yourself, keep it in `chain/keys/` (ignored by
git), and never paste a key into a chat, a command line or a repository. Treat any key that has been pasted anywhere
as exposed. The deploying key only needs BNB for fees.

For a testnet trial, `npm run chain:admin -- new-wallet --out chain/keys/testnet.key` makes a throwaway wallet (get
test BNB from the BNB Chain faucet); after `set-token`, run `npm run dev:testnet`.

## Server settings

| Variable | Meaning |
|---|---|
| `MG_REWARDS_CONTRACT`, `MG_MGRD_TOKEN` | Turn the chain features on |
| `MG_CHAIN_CLUSTER` | `bsc-testnet` (default) or `bsc` |
| `MG_TREASURY` | Wallet that receives the treasury share; the MGRD shop stays closed without it. Use the same one the contract has |
| `MG_CHAIN_RPC` | The server's RPC (may contain a private API key; it is not sent to browsers) |
| `MG_CHAIN_PUBLIC_RPC` | The RPC given to browsers (default: the public one) |
| `MG_CONFIRMATIONS` | Blocks on top of a payment or tip before it counts (default 3) |
| `MG_MGRD_SHOP` | `0` keeps the MGRD shop closed |
| `MG_WEEKLY_POOL`, `MG_POT_GOAL`, `MG_BURN_BPS` | Weekly pool shown in estimates, Fireworks Pot goal, burn share |

The server checks that its RPC is really on the chosen network before it accepts any payment or tip.

## Before using it with real value

1. **Independent security review** of the contract (plan section 12).
2. A hardware wallet or multisig as owner. The owner chooses each week's reward list and can withdraw pool tokens
   that no open week has reserved. It can never take club locks.
3. After `set-token`, check on BscScan that the token address matches the launch page.
4. Verify the contract source on BscScan (`forge verify-contract`, with your own BscScan API key).
5. **Tokenomics:** Flap sells the token to the public on its price curve, so the percentage allocation in
   `gametokenomics.md` (40% community, 15% team, ...) cannot be done by handing out a minted supply. Rewards are
   funded with the developer's launch buy. A taxed or non-18-decimal token will not work.

## Weekly operations

- Players earn **Season Points** in the game (Daily Challenge 40, orders/contract 25, festival co-op 20, Sky Island
  discoveries 15; at most 100 a day). The server stores them per week.
- After the week ends: `npm run chain:admin -- finalize --week <Monday> --pool 100000 --network <net> --rewards <addr> --token <addr>`
  computes allocations (linked wallets only, max 1% of the pool each, small amounts carried to next week), stores
  the proofs and prints the root. Review it, then publish: add `--send --key-file <file>` when you first run it, or
  send the printed transaction data from the multisig.
- Players claim from **Menu > MGRD Rewards**. After the deadline: `chain:admin -- close --epoch N`.
- `chain:admin -- status --rewards <addr>` shows the pool, reserved amount, club locks and pause state;
  `pause --on` stops claims, payments and new locks. `poll` starts a holder vote; `burn` sends treasury tokens to
  the dead address and shows it in the game (the token's total supply number does not change).

## Moving from the earlier Solana version

The Solana program, its devnet record and its tools were removed; they remain in git history. Wallets linked in a
database before the move are Solana addresses: the game now treats them as not linked, and players link a BNB
wallet instead.
