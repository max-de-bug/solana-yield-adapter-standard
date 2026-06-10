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

Expected: **17 tests pass** (5 adapter deposit→withdraw flows, 5 dispatcher/registry tests, etc.).

## 2. Mainnet-fork tests (8 min)

Requires `solana-test-validator` with cloned mainnet protocol accounts and fixture token ATAs:

```bash
# Start validator (one-time setup)
solana-test-validator \
  --reset --ledger test-ledger --url mainnet-beta --quiet \
  --clone KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD \
  --clone MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA \
  --clone PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu \
  --clone dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH \
  --clone EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
  --clone AvZZF1YaZDziPY2RCK4oJrRVrbN3mTD9NL24hPeaZeUj \
  --clone ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL \
  --account 7pyXgHEbAxkPNTZaaAEc21UGyoLKME5a3mMvxpseHeHz tests/fixtures/fork-usdc-ata.json \
  --account GLnPMjfFemGFhhMnKwpDEt9F56pvBgmTqyug3xQPQTHE tests/fixtures/fork-syrup-usdc-ata.json

# Deploy all programs
for kp in target/deploy/*-keypair.json; do
  solana -u http://127.0.0.1:8899 program deploy \
    --program-id $kp \
    --upgrade-authority ~/.config/solana/id.json \
    target/deploy/$(basename $kp -keypair.json).so
done
```

Then run:

```bash
MAINNET_FORK=1 ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=~/.config/solana/id.json \
  npx ts-mocha -p ./tsconfig.json -t 1000000 'tests/**/*.test.ts'
```

Expected: **31 tests pass**, including real CPI round-trips against cloned Kamino K-Lend, MarginFi v2, Jupiter Perps JLP, Drift IF v2, and Maple syrupUSDC.

## 3. Verify devnet deployment

```bash
solana program show CeyDkRgegNUz2TeFfFjRdL89G9EGGDymiqHoJkeFGcZ4 --url devnet
solana program show 7oUKys5XKMzD2NmFCZyLDyTF2Hm1VH3qX8jVfZEY4f3r --url devnet
```

Registry and dispatcher are live. 3 adapters (Jupiter, Maple, Drift) pending deployment (need ~8 SOL to deploy all).

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
| `programs/yield-dispatcher/src/adapter_cpi.rs` | Dispatcher CPI into adapters |
| `tests/adapters/` | Integration test per adapter |
| `packages/sdk/` | TypeScript SDK |
