#!/usr/bin/env bash
# =============================================================================
# run-fork-surfpool.sh — Run mainnet-fork tests via Surfpool
#
# Surfpool starts a mainnet-forked validator with JIT account fetching. This
# script orchestrates: prepare fixtures → build programs → surfpool start →
# deploy → run anchor test (skip-validator, since surfpool IS the validator).
#
# Prerequisites:
#   1. Install Surfpool: curl -sL https://run.surfpool.run/ | bash
#   2. Set MAINNET_RPC_URL to a mainnet RPC endpoint (Helius, Triton, etc.)
#
# Usage:
#   export MAINNET_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
#   bash scripts/run-fork-surfpool.sh
# =============================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
FIXTURE_DIR="${PROJECT_DIR}/tests/fixtures"
VALIDATOR_URL="http://127.0.0.1:8899"

# Load MAINNET_RPC_URL from .env if not already set (CLI/env takes precedence)
if [ -z "${MAINNET_RPC_URL:-}" ] && [ -f "${PROJECT_DIR}/.env" ]; then
  set -a
  source "${PROJECT_DIR}/.env"
  set +a
fi

if [ -z "${MAINNET_RPC_URL:-}" ]; then
  echo "ERROR: MAINNET_RPC_URL is not set."
  echo ""
  echo "  Set it in your shell:"
  echo "    export MAINNET_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY"
  echo ""
  echo "  Or create a ${PROJECT_DIR}/.env file (gitignored):"
  echo "    cp .env.example .env"
  echo "    # then edit .env with your key"
  echo ""
  exit 1
fi

if ! command -v surfpool &>/dev/null; then
  echo "ERROR: surfpool not found. Install: curl -sL https://run.surfpool.run/ | bash"
  exit 1
fi

echo "============================================"
echo "  Solana Yield Adapter Standard"
echo "  Mainnet-Fork Tests via Surfpool"
echo "============================================"

# ── Step 0: Clean up any prior surfpool or stale test-ledger ──
surfpool stop 2>/dev/null || true
sleep 1
rm -rf "${PROJECT_DIR}/test-ledger" 2>/dev/null || true

# ── Step 1: Generate fork fixture ATA accounts ──
echo ""
echo "[1/6] Preparing fork fixtures..."
bash "$SCRIPT_DIR/setup-fork-usdc-fixture.sh"
bash "$SCRIPT_DIR/setup-fork-syrup-usdc-fixture.sh"

# ── Step 2: Build programs ──
echo ""
echo "[2/6] Building programs..."
bash "$SCRIPT_DIR/build-sbf.sh"
bash "$SCRIPT_DIR/build-idls.sh"

# ── Step 3: Start Surfpool validator ──
echo ""
echo "[3/6] Starting Surfpool validator..."
SURFPOOL_ARGS=(
  --rpc-url "$MAINNET_RPC_URL"
  --no-tui
  --no-deploy
  --legacy-anchor-compatibility
  --ci
  --daemon
)

SNAPSHOT_FILE="${FIXTURE_DIR}/surfpool-snapshot.json"
if [ -f "$SNAPSHOT_FILE" ]; then
  SURFPOOL_ARGS+=(--snapshot "$SNAPSHOT_FILE")
  echo "  Using snapshot: $SNAPSHOT_FILE"
fi

surfpool start "${SURFPOOL_ARGS[@]}" 2>&1 | tail -5

echo "  Waiting for validator (up to 180s)..."
for i in $(seq 1 90); do
  if solana cluster-version -u "$VALIDATOR_URL" &>/dev/null; then
    echo "  Validator ready."
    break
  fi
  sleep 2
done
if ! solana cluster-version -u "$VALIDATOR_URL" &>/dev/null; then
  echo "ERROR: Validator failed to start within 180s"
  surfpool stop 2>/dev/null || true
  exit 1
fi

# ── Step 4.5: Inject fork fixture ATA accounts into Surfpool ──
# The fixture JSON files are generated in step 1 but Surfpool doesn't
# auto-create them. We inject them via surfnet_setAccount so tests that
# require real USDC (protocol CPI verification, current_value accuracy,
# multi-user, vault lifecycle) can find the fixture ATA.
echo ""
echo "[4.5] Injecting fork fixture ATA accounts..."
for fixture in "$FIXTURE_DIR"/fork-*-ata.json; do
  [ -f "$fixture" ] || continue
  fname=$(basename "$fixture")
  echo "  Injecting $fname..."
  node -e "
    const fs = require('fs');
    const f = JSON.parse(fs.readFileSync('${fixture}', 'utf8'));
    const hex = Buffer.from(f.account.data[0], 'base64').toString('hex');
    const http = require('http');
    const body = JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'surfnet_setAccount',
      params: [f.pubkey, { lamports: f.account.lamports, owner: f.account.owner, executable: false, rentEpoch: 1844674407370955300, data: hex }]
    });
    const req = http.request({ hostname: '127.0.0.1', port: 8899, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      let d = ''; res.on('data', (c) => d += c); res.on('end', () => { const j = JSON.parse(d); if (j.error) { console.error('  ERROR:', j.error); process.exit(1); } });
    });
    req.on('error', (e) => { console.error('  ERROR:', e.message); process.exit(1); });
    req.write(body); req.end();
  " || exit 1
done
echo "  Fixture injection complete."

# ── Step 5: Pre-warm JIT cache ──
# Force fetch critical protocol programs/accounts so tests don't time out
# waiting for Surfpool's first-touch JIT fetching.
echo ""
echo "[5/7] Pre-warming JIT cache..."
PROTOCOL_ACCOUNTS=(
  "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"   # Kamino K-Lend
  "MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA"    # MarginFi v2
  "PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu"    # Jupiter Perps
  "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH"    # Drift v2
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"   # Orca Whirlpool
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"   # USDC Mint
  "AvZZF1YaZDziPY2RCK4oJrRVrbN3mTD9NL24hPeaZeUj"   # syrupUSDC Mint
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"   # ATA Program
  "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF"   # Kamino Lending Market
  "d4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q"    # Kamino USDC Reserve
  "G18jKKXQwBbrHeiK3C9MRXhkHsLHf7XgCSisykV46EZa"   # Jupiter USDC Custody
  "6fteKNvMdv7tYmBoJHhj1jx6rHcEwC6RdSEmVpyS613J"   # SYRUP-USDC Whirlpool
  "CpNyiFt84q66665Kx64bobxZuMgZ2EecrhAJs1HikS2T"   # syrupUSDC Chainlink Feed
  "HEvSKofvBgfaexv23kMabbYqxasxU3mQ4ibBMEmJWHny"   # Chainlink Owner / Store
)
for addr in "${PROTOCOL_ACCOUNTS[@]}"; do
  echo "    Warming: $addr"
  curl -s -X POST "$VALIDATOR_URL" \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getAccountInfo\",\"params\":[\"$addr\",{\"encoding\":\"base64\"}]}" \
    -o /dev/null &
  # Limit concurrency to avoid overwhelming the Surfpool JIT engine
  if ((${#PROTOCOL_ACCOUNTS[@]} > 0)); then
    sleep 0.2
  fi
done
wait
echo "    Pre-warm complete."

# ── Step 6: Deploy programs ──
echo ""
echo "[6/7] Deploying programs..."
for so in "$PROJECT_DIR/target/deploy"/*.so; do
  base=$(basename "$so" .so)
  keypair="$PROJECT_DIR/target/deploy/${base}-keypair.json"
  if [ -f "$keypair" ]; then
    echo "  Deploying $base..."
    solana program deploy "$so" \
      --program-id "$keypair" \
      -u "$VALIDATOR_URL" \
      --commitment confirmed
  else
    echo "  SKIP $base: missing keypair"
  fi
done

# ── Step 7: Run fork tests ──
echo ""
echo "[7/7] Running fork tests..."
export MAINNET_FORK=1
export ANCHOR_PROVIDER_URL="$VALIDATOR_URL"
export ANCHOR_WALLET="$HOME/.config/solana/id.json"
yarn run ts-mocha -p ./tsconfig.json -t 1000000 'tests/**/*.test.ts'
EXIT_CODE="$?"

echo ""
if [ "$EXIT_CODE" -eq 0 ]; then
  echo "============================================"
  echo "  All mainnet-fork tests passed!"
  echo "============================================"
else
  echo "============================================"
  echo "  Fork tests FAILED (exit code $EXIT_CODE)"
  echo "============================================"
fi

surfpool stop 2>/dev/null || true
exit "$EXIT_CODE"