#!/bin/bash
# Start a throwaway local Solana validator (inside WSL) with the built program preloaded at its address.
# RPC: http://127.0.0.1:8899 (reachable from Windows). Stop with Ctrl+C. Nothing is deployed to a public network.
. "$HOME/.cargo/env"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
CHAIN="$(cd "$(dirname "$0")/.." && pwd)"
ID=$(cat "$CHAIN/target/deploy/program-id.txt")
LEDGER="$HOME/.cache/meme-garden-ledger"
rm -rf "$LEDGER"
SO="$CHAIN/target/deploy/garden_rewards.so"
[ "$1" = "--test-build" ] && SO="$CHAIN/target/test/garden_rewards.so"
exec solana-test-validator --reset --ledger "$LEDGER" --bpf-program "$ID" "$SO" > /dev/null
