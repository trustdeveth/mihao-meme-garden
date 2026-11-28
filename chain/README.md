# MGRD on Solana: program, integration and operations

Optional token layer for Meme Garden, built to `gametokenomics.md` sections 8 to 13. The game runs the same
without it. **Nothing is deployed on Solana yet** (not on devnet or mainnet). Everything below has been tested only
on a private local network. There has been **no independent security review**.

The token is not part of this repository. The plan is to launch it on **Pump.fun**.

## What is on chain

`programs/garden_rewards` (Anchor 0.31):

| Instruction | Who | What |
|---|---|---|
| `initialize(recycle_bps)` | the program's **upgrade authority**, once | Names the token and treasury; creates the rewards vault. That wallet becomes the admin |
| `open_epoch(id, root, total, deadline)` | admin | Publishes a week's Merkle root; the vault must hold enough for every open week |
| `claim(id, index, amount, proof)` | player | Pays the fixed allocation; a receipt per leaf blocks a second claim |
| `close_epoch(id)` | admin, after the deadline | Stops claims; unclaimed tokens stay in the vault |
| `pay_order(order_id, amount, deadline)` | player | Pays a quoted shop order before the quote runs out; `recycle_bps` (default 50%) to the vault, the rest to the treasury. Receipts are per payer and order id |
| `club_lock(amount, days)` / `club_unlock()` | player | Garden Club lock; the same amount comes back after the date, even while paused |
| `withdraw_unreserved`, `update_config` (recycle share, pause), `set_treasury`, `propose_admin` / `accept_admin` | admin | Operations; funds reserved for open weeks cannot be withdrawn |

**Deploy first, name the token later.** The program is deployed before the token exists. `initialize` is refused for
everyone except the upgrade authority, so nobody can set the program up with their own token in between.

**Which tokens it accepts.** Classic SPL tokens and Token-2022 tokens, any number of decimals. It refuses a token
whose mint authority is not revoked, that has a freeze authority, or that has any Token-2022 extension other than
the metadata pointer and token metadata (so: no transfer fee, transfer hook, permanent delegate and so on). On
2026-11-28, five newly created Pump.fun tokens on mainnet were read and all would be accepted (Token-2022,
6 decimals, only those two extensions). Always run `check-token` on the real token.

**The upgrade authority matters.** Whoever holds it can replace the program's code, and so change every rule above.
Keep it in a safe wallet or a multisig (`solana program set-upgrade-authority`). Making the program final removes
the risk and also the ability to fix bugs. `initialize` needs it, so change or remove it only after `init`.

Rewards leaves are `sha256(0x00, "MGRD-REWARD-V1", program, mint, week, index, wallet, amount)`. The same hashing
is in `shared/src/chain/program.js` and checked against the Rust code by a shared test vector.

## Build and test (Windows + WSL Ubuntu)

```bash
npm run chain:build          # Rust unit tests + chain/target/deploy/garden_rewards.so
npm run chain:build-test     # TEST build: a Garden Club lock "day" is one second. Never deploy it
npm run chain:test-program   # the program on a local network, with both kinds of token
npm run chain:e2e            # the real game server and admin tool on a local network
```

The package scripts hold this computer's path to `chain/scripts/build.sh`; change it if the folder moves. WSL needs
Rust and the Solana (Agave) tools (`chain/scripts/wsl-setup.sh`). Both tests start and stop their own local network
on port 8899.

`chain/target/deploy/garden_rewards-keypair.json` fixes the program's address. It is git-ignored: **back it up
privately, never publish it**, and do not delete `chain/target` without a backup. The first build creates it and
writes the address into `lib.rs`.

## Launch order (nothing here runs by itself)

Costs checked on 2026-11-28: the program's deposit on mainnet is about 2.46 SOL (`solana rent` for the built file).
Keep about 3 SOL in the deploy wallet; a later upgrade needs about the same again for a short time.

1. Get an independent security review.
2. Use a **new deploy wallet** that has never been shared. Try everything on devnet first.
3. Deploy (in WSL, from the project folder):
   `solana program deploy chain/target/deploy/garden_rewards.so --program-id chain/target/deploy/garden_rewards-keypair.json --keypair <deploy-wallet.json> --url <network>`
4. Launch the token on Pump.fun, paired with SOL. In a standard launch the supply is 1,000,000,000. Leave special
   modes (such as Mayhem mode and holder rewards) off: they change how the token or its creator fee behaves.
5. `npm run chain:admin -- check-token --mint <MINT> --rpc <URL>` (sends nothing).
6. `npm run chain:admin -- init --mint <MINT> --program <ID> --rpc <URL> --keypair <deploy-wallet.json>` shows what it
   would do. Check the address letter by letter, then add `--yes` (and `--yes-mainnet` on mainnet). **Once only.**
7. `npm run chain:admin -- fund --amount <TOKENS> --program <ID> --rpc <URL> --keypair <wallet-holding-the-tokens.json> --yes`
8. `npm run chain:admin -- status --program <ID> --rpc <URL>`
9. Start the server with:

| Variable | Meaning |
|---|---|
| `MG_PROGRAM_ID`, `MG_MGRD_MINT` | Turn the token features on |
| `MG_CHAIN_CLUSTER` | `devnet`, `mainnet-beta` or `localnet` |
| `MG_CHAIN_RPC` | RPC address (default: the public one; use a paid one for a real launch) |
| `MG_TREASURY` | Optional: the treasury **token account** the server must see in the program |
| `MG_WEEKLY_POOL` | Weekly pool shown in estimates (default 100,000) |
| `MG_BURN_BPS` | Share of shop payments set aside to burn (default 2000 = 20%) |
| `MG_MGRD_SHOP` | `0` keeps the shop closed |

The server reads the token's decimals, token program and treasury from the chain. It keeps the token features off
until the program has been given **the same token** as `MG_MGRD_MINT`.

Sending anything to a network other than a local one, devnet or testnet also needs `--yes-mainnet`.

## Weekly operations

- Players earn **Season Points** (Daily Challenge 40, orders and contract 25, festival co-op 20, Sky Island 15; at
  most 100 a day). Only players with a linked wallet **when the week is finalized** are included.
- After the week ends: `admin.mjs finalize --week <Monday> --pool 100000 --program <ID> --rpc <URL>` computes the
  allocations (at most 1% of the pool each; amounts under 1 carry over), stores the proofs and prints the root.
  It stores the week as finalized even without `--send`, so add `--send --keypair` when you mean to publish.
- After the claim deadline: `admin.mjs close --epoch N`.
- **Burns:** the game shows 20% of shop payments as waiting to be burned. `admin.mjs burn --amount <TOKENS>` burns
  from the signing wallet and records the transaction. **Use it only for shop-sales burns**: every recorded burn is
  subtracted from the shop amount still waiting. Other burns (for example from creator fees) would need their own
  label first.
- `admin.mjs pause --on` stops claims, payments and new locks.

## The earlier BNB Chain contract

Before the move back to Solana, a rewards contract was deployed on **BSC mainnet** at
`0x8ca1E92fEff93Da4337baf2a98faf9FbdCa05d05` (record: `deployment-bsc.json`). It is not used by this code, which no
longer contains the BNB version (it is in git history, commit `c6e4edb`). It cannot be removed from the chain.
**Its owner wallet's private key was shared in a chat: treat it as exposed. Never connect a token to that contract
or send value to it.** A later bridge to BNB Chain is a separate project and needs its own security review.
