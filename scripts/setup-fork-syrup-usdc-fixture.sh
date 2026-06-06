#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
FIXTURE_DIR="${PROJECT_DIR}/tests/fixtures"
WALLET="${FIXTURE_DIR}/fork-wallet.json"

mkdir -p "$FIXTURE_DIR"

if [ ! -f "$WALLET" ]; then
  solana-keygen new -o "$WALLET" --no-bip39-passphrase --force
fi

WALLET_PUBKEY=$(solana-keygen pubkey "$WALLET")
node "${SCRIPT_DIR}/gen-fork-syrup-usdc-fixture.mjs" "$WALLET_PUBKEY"
echo "Fixture wallet: $WALLET_PUBKEY"
