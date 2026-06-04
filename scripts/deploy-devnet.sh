#!/usr/bin/env bash
# Deploy registry, dispatcher, and all reference adapters to Solana devnet.
# Uses keypairs in target/deploy/ (synced with Anchor.toml via anchor keys sync).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DEPLOY_DIR="${PROJECT_DIR}/target/deploy"

echo "============================================"
echo "  Deploying to Solana Devnet"
echo "============================================"

solana config set --url devnet
echo "  Cluster: $(solana config get | grep 'RPC URL')"

BALANCE=$(solana balance 2>/dev/null | awk '{print $1}' || echo "0")
echo "  Balance: ${BALANCE} SOL"

if awk "BEGIN {exit !(${BALANCE:-0} < 8)}"; then
  echo "  Requesting airdrop..."
  solana airdrop 2 || solana airdrop 2 || true
fi

cd "$PROJECT_DIR"
chmod +x scripts/build-sbf.sh scripts/build-idls.sh
bash scripts/build-sbf.sh
bash scripts/build-idls.sh

deploy_program() {
  local name=$1
  local keypair="${DEPLOY_DIR}/${name}-keypair.json"
  local so="${DEPLOY_DIR}/${name}.so"
  if [ ! -f "$keypair" ] || [ ! -f "$so" ]; then
    echo "  SKIP ${name}: missing ${keypair} or ${so}"
    return 0
  fi
  echo "  Deploying ${name} -> $(solana-keygen pubkey "$keypair")"
  solana program deploy "$so" --program-id "$keypair" --url devnet
}

echo ""
echo "Deploying programs..."
deploy_program "adapter_registry"
deploy_program "yield_dispatcher"
deploy_program "adapter_kamino"
deploy_program "adapter_marginfi"
deploy_program "adapter_jupiter"
deploy_program "adapter_maple"
deploy_program "adapter_drift"

REGISTRY_ID=$(solana-keygen pubkey "${DEPLOY_DIR}/adapter_registry-keypair.json")
DISPATCHER_ID=$(solana-keygen pubkey "${DEPLOY_DIR}/yield_dispatcher-keypair.json")

echo ""
echo "============================================"
echo "  Deployment complete"
echo "  Registry:   ${REGISTRY_ID}"
echo "  Dispatcher: ${DISPATCHER_ID}"
echo ""
echo "  Update SUBMISSION.md devnet section if IDs differ."
echo "============================================"
