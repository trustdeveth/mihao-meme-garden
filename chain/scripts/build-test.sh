#!/bin/bash
# TEST-ONLY build: same program with lock "days" lasting one second, for the local validator test of club unlock.
# Output: chain/target/test/garden_rewards.so. Never deploy this file.
set -e
. "$HOME/.cargo/env"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
CHAIN="$(cd "$(dirname "$0")/.." && pwd)"
cd "$CHAIN"
export CARGO_TARGET_DIR="$HOME/.cache/meme-garden-chain-target-test"
cargo build-sbf --manifest-path programs/garden_rewards/Cargo.toml --features short-days --sbf-out-dir "$CARGO_TARGET_DIR/deploy" 2>&1 | grep -E "^error|Finished" || true
mkdir -p target/test && cp "$CARGO_TARGET_DIR/deploy/garden_rewards.so" target/test/
echo TEST_BUILD_DONE
