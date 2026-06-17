#!/usr/bin/env bash
# =============================================================================
# run-fork-tests.sh — Run all mainnet-fork tests sequentially via Surfpool
#
# Each test file runs with its own timeout so a single slow file doesn't
# cause the entire suite to be killed.  Results are aggregated at the end.
#
# Usage:
#   export MAINNET_RPC_URL=https://api.mainnet-beta.solana.com
#   bash scripts/run-fork-tests.sh
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
VALIDATOR_URL="${ANCHOR_PROVIDER_URL:-http://127.0.0.1:8899}"
PER_FILE_TIMEOUT=420000    # 7 min per file
TOTAL_EXIT=0
PASSED=()
FAILED=()

# Test files in dependency-respecting order (dispatcher depends on adapters)
TEST_FILES=(
  "tests/registry.test.ts"
  "tests/adapters/kamino.test.ts"
  "tests/adapters/marginfi.test.ts"
  "tests/adapters/jupiter.test.ts"
  "tests/adapters/drift.test.ts"
  "tests/adapters/maple.test.ts"
  "tests/adapters/template.test.ts"
  "tests/dispatcher.test.ts"
)

# ── helpers ──
pass() { PASSED+=("$1"); }
fail() { FAILED+=("$1"); TOTAL_EXIT=1; }

# ANSI colour codes
RST='\033[0m'; RD='\033[0;31m'; GN='\033[0;32m'; YL='\033[1;33m'; BL='\033[1;34m'

run_one() {
  local file="$1"
  local label
  label="$(basename "$file" .test.ts)"

  echo ""
  printf "${BL}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RST}\n"
  printf "${BL}  [%02d/%02d]  %-50s${RST}\n" "$CURRENT" "$TOTAL" "$label"
  printf "${BL}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RST}\n"

  set +e
  npx ts-mocha "$file" --timeout "$PER_FILE_TIMEOUT" --reporter min 2>&1
  local rc=$?
  set -e

  if [ $rc -eq 0 ]; then
    printf "${GN}  ✔  %s passed${RST}\n" "$label"
    pass "$label"
  else
    printf "${RD}  ✘  %s failed (exit %d)${RST}\n" "$label" "$rc"
    fail "$label"
    # Print full output for the failing file
    echo ""
    npx ts-mocha "$file" --timeout "$PER_FILE_TIMEOUT" --reporter spec 2>&1 || true
  fi
  echo ""
}

# ── main ──
CURRENT=0
TOTAL=${#TEST_FILES[@]}

printf "${YL}Surfpool-Fork Test Runner${RST}\n"
printf "  Validator: %s\n" "$VALIDATOR_URL"
printf "  Files:     %d\n" "$TOTAL"
printf "  Timeout:   %d s per file\n" $(( PER_FILE_TIMEOUT / 1000 ))
echo ""

# Ensure ANCHOR_WALLET is set for AnchorProvider.env()
export ANCHOR_WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}"

for file in "${TEST_FILES[@]}"; do
  CURRENT=$((CURRENT + 1))
  run_one "$PROJECT_DIR/$file"
done

# ── summary ──
echo "============================================"
printf "  Results:  ${GN}%d passed${RST}  ${RD}%d failed${RST}\n" \
  "${#PASSED[@]}" "${#FAILED[@]}"
echo "============================================"

if [ ${#PASSED[@]} -gt 0 ]; then
  for p in "${PASSED[@]}"; do printf "  ${GN}✔${RST}  %s\n" "$p"; done
fi
if [ ${#FAILED[@]} -gt 0 ]; then
  for f in "${FAILED[@]}"; do printf "  ${RD}✘${RST}  %s\n" "$f"; done
fi
echo ""

exit "$TOTAL_EXIT"
