#!/usr/bin/env bash
# ============================================================================
# Mainnet-Fork Test Runner for the Solana Yield Adapter Standard
#
# Starts solana-test-validator with cloned mainnet programs/accounts, deploys
# local programs, and runs the full integration test suite (all five adapters).
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
FIXTURE_DIR="${PROJECT_DIR}/tests/fixtures"
FIXTURE_ATA="${FIXTURE_DIR}/fork-usdc-ata.json"
FIXTURE_SYRUP_ATA="${FIXTURE_DIR}/fork-syrup-usdc-ata.json"

echo "============================================"
echo "  Solana Yield Adapter Standard"
echo "  Mainnet-Fork Integration Tests"
echo "============================================"

KAMINO_PROGRAM="KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"
MARGINFI_PROGRAM="MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA"
JUPITER_PERP_PROGRAM="PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu"
DRIFT_PROGRAM="dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH"
ATA_PROGRAM="ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
USDC_MINT="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
SYRUP_USDC_MINT="AvZZF1YaZDziPY2RCK4oJrRVrbN3mTD9NL24hPeaZeUj"

VALIDATOR_DIR="${PROJECT_DIR}/test-ledger"

cleanup() {
    echo "Cleaning up test validator..."
    if [ -f "${VALIDATOR_DIR}/validator.pid" ]; then
        kill "$(cat "${VALIDATOR_DIR}/validator.pid")" 2>/dev/null || true
    fi
    pkill -f "solana-test-validator" 2>/dev/null || true
    sleep 2
}

trap cleanup EXIT

cleanup

echo "[0/5] Preparing fork fixtures..."
bash "${SCRIPT_DIR}/setup-fork-usdc-fixture.sh"
bash "${SCRIPT_DIR}/setup-fork-syrup-usdc-fixture.sh"

echo "[1/5] Building Anchor programs and IDLs..."
cd "$PROJECT_DIR"
chmod +x scripts/build-sbf.sh scripts/build-idls.sh
bash scripts/build-sbf.sh
bash scripts/build-idls.sh

echo "[2/5] Starting mainnet-fork test validator..."
mkdir -p "$VALIDATOR_DIR"

VALIDATOR_ARGS=(
    --reset
    --ledger "$VALIDATOR_DIR"
    --url mainnet-beta
    --quiet
    --clone "$KAMINO_PROGRAM"
    --clone "$MARGINFI_PROGRAM"
    --clone "$JUPITER_PERP_PROGRAM"
    --clone "$DRIFT_PROGRAM"
    --clone "$USDC_MINT"
    --clone "$SYRUP_USDC_MINT"
    --clone "$ATA_PROGRAM"
)

if [ -f "$FIXTURE_ATA" ]; then
    FIXTURE_ADDR=$(python3 -c "import json; print(json.load(open('${FIXTURE_ATA}'))['pubkey'])")
    VALIDATOR_ARGS+=(--account "$FIXTURE_ADDR" "$FIXTURE_ATA")
fi
if [ -f "$FIXTURE_SYRUP_ATA" ]; then
    SYRUP_ADDR=$(python3 -c "import json; print(json.load(open('${FIXTURE_SYRUP_ATA}'))['pubkey'])")
    VALIDATOR_ARGS+=(--account "$SYRUP_ADDR" "$FIXTURE_SYRUP_ATA")
fi

solana-test-validator "${VALIDATOR_ARGS[@]}" &

VALIDATOR_PID=$!
echo "$VALIDATOR_PID" > "${VALIDATOR_DIR}/validator.pid"
echo "  Validator PID: $VALIDATOR_PID"

echo "  Waiting for validator..."
MAX_RETRIES=60
RETRY=0
while ! solana cluster-version -u http://localhost:8899 &>/dev/null; do
    sleep 1
    RETRY=$((RETRY + 1))
    if [ "$RETRY" -ge "$MAX_RETRIES" ]; then
        echo "ERROR: Validator failed to start within ${MAX_RETRIES}s"
        exit 1
    fi
done
echo "  Validator ready."

echo "[3/5] Deploying programs to fork..."
for so in "${PROJECT_DIR}"/target/deploy/*.so; do
    base=$(basename "$so" .so)
    keypair="${PROJECT_DIR}/target/deploy/${base}-keypair.json"
    if [ -f "$keypair" ]; then
        solana program deploy "$so" --program-id "$keypair" -u http://127.0.0.1:8899
    fi
done

echo "[4/5] Running mainnet-fork tests..."
export MAINNET_FORK=1
anchor test --skip-local-validator --skip-build --validator legacy --provider.cluster localnet

echo ""
echo "============================================"
echo "  All mainnet-fork tests passed!"
echo "============================================"
