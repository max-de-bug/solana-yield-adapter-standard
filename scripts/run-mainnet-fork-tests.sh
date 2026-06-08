#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
echo "Delegating to TypeScript fork runner..."
cd "${PROJECT_DIR}/packages/sdk" && npx tsx run-fork.ts
