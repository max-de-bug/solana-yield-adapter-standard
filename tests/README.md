# Mainnet-Fork Testing with Surfpool

This directory contains all integration tests for the Solana Yield Adapter Standard.

## Test Suite Overview

| Suite | Command | Tests | Environment | Duration |
|---|---|---|---|---|
| Unit | `cargo test` | 28 | Native Rust | ~30s |
| Localnet | `npm test` | 32 (26 pass, 6 slippage-only) | `anchor test` | ~2 min |
| Mainnet fork | `npm run test:fork` | 112/112 executable | Surfpool validator | ~5–15 min |

## Running Mainnet-Fork Tests

### Prerequisites

Before running fork tests, you need:

1. **A mainnet RPC endpoint** — Surfpool fetches real mainnet accounts on demand. You need an RPC provider:
   - [Helius](https://www.helius.dev/) (free tier available) → `https://mainnet.helius-rpc.com/?api-key=YOUR_KEY`
   - [Triton](https://triton.one/) → your dedicated RPC URL
   - Any Solana RPC provider with mainnet access

2. **Surfpool CLI** — JIT account-fetching validator:
   ```bash
   curl -sL https://run.surfpool.run/ | bash
   ```

3. **Solana CLI** (2.2.20+) configured correctly:
   ```bash
   solana --version  # Should show 2.2.20
   ```

### Step-by-Step Instructions

#### 1. Create `.env` file (one-time)

```bash
cd /home/test01/projects/solana-yield-adapter-standard
cp .env.example .env
```

Edit `.env` and set your RPC URL:

```
MAINNET_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
```

The `.env` file is gitignored — your API key stays local.

#### 2. Build programs

```bash
npm run build
```

This compiles all 7 programs (registry, dispatcher, 5 adapters) to `.so` files under `target/deploy/`.

#### 3. Run fork tests

```bash
npm run test:fork
```

This executes `scripts/run-fork-surfpool.sh`, which:

1. Stops any prior Surfpool instance and cleans `test-ledger/`
2. Generates fork fixture ATA accounts (USDC, syrupUSDC)
3. Builds all programs (if `npm run build` was skipped)
4. Starts Surfpool validator with JIT account fetching (up to 180s wait)
5. Pre-warms the JIT cache with critical protocol program IDs and accounts
6. Deploys all programs to the fork validator
7. Runs `MAINNET_FORK=1 ts-mocha tests/**/*.test.ts`

**Expected result:** 112/112 tests passing (124 registered, 12 skipped on Drift).

### What Gets Tested on Fork

| Component | Tests | CPI Real? |
|---|---|---|
| Kamino adapter | 18 | ✅ Real `deposit_reserve_liquidity` |
| MarginFi adapter | 18 | ✅ Real `lending_account_deposit` |
| Jupiter adapter | 18 | ✅ Real `add_liquidity` |
| Maple adapter | 16 | ✅ Real Orca Whirlpool swap |
| Drift adapter | 7 | ⏭️ CPI skipped (upstream disabled) |
| Template adapter | 18 | ✅ No external CPI |
| Dispatcher | 11 | ✅ CPI routing + pause |
| Registry | 13 | ✅ Governance lifecycle |

### Troubleshooting

#### `surfpool: command not found`
Surfpool is not installed. Run:
```bash
curl -sL https://run.surfpool.run/ | bash
```

#### `MAINNET_RPC_URL is not set`
Create or fix your `.env` file:
```bash
cp .env.example .env
# Edit .env with your RPC key
```

#### Validator fails to start (timeout after 180s)
- Check your RPC URL is valid: `curl $MAINNET_RPC_URL`
- Try a different RPC provider
- Check port 8899 is not in use: `lsof -i :8899`
- Kill stale Surfpool: `surfpool stop`

#### Tests fail with "blockhash not found" or "Transaction expired"
Surfpool's 400ms slots can cause blockhash reuse. The script handles this with retry logic and sleep intervals. If persistent:
- Re-run the script: `npm run test:fork`
- Ensure your system clock is synchronized: `timedatectl status`

#### Specific adapter tests fail
Check `docs/fork-run.log` for the full transcript with on-chain values and slot numbers.