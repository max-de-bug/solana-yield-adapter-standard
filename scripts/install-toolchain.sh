#!/usr/bin/env bash
# Install Solana 2.2.20 + Anchor 1.0.1 for this project.
set -euo pipefail

ANCHOR_VERSION="1.0.1"
SOLANA_VERSION="2.2.20"

echo "Installing Solana ${SOLANA_VERSION} (test/runtime CLI)..."
agave-install init "${SOLANA_VERSION}"

echo "Installing Agave 3.1.10 platform-tools (SBF build, rustc 1.89)..."
agave-install init 3.1.10

export PATH="${HOME}/.local/share/solana/install/active_release/bin:${PATH}"
echo "Solana: $(solana --version)"

if command -v avm >/dev/null 2>&1; then
  yes | avm install "${ANCHOR_VERSION}" 2>/dev/null || true
  if avm use "${ANCHOR_VERSION}" 2>/dev/null && anchor --version 2>/dev/null; then
    echo "Anchor (avm): $(anchor --version)"
    exit 0
  fi
fi

echo "Installing anchor-cli ${ANCHOR_VERSION} from source (works on older GLIBC)..."
cargo install --git https://github.com/solana-foundation/anchor --tag "v${ANCHOR_VERSION}" anchor-cli --locked --force
export PATH="${HOME}/.cargo/bin:${PATH}"

echo "Anchor: $(anchor --version)"
