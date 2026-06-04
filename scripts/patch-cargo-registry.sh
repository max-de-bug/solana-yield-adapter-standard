#!/usr/bin/env bash
# Patch edition2024 crates in the local cargo registry for Solana SBF cargo 1.84.
set -euo pipefail
for registry in \
  "$HOME/.cargo/registry/src/index.crates.io-"*; do
  [ -d "$registry" ] || continue
  find "$registry" -name Cargo.toml -exec grep -l 'edition = "2024"' {} \; 2>/dev/null \
    | while read -r f; do
      sed -i 's/edition = "2024"/edition = "2021"/' "$f"
    done
done
echo "Patched edition2024 manifests in cargo registry."
