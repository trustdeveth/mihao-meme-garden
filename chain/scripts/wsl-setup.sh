#!/bin/bash
# One-time toolchain setup inside WSL (no sudo): Rust (rustup) and the Solana/Agave CLI with cargo-build-sbf.
# Usage (from Windows): wsl -d Ubuntu -- bash /mnt/d/work/meme/solana-garden-plan/meme-garden/chain/scripts/wsl-setup.sh
set -e
if ! command -v cargo >/dev/null 2>&1 && [ ! -x "$HOME/.cargo/bin/cargo" ]; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
fi
. "$HOME/.cargo/env"
if [ ! -x "$HOME/.local/share/solana/install/active_release/bin/cargo-build-sbf" ]; then
  sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
fi
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
cargo --version
solana --version
cargo-build-sbf --version
echo SETUP_DONE
