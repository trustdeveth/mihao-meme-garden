#!/bin/bash
# Build the on-chain program (inside WSL/Linux): unit tests on the host, then the SBF binary for Solana.
# Usage (from Windows): wsl -d Ubuntu -- bash <this file's /mnt/... path> [--test]
#   --test  TEST ONLY build into chain/target/test, where a Garden Club lock "day" lasts one second. Never deploy it.
# Output: chain/target/deploy/garden_rewards.so and garden_rewards-keypair.json (the program address).
set -e
. "$HOME/.cargo/env"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
CHAIN="$(cd "$(dirname "$0")/.." && pwd)"
cd "$CHAIN"
mkdir -p target/deploy target/test
KP=target/deploy/garden_rewards-keypair.json
if [ ! -f "$KP" ]; then solana-keygen new --no-bip39-passphrase --silent -o "$KP" >/dev/null; fi
ID=$(solana-keygen pubkey "$KP")
sed -i "s/declare_id!(\"[1-9A-HJ-NP-Za-km-z]*\")/declare_id!(\"$ID\")/" programs/garden_rewards/src/lib.rs
echo "Program id: $ID"
echo "$ID" > target/deploy/program-id.txt
# build in the Linux home (fast), copy the results back
if [ "$1" = "--test" ]; then
  export CARGO_TARGET_DIR="$HOME/.cache/meme-garden-chain-target-test"
  cargo build-sbf --arch v0 --manifest-path programs/garden_rewards/Cargo.toml --features short-days --sbf-out-dir "$CARGO_TARGET_DIR/deploy"
  cp "$CARGO_TARGET_DIR/deploy/garden_rewards.so" target/test/
  echo TEST_BUILD_DONE
else
  export CARGO_TARGET_DIR="$HOME/.cache/meme-garden-chain-target"
  cargo test --manifest-path programs/garden_rewards/Cargo.toml -- --nocapture 2>&1 | grep -E "LEAF_VECTOR|test result|^error|FAILED|panicked" || true
  cargo build-sbf --arch v0 --manifest-path programs/garden_rewards/Cargo.toml --sbf-out-dir "$CARGO_TARGET_DIR/deploy"
  cp "$CARGO_TARGET_DIR/deploy/garden_rewards.so" target/deploy/
  ls -la target/deploy/ | grep garden
  echo BUILD_DONE
fi
