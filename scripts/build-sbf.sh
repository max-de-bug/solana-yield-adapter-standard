#!/usr/bin/env bash
# Build all program .so artifacts into target/deploy (Anchor 1.0.1 + Solana 2.2.20 runtime).
#
# Uses Agave 3.1.x platform-tools (rustc 1.89) while targeting Solana 2.2.20 for tests.
# Install: agave-install init 3.1.10
#
# Usage: ./scripts/build-sbf.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

export CARGO_TARGET_DIR="${PROJECT_DIR}/target"

# Anchor 1.0.1 deps need rustc >= 1.85; use Agave 3.1.x platform-tools for SBF only.
AGAVE_311="${HOME}/.local/share/solana/install/releases/3.1.10/solana-release/bin"
if [ -d "$AGAVE_311" ]; then
  export PATH="${AGAVE_311}:${PATH}"
else
  echo "WARN: Agave 3.1.10 not found. Run: agave-install init 3.1.10"
  export PATH="${HOME}/.local/share/solana/install/active_release/bin:${PATH}"
fi

bash "${SCRIPT_DIR}/patch-cargo-registry.sh"

# Keep in sync with scripts/build-idls.sh and [programs.*] in Anchor.toml.
PROGRAMS=(
  adapter-registry
  adapter-kamino
  adapter-marginfi
  adapter-jupiter
  adapter-maple
  adapter-drift
  yield-dispatcher
)

echo "Building ${#PROGRAMS[@]} programs into ${CARGO_TARGET_DIR}/deploy ..."
for name in "${PROGRAMS[@]}"; do
  echo "  cargo build-sbf: ${name}"
  cargo build-sbf --manifest-path "${PROJECT_DIR}/programs/${name}/Cargo.toml"
done

echo ""
echo "Deploy artifacts:"
ls -la "${CARGO_TARGET_DIR}/deploy/"*.so 2>/dev/null || {
  echo "No .so files found in target/deploy"
  exit 1
}
