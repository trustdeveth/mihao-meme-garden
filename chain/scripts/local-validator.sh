#!/bin/bash
# A throwaway local Solana network (inside WSL) with the built program loaded as an upgradeable program, as it
# would be after a real deployment. Nothing is sent to a public network. RPC: http://127.0.0.1:8899. Ctrl+C stops it.
#   local-validator.sh <upgrade authority address> [--test]      --test loads the short-days TEST build
set -e
. "$HOME/.cargo/env"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
CHAIN="$(cd "$(dirname "$0")/.." && pwd)"
AUTHORITY="$1"
[ -n "$AUTHORITY" ] || { echo "give the upgrade authority address"; exit 1; }
ID=$(cat "$CHAIN/target/deploy/program-id.txt")
SO="$CHAIN/target/deploy/garden_rewards.so"
[ "$2" = "--test" ] && SO="$CHAIN/target/test/garden_rewards.so"
LEDGER="$HOME/.cache/meme-garden-ledger"
rm -rf "$LEDGER"
exec solana-test-validator --reset --quiet --ledger "$LEDGER" --upgradeable-program "$ID" "$SO" "$AUTHORITY" > /dev/null
