#!/bin/bash
# Deploy the built program to Solana DEVNET.
# Usage: wsl -d Ubuntu -- bash chain/scripts/deploy-devnet.sh /mnt/c/path/to/deployer.json [buffer-keypair.json]
# Pass a buffer keypair to resume an interrupted upload (recover it with `solana-keygen recover` from the seed
# phrase the CLI printed). Uses --use-rpc: sending through the RPC is far more reliable than direct validator
# connections from WSL.
set -e
. "$HOME/.cargo/env"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
CHAIN="$(cd "$(dirname "$0")/.." && pwd)"
KEY="$1"
[ -f "$KEY" ] || { echo "deployer keypair file required"; exit 1; }
URL="${RPC:-https://api.devnet.solana.com}"
BUF=()
[ -n "$2" ] && BUF=(--buffer "$2")
echo "deployer: $(solana-keygen pubkey "$KEY")  balance: $(solana balance --url "$URL" --keypair "$KEY")"
solana program deploy --url "$URL" --keypair "$KEY" --program-id "$CHAIN/target/deploy/garden_rewards-keypair.json" \
  "${BUF[@]}" --use-rpc --max-sign-attempts 50 --with-compute-unit-price 20000 "$CHAIN/target/deploy/garden_rewards.so"
solana program show --url "$URL" --keypair "$KEY" "$(cat "$CHAIN/target/deploy/program-id.txt")" || true
echo "balance after: $(solana balance --url "$URL" --keypair "$KEY")"
echo DEPLOY_DONE
