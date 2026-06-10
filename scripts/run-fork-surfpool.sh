#!/usr/bin/env bash
# =============================================================================
# run-fork-surfpool.sh — Run mainnet-fork tests via Surfpool
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

if [ -z "${MAINNET_RPC_URL:-}" ]; then
  echo "ERROR: MAINNET_RPC_URL is not set."
  echo "Usage: MAINNET_RPC_URL=<url> $0"
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

# 1. Build programs
echo ""
echo "[1/4] Building programs..."
bash "$SCRIPT_DIR/build-sbf.sh"
bash "$SCRIPT_DIR/build-idls.sh"

# 2. Start Surfpool (mainnet fork with JIT account fetching)
echo ""
echo "[2/4] Starting Surfpool validator..."
surfpool start \
  --rpc-url "$MAINNET_RPC_URL" \
  --no-tui \
  --no-deploy \
  --legacy-anchor-compatibility \
  --ci \
  --daemon 2>&1 | tail -5

echo "  Waiting for validator..."
for i in $(seq 1 30); do
  if solana cluster-version -u http://127.0.0.1:8899 &>/dev/null; then
    echo "  Validator ready."
    break
  fi
  sleep 2
done

# 3. Deploy programs (Surfpool auto-deploys from Anchor.toml, but deploy explicitly to use
#    our keypairs and ensure the same program IDs as localnet/devnet)
echo ""
echo "[3/4] Deploying programs..."
for so in "$PROJECT_DIR/target/deploy"/*.so; do
  base=$(basename "$so" .so)
  keypair="$PROJECT_DIR/target/deploy/${base}-keypair.json"
  if [ -f "$keypair" ]; then
    echo "  Deploying $base..."
    solana program deploy "$so" \
      --program-id "$keypair" \
      -u http://127.0.0.1:8899
  else
    echo "  SKIP $base: missing keypair"
  fi
done

# 4. Run fork tests
echo ""
echo "[4/4] Running fork tests..."
MAINNET_FORK=1 anchor test \
  --skip-local-validator \
  --skip-build \
  --validator legacy \
  --provider.cluster localnet

echo ""
echo "============================================"
echo "  All mainnet-fork tests passed!"
echo "============================================"

# Cleanup is automatic with --daemon mode; force-stop if still running
surfpool stop 2>/dev/null || true
