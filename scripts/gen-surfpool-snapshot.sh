#!/usr/bin/env bash
# =============================================================================
# gen-surfpool-snapshot.sh — Generate a Surfpool snapshot file from current
# Surfpool validator state.
#
# After deploying programs and warming the JIT cache, this captures the current
# Surfpool state so subsequent runs can skip JIT fetching for those accounts.
#
# Usage (after surfpool start):
#   bash scripts/gen-surfpool-snapshot.sh
# =============================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
FIXTURE_DIR="${PROJECT_DIR}/tests/fixtures"
SNAPSHOT_FILE="${FIXTURE_DIR}/surfpool-snapshot.json"
VALIDATOR_URL="http://127.0.0.1:8899"

if ! command -v surfpool &>/dev/null; then
  echo "ERROR: surfpool not found."
  exit 1
fi

echo "Generating Surfpool snapshot..."
echo "  Validator: $VALIDATOR_URL"
echo "  Output:    $SNAPSHOT_FILE"

mkdir -p "$FIXTURE_DIR"

surfpool snapshot "$SNAPSHOT_FILE" --url "$VALIDATOR_URL"

echo ""
echo "Snapshot saved to $SNAPSHOT_FILE"
echo "Include in run-fork-surfpool.sh by placing it in tests/fixtures/"
echo "Surfpool auto-loads it on startup for faster initialization."