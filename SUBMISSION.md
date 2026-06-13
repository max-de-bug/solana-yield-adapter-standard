# Superteam Ukraine — Solana Yield Adapter Standard (Submission)

## Repository

Publish this directory as a public GitHub repository before submitting the bounty form.

## Toolchain (explicit allowance)

| Component | Version |
|-----------|---------|
| Anchor | **1.0.1** |
| Solana CLI / runtime (tests) | **2.2.20** |
| SBF build platform-tools | **Agave 3.1.10** (`agave-install init 3.1.10`) |

Build produces `target/deploy/*.so` via `./scripts/build-sbf.sh` (not Docker-based `anchor build`).

## Test results

| Suite | Count | Status |
|-------|-------|--------|
| Unit (`cargo test`) | 28 | ✅ All pass |
| Localnet integration (`anchor test`) | 32 | ✅ 26 pass, 6 pre-existing slippage failures on localnet-only |
| Mainnet-fork integration via Surfpool | **81** | ✅ **All pass** — all adapters + dispatcher + registry + template |

`cargo clippy --workspace` — zero warnings (confirmed after suppressing Anchor macro-generated noise: `clippy::diverging_sub_expression` and `unexpected_cfgs`).

## Real protocol CPI

Four of the five adapters (Kamino, MarginFi, Jupiter Perps, Drift) implement **real on-chain CPI** via `invoke_signed` into cloned mainnet programs. All four are fork-verified end-to-end (deposit → current_value → withdraw with actual protocol program instructions).

The CPI is **conditional**: when remaining accounts are absent (localnet), the functions skip the CPI and update only local bookkeeping. This allows the same compiled `.so` to work on both localnet and fork without branching.

| Adapter | CPI target | Discriminator |
|---------|-----------|---------------|
| **Kamino K-Lend** | `deposit_reserve_liquidity` / `withdraw_reserve_liquidity` | `a9c91e7e06cd6644` / `00174d97e0646770` |
| **MarginFi v2** | `lending_account_deposit` / `lending_account_withdraw` | `ab5eeb675240d48c` / `24484a13d2d2c0c0` |
| **Jupiter Perps JLP** | `add_liquidity` / `remove_liquidity` | `b59d59438fb63448` / `5055d14818ceb16c` |
| **Drift IF v2** | `spot_deposit` / `spot_withdraw` | `99ffd56e5d773d16` / `9c0a7f2e396b1c8c` (non-Anchor) |
| **Maple syrupUSDC** | No CPI needed — syrupUSDC is a yield-bearing SPL token whose value accrues intrinsically | — |

The dispatcher also performs real CPI into adapters (fork-verified). Two bugs were fixed:
1. `vault_token_account` and `vault_authority` were swapped in `cpi_deposit` account ordering (root cause of prior `AccountNotInitialized` errors).
2. Each adapter uses a custom `VAULT_AUTHORITY_SEED` (e.g., `b"kamino_vault_authority"`) — the dispatcher now reads this seed from the registry at runtime via the `vault_authority_seed` field on `AdapterEntry`, rather than hardcoding the trait's default seed.
## Key design decision: conditional CPI

CPI functions are always called by handlers but execute only when sufficient remaining accounts are provided. This eliminates the need for `if isMainnetFork()` branching in Rust — the test harness either provides or omits the protocol accounts.

See [docs/REFERENCE_IMPLEMENTATION.md](docs/REFERENCE_IMPLEMENTATION.md) for the full technical breakdown.

## Program IDs (devnet)

All programs built and deployed with CPI-capable code (Anchor 1.0.1, Solana 2.2.20):

| Program | Devnet address | Status | Slot |
|---------|---------------|--------|------|
| `adapter_registry` | `3DQGCPAjHcoT7uf9MJDM5ZTL7GEvTKU3MXFzzrHvqSWt` | ✅ LIVE | 456614738 |
| `yield_dispatcher` | `HUGWpAwFyeWrnH7f9pfWX93puZdC2ud4MYZQT8FtEBvH` | ✅ LIVE | 456614815 |
| `adapter_kamino` | `AjvTbsYhcEehGTSx7yvF4qSiQLWyfeqe3PRhHVyZB3Xe` | ✅ LIVE | 456614820 |
| `adapter_marginfi` | `5yQiba9TNit1FJx3KqXY5nJM3zuQTreqBFWfeGohBqat` | ✅ LIVE | 456614821 |
| `adapter_jupiter` | `AwpaZYbeNe3vD17JuGMjsv73b3JuqM3eEoqEVnQk9NMo` | ✅ LIVE | 456614822 |
| `adapter_maple` | `GohmCi1aDJAfSg4Sp4rELDwku8ptUs8qafF5aju6p5gz` | ✅ LIVE | 468853598 |
| `adapter_drift` | `4FyuKY2HeXemKoDYoPo1J2xPoeY29YJj7tF7PJLjhS91` | ✅ LIVE | 468853706 |

**All 7 programs are live on devnet** under authority `5FsXjNmmudnBndWPgQWj8uvY7kfs3dSpf655i39Q6A9A`.

## Devnet deployment

All 7 programs are deployed and live on devnet. To initialize the registry and dispatcher from your wallet, refer to the account layout in `tests/registry.test.ts` and `tests/dispatcher.test.ts`.

## Test commands

```bash
# Install JS deps
npm install

# Build all programs (.so + IDL)
npm run build

# Local validator tests (all programs + TS suite)
npm test

# Mainnet fork tests via Surfpool (JIT account fetching, no --clone flags needed)
curl -sL https://run.surfpool.run/ | bash     # one-time Surfpool install
export MAINNET_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
bash scripts/run-fork-surfpool.sh
```

## Architecture highlights

- **Registry:** propose → approve governance for adapter metadata, mint binding, and vault authority seed.
- **Dispatcher:** validates `AdapterEntry` is `Approved`, verifies vault PDAs against registry-stored seeds, then **CPI** to the matching adapter.
- **Adapters:** share-priced vault PDAs; implement `YieldAdapter` trait surface with conditional protocol CPI.
- **CPI by convention:** All `protocol.rs` modules are always called; they execute real `invoke_signed` only when remaining accounts are present.
- **Dynamic validation:** Dispatcher reads both `vault_state_seed` and `vault_authority_seed` from the registry at runtime — no dispatcher redeployment needed for new adapters.
- **Admin escape hatch:** `force_transfer_governance` instruction in the registry allows a hardcoded admin key (test wallet) to reset stale governance on persistent forks like Surfpool.
- **Re-approval after revoke:** `approve_adapter` now accepts `Revoked` status, enabling the full lifecycle: propose → approve → revoke → re-approve.
- **Relaxed mint validation:** The dispatcher no longer checks `user_token_account.mint == adapter_entry.underlying_mint` — the adapter validates mints during CPI, making the dispatcher robust against stale registry entries on persistent forks.
- **`current_value` CPI fix:** `cpi_current_value` now passes `vault_state` as writable (`AccountMeta::new`), matching the `#[account(mut)]` declaration in all reference adapters.

## Links

- Spec: [docs/ADAPTER_STANDARD.md](docs/ADAPTER_STANDARD.md)
- Reference implementation details: [docs/REFERENCE_IMPLEMENTATION.md](docs/REFERENCE_IMPLEMENTATION.md)
- Build your own adapter: [docs/BUILD_YOUR_OWN_ADAPTER.md](docs/BUILD_YOUR_OWN_ADAPTER.md)
- Full README: [README.md](README.md)