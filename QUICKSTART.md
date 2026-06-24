# Quickstart — Evaluator Runbook

Everything you need to verify this submission. Total time: ~20 min.

## Prerequisites

```bash
# Toolchain (Anchor 1.0.1, Solana 2.2.20)
bash scripts/install-toolchain.sh

# JS dependencies
npm install
```

## 1. Localnet integration tests (5 min)

```bash
npm test
```

Runs `anchor test` with a local validator. Spins up all 7 programs, runs the full TypeScript suite.

Expected: **32 tests pass** (26 pass, 6 pre-existing slippage failures on localnet).

## 2. Mainnet-fork tests via Surfpool (8 min)

Uses [Surfpool](https://surfpool.run) for JIT account fetching — no manual `--clone` flags or fixture ATAs needed:

```bash
# Prerequisites (one-time)
curl -sL https://run.surfpool.run/ | bash
export MAINNET_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY

# Run
npm run test:fork
```

Expected: **112/112 executable pass** (124 registered, 12 skipped), including real CPI round-trips against cloned Kamino K-Lend, MarginFi v2, Jupiter Perps JLP, and Maple syrupUSDC (Drift IF v2 CPI skipped upstream — see `Docs/troubleshooting/drift-fork-issues.md`), plus dispatcher routing and full registry governance lifecycle.

The Surfpool approach replaces the legacy `solana-test-validator` + manual `--clone` method. Key improvements:

- **No fixture ATAs** — accounts are JIT-fetched on demand
- **State persistence** — Surfpool preserves accounts across restarts; the registry's `force_transfer_governance` instruction handles stale governance
- **All 112 executable tests pass** (previously 81) — includes adapter-template, dispatcher `current_value` CPI, and registry re-approval lifecycle

## 3. Verify devnet deployment

```bash
solana program show 8TAhAne1z4chGzuP9EeXFuYsqyGHzACWuD7sURS3ydAq --url devnet
solana program show 8u4YFQiTCR5n5dijVoinXyZ962ngVmFuWKELDUjVCqAR --url devnet
```

All 7 programs (registry, dispatcher, 5 adapters, template) are deployed to devnet. See [README.md](README.md#devnet-deployments) for current program IDs.

## Architecture at a glance

```
┌─────────────┐    propose/approve    ┌──────────────┐
│  Registry    │◄────────────────────►│  Dispatcher   │
│ (governance) │                      │ (router)      │
└─────────────┘                      └──────┬───────┘
                                            │ CPI
              ┌─────────────────────────────┼─────────────────────┐
              ▼                             ▼                     ▼
      ┌──────────────┐           ┌──────────────────┐    ┌──────────────┐
      │ Kamino       │           │ MarginFi v2      │    │ Jupiter LP   │
      │ K-Lend CPI   │           │ lending_account   │    │ add/remove   │
      │ deposit/     │           │ deposit/withdraw  │    │ liquidity    │
      │ withdraw_res.│           │ CPI              │    │ CPI          │
      └──────────────┘           └──────────────────┘    └──────────────┘
      ┌──────────────┐           ┌──────────────────┐
      │ Drift IF v2  │           │ Maple syrupUSDC  │
      │ spot_deposit │           │ (SPL yield token  │
      │ /withdraw    │           │  — no CPI needed) │
      └──────────────┘           └──────────────────┘
```

## Key design decisions

| Feature | What we do | Why it matters |
|---------|-----------|----------------|
| **Conditional CPI** | Single `.so`; CPI executes only when remaining accounts are present | Same binary on localnet and fork — no branching, no separate test builds |
| **Slippage protection** | `min_shares_out` / `min_underlying_out` checked after calculation | Prevents withdrawal/deposit frontrunning |
| **Two-step governance** | `nominate_governance` → `accept_governance` | Can't lose governance to a mistyped address |
| **Circuit breaker** | Authority-only `toggle_pause` on dispatcher | Emergency pause of all deposits/withdrawals |
| **Dynamic validation** | Dispatcher reads `vault_state_seed` and `vault_authority_seed` from registry at runtime | New adapters need zero dispatcher changes |
| **VaultStatus 4-state** | Active → DepositsPaused → Paused → Deprecated | Fine-grained access control per vault |

## Files of interest

| File | What it is |
|------|-----------|
| `SUBMISSION.md` | Full submission details |
| `docs/ADAPTER_STANDARD.md` | Normative spec |
| `docs/BUILD_YOUR_OWN_ADAPTER.md` | Build guide |
| `docs-site/` | Mintlify documentation site |
| `programs/adapter-*/src/protocol.rs` | Per-adapter real CPI (conditional) |
| `programs/adapter-template/` | Scaffold for building new adapters |
| `programs/yield-dispatcher/src/adapter_cpi.rs` | Dispatcher CPI into adapters |
| `tests/adapters/` | Integration test per adapter |
| `packages/sdk/` | TypeScript SDK |
