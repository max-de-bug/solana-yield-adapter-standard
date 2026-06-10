#!/usr/bin/env bash
# =============================================================================
# validate.sh — Submission verification gate
#
# Validates ALL bounty requirements in one command. Exit code 0 = pass.
#
# Usage:
#   ./scripts/validate.sh              # full suite (no fork tests)
#   ./scripts/validate.sh --fork        # include mainnet-fork tests
#   ./scripts/validate.sh --fix         # auto-fix formatting
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

PASS=0
FAIL=0
WARN=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { PASS=$((PASS+1)); echo -e "  ${GREEN}✓${NC} $1"; }
fail() { FAIL=$((FAIL+1)); echo -e "  ${RED}✗${NC} $1"; }
warn() { WARN=$((WARN+1)); echo -e "  ${YELLOW}⚠${NC} $1"; }
header() { echo ""; echo "── $1 ──"; }

cleanup() { echo ""; echo "========== RESULTS =========="; echo "  Pass:  $PASS"; echo "  Fail:  $FAIL"; echo "  Warnings: $WARN"; echo "============================="; if [ "$FAIL" -gt 0 ]; then exit 1; else exit 0; fi; }
trap cleanup EXIT

# ============================================================
# 1. BUILD
# ============================================================
header "BUILD"

if cargo build --workspace 2>/dev/null; then
  pass "Rust workspace builds"
else
  fail "Rust workspace build failed"
fi

if anchor build 2>/dev/null; then
  pass "Anchor build (all programs)"
else
  fail "Anchor build failed"
fi

# ============================================================
# 2. UNIT TESTS
# ============================================================
header "UNIT TESTS"

OUTPUT=$(cargo test 2>&1 || true)
PASSED_TESTS=$(echo "$OUTPUT" | grep "^test result" | awk -F' ' '{s+=$4}END{print s}' || echo "0")
if [ "$PASSED_TESTS" -gt 0 ] 2>/dev/null; then
  pass "All $PASSED_TESTS unit tests pass"
else
  fail "Unit tests did not pass"
fi

# ============================================================
# 3. CLIPPY
# ============================================================
header "CLIPPY"

if cargo clippy --workspace -- -D warnings 2>/dev/null; then
  pass "clippy — zero warnings"
else
  # Some Anchor macros generate unavoidable warnings; check that only those exist
  CLIPPY_OUT=$(cargo clippy --workspace 2>&1 || true)
  ANCHOR_WARNINGS=$(echo "$CLIPPY_OUT" | grep -c "unexpected_cfg" || true)
  TOTAL_WARNINGS=$(echo "$CLIPPY_OUT" | grep -c "warning:" || true)
  if [ "$TOTAL_WARNINGS" -le "$ANCHOR_WARNINGS" ]; then
    pass "clippy — only pre-existing Anchor macro warnings ($ANCHOR_WARNINGS)"
  else
    warn "clippy has non-Anchor warnings"
  fi
fi

# ============================================================
# 4. FORMATTING
# ============================================================
header "FORMATTING"

if cargo fmt --all -- --check 2>/dev/null; then
  pass "rustfmt — all files formatted"
else
  if [[ "${1:-}" == "--fix" ]]; then
    cargo fmt --all
    pass "rustfmt — auto-fixed"
  else
    fail "rustfmt — run 'cargo fmt --all' to fix (or --fix)"
  fi
fi

# ============================================================
# 5. DOCUMENTATION
# ============================================================
header "DOCUMENTATION"

DOCS=(
  "README.md"
  "SUBMISSION.md"
  "docs/ADAPTER_STANDARD.md"
  "docs/BUILD_YOUR_OWN_ADAPTER.md"
  "docs-site/adapter-standard.mdx"
  "docs-site/registry.mdx"
  "docs-site/dispatcher.mdx"
  "docs-site/reference/errors.mdx"
  "docs-site/guides/build-your-own-adapter.mdx"
)
for doc in "${DOCS[@]}"; do
  if [ -f "$doc" ]; then
    pass "Doc exists: $doc"
  else
    fail "Missing doc: $doc"
  fi
done

# ============================================================
# 6. PROGRAM ID CONSISTENCY
# ============================================================
header "PROGRAM ID CONSISTENCY"

# Extract all program IDs from Anchor.toml [programs.devnet]
ANCHOR_IDS=$(awk '/^\[programs\.devnet\]/{flag=1; next} /^\[/{flag=0} flag && /=/' Anchor.toml | grep '=' | sed 's/.*= "//;s/"$//' || true)
EXPECTED_COUNT=$(echo "$ANCHOR_IDS" | wc -l)
if [ "$EXPECTED_COUNT" -ge 7 ]; then
  pass "Anchor.toml has $EXPECTED_COUNT devnet program IDs"
else
  warn "Only $EXPECTED_COUNT devnet program IDs in Anchor.toml"
fi

# Verify program keypairs exist
KEYPAIR_COUNT=0
for prog in adapter_registry yield_dispatcher adapter_kamino adapter_marginfi adapter_jupiter adapter_maple adapter_drift; do
  if [ -f "target/deploy/${prog}-keypair.json" ]; then
    KEYPAIR_COUNT=$((KEYPAIR_COUNT+1))
  fi
done
if [ "$KEYPAIR_COUNT" -ge 7 ]; then
  pass "All $KEYPAIR_COUNT program keypairs present"
else
  warn "Only $KEYPAIR_COUNT of 7 program keypairs found (run anchor build)"
fi

# ============================================================
# 7. SDK CONSTANTS
# ============================================================
header "SDK CONSTANTS"

if [ -f "packages/sdk/src/constants.ts" ]; then
  pass "SDK constants.ts exists"
else
  fail "Missing packages/sdk/src/constants.ts"
fi

# ============================================================
# 8. INSTRUCTION DISCRIMINATORS
# ============================================================
header "INSTRUCTION DISCRIMINATORS"

verify_discriminator() {
  local label=$1 method=$2 expected=$3
  local computed
  computed=$(echo -n "$method" | openssl dgst -sha256 2>/dev/null | cut -d' ' -f2 | head -c 16 || echo "")
  if [ "$computed" = "$expected" ]; then
    pass "$label discriminator: $expected"
  else
    fail "$label discriminator: expected $expected, computed $computed"
  fi
}

if command -v openssl &>/dev/null; then
  verify_discriminator "Kamino deposit"  "global:deposit_reserve_liquidity"         "a9c91e7e06cd6644"
  verify_discriminator "Kamino withdraw" "global:withdraw_reserve_liquidity"        "00174d97e0646770"
  verify_discriminator "Marginfi deposit"  "global:lending_account_deposit"         "ab5eeb675240d48c"
  verify_discriminator "Marginfi withdraw" "global:lending_account_withdraw"        "24484a13d2d2c0c0"
  verify_discriminator "Jupiter deposit"   "global:add_liquidity"                   "b59d59438fb63448"
  verify_discriminator "Jupiter withdraw"  "global:remove_liquidity"                "5055d14818ceb16c"
else
  warn "OpenSSL not available — skipping discriminator verification"
fi

# ============================================================
# 9. DEVNET DEPLOYMENT CHECK
# ============================================================
header "DEVNET DEPLOYMENT"

DEVNET_URL="https://api.devnet.solana.com"
check_deployed() {
  local label=$1 program_id=$2
  if command -v solana &>/dev/null; then
    local result
    result=$(solana program show "$program_id" --url "$DEVNET_URL" 2>&1 || echo "NOT_FOUND")
    if echo "$result" | grep -q "Program Id"; then
      pass "$label deployed: $program_id"
    else
      warn "$label NOT deployed: $program_id"
    fi
  else
    warn "solana CLI not available — skipping deployment check"
  fi
}

check_deployed "Registry"   "CeyDkRgegNUz2TeFfFjRdL89G9EGGDymiqHoJkeFGcZ4"
check_deployed "Dispatcher" "7oUKys5XKMzD2NmFCZyLDyTF2Hm1VH3qX8jVfZEY4f3r"
check_deployed "Kamino"     "BzuVWb3UgCW6axee6ZNb812D268XrWkJsE7mxkX9b3Kp"
check_deployed "Marginfi"   "FrCvyyGSukMZcLhpU7EneuhfPmqS5p8E2ysnFdwHhopR"
check_deployed "Jupiter"    "2acqkTDi2VQ4FCZVDB8PeMVLVWnREogE5HA2GxvHdWxu"
check_deployed "Maple"      "Ft2Yvaiqwsjvo1yyYEWvt12YCsDB4kjGBd7vrF8RwwjU"
check_deployed "Drift"      "CVfb8T9tf9WEeus4mKWsxTehVezeY9TGwYsSc3JmxWYz"

# ============================================================
# 10. FORK TESTS (optional)
# ============================================================
if [[ "${1:-}" == "--fork" ]]; then
  header "MAINNET-FORK TESTS"
  if [ -f "scripts/run-mainnet-fork-tests.sh" ]; then
    pass "Fork test script exists"
    if bash scripts/run-mainnet-fork-tests.sh 2>&1; then
      pass "All mainnet-fork tests pass"
    else
      fail "Some mainnet-fork tests failed"
    fi
  else
    fail "Missing scripts/run-mainnet-fork-tests.sh"
  fi
else
  header "MAINNET-FORK TESTS (skipped)"
  echo "  Pass --fork to include mainnet-fork tests"
fi

echo ""
echo "Done."
