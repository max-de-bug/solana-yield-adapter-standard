#!/usr/bin/env bash
# Regenerate Anchor IDLs and TypeScript client types for all workspace programs.
#
# Keep PROGRAMS in sync with scripts/build-sbf.sh (directory names) and Anchor.toml.
# Anchor -p names use underscores; deploy artifacts use hyphens.
#
# Usage: ./scripts/build-idls.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Order: registry first (dispatcher CPI), then adapters, then dispatcher.
PROGRAMS=(
  adapter_registry
  adapter_kamino
  adapter_marginfi
  adapter_jupiter
  adapter_maple
  adapter_drift
  yield_dispatcher
)

IDL_DIR="${PROJECT_DIR}/target/idl"
TYPES_DIR="${PROJECT_DIR}/target/types"

mkdir -p "$IDL_DIR" "$TYPES_DIR"
cd "$PROJECT_DIR"

echo "Building ${#PROGRAMS[@]} IDLs into ${IDL_DIR} ..."
for name in "${PROGRAMS[@]}"; do
  echo "  anchor idl build: ${name}"
  anchor idl build \
    -p "$name" \
    -o "${IDL_DIR}/${name}.json" \
    --out-ts "${TYPES_DIR}/${name}.ts"
done

echo ""
echo "IDL artifacts:"
ls -la "${IDL_DIR}/"*.json
