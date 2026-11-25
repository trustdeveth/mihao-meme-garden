# MGRD on Solana: program, integration and operations

Optional token layer for Meme Garden, built to `gametokenomics.md` sections 8 to 13. The game runs the same
without it. **Nothing is deployed yet**; everything below was tested on a local validator.

## What is on chain

`programs/garden_rewards` (Anchor 0.31, program id in `target/deploy/program-id.txt`):

| Instruction | Who | What |
|---|---|---|
| `initialize(recycle_bps)` | admin, once | Config + rewards vault (token account owned by the program) |
| `open_epoch(id, root, total, deadline)` | admin | Publishes a week's Merkle root; the vault must hold enough for every open week |
| `claim(id, index, amount, proof)` | player (fee payer may be a sponsor) | Pays the fixed allocation; a receipt per leaf blocks a second claim |
| `close_epoch(id)` | admin, after the deadline | Stops claims; unclaimed tokens stay in the vault for later weeks |
| `pay_order(order_id, amount)` | player | Pays a quoted MGRD-shop order; `recycle_bps` (default 50%) to the vault, the rest to the treasury; one payment per order id |
| `withdraw_unreserved`, `update_config` (pause), `set_treasury`, `propose_admin`/`accept_admin` | admin | Operations; reserved vault funds can never be withdrawn |

Leaves are `sha256(0x00, "MGRD-REWARD-V1", program, mint, week, index, wallet, amount)`, so a proof cannot be
reused in another week, with another mint or by another wallet. The same hashing lives in
`shared/src/chain/program.js` and is checked against the Rust code by a shared test vector.

The token itself is a plain SPL token: 1,000,000,000 MGRD, 6 decimals, **mint authority revoked** at setup, no
freeze authority, no transfer tax.

## Build (Windows + WSL)

```bash
npm run chain:setup-wsl    # once: Rust + Solana CLI inside WSL Ubuntu (no sudo needed)
npm run chain:build        # unit tests + target/deploy/garden_rewards.so
npm run chain:validator    # local test validator with the program loaded (leave running)
npm run chain:e2e          # full flow against it: setup, link, finalize, claim, shop, reserve rules
```

`target/deploy/garden_rewards-keypair.json` is the program address keypair: back it up privately, never publish it.

## Deploy (when you decide to)

1. Devnet first: `solana config set --url devnet`, fund the deployer, then
   `solana program deploy target/deploy/garden_rewards.so --program-id target/deploy/garden_rewards-keypair.json`.
2. Hand the upgrade authority to your multisig (or make the program immutable after review).
3. Host the token logo first: `client/public/token/mgrd.png` (the project logo) and `client/public/token/mgrd.json`
   (replace `YOUR-GAME-DOMAIN` with the real address). Wallets and explorers read the logo from that JSON.
4. `node tools/chain/admin.mjs setup --rpc <URL> --keypair admin.json --program <ID> --metadata-uri https://<domain>/token/mgrd.json --fund <MGRD for the vault> --treasury-owner <multisig>`
   creates $MGRD with its name, symbol and logo (Metaplex metadata), mints the fixed supply, **then** revokes the mint
   authority, creates the treasury account and initializes the program. Metadata can only be added before the mint
   authority is revoked, so never skip `--metadata-uri`.
5. Start the server with:

| Variable | Meaning |
|---|---|
| `MG_PROGRAM_ID`, `MG_MGRD_MINT` | Turn the chain features on |
| `MG_TREASURY` | Treasury token account (MGRD shop payments) |
| `MG_CHAIN_RPC`, `MG_CHAIN_CLUSTER` | RPC URL and label (devnet / mainnet-beta) |
| `MG_MGRD_USD` | USD per MGRD for shop quotes; 0 keeps the shop closed (set it from a real market price) |
| `MG_WEEKLY_POOL` | Weekly pool shown in estimates (default 100,000) |

An independent security review of the program is required before mainnet (plan section 12).

## Weekly operations

- Players earn **Season Points** in the game (Daily Challenge 40, orders/contract 25, festival co-op 20, Sky Island
  discoveries 15; at most 100 a day). The server stores them per week.
- After the week ends: `node tools/chain/admin.mjs finalize --week <Monday> --pool 100000 --program <ID> --mint <MINT>`
  computes allocations (linked wallets only, max 1% of the pool each, small amounts carried to next week), stores
  the proofs and prints the root. Review it, then publish with `--send --rpc --keypair` (or through the multisig).
- Players claim from **Menu > MGRD Rewards** with their wallet. After the deadline: `admin.mjs close --epoch N`.
- `admin.mjs status` shows the vault, reserved amount and pause state; `admin.mjs pause --on` stops claims and payments.
