#!/usr/bin/env bash
# =============================================================================
# run-mainnet-fork-tests.sh — Legacy mainnet-fork test runner
#
# Starts solana-test-validator with cloned mainnet programs/accounts, deploys
# local programs, and runs the full integration test suite.
#
# For the Surfpool path, use: bash scripts/run-fork-surfpool.sh
# =============================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "============================================"
echo "  Solana Yield Adapter Standard"
echo "  Mainnet-Fork Tests (Legacy validator)"
echo "============================================"
echo ""
echo "Delegating to TypeScript fork runner..."
cd "${PROJECT_DIR}/packages/sdk" && npx tsx run-fork.ts