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
| Unit (`cargo test`) | 27 | ✅ All pass |
| Localnet integration (`anchor test`) | 17 | ✅ All pass |
| Mainnet-fork integration (`MAINNET_FORK=1 anchor test`) | 21 | ✅ All pass |

`cargo clippy --workspace` — zero warnings.

## Real protocol CPI

Four of the five adapters (Kamino, MarginFi, Jupiter Perps, Drift) implement **real on-chain CPI** via `invoke_signed` into cloned mainnet programs. All four are fork-verified end-to-end (deposit → current_value → withdraw with actual protocol program instructions).

The CPI is **conditional**: when remaining accounts are absent (localnet), the functions skip the CPI and update only local bookkeeping. This allows the same compiled `.so` to work on both localnet and fork without branching.

| Adapter | CPI target | Discriminator |
|---------|-----------|---------------|
| **Kamino K-Lend** | `deposit_reserve_liquidity` / `withdraw_reserve_liquidity` | SHA256("global:...") verified |
| **MarginFi v2** | `lending_account_deposit` / `lending_account_withdraw` | SHA256("global:...") verified |
| **Jupiter Perps JLP** | `add_liquidity` / `remove_liquidity` | SHA256("global:...") verified |
| **Drift IF v2** | `spot_deposit` / `spot_withdraw` | Non-Anchor; empirically verified on fork |
| **Maple syrupUSDC** | No CPI (yield-bearing SPL token) | — |

The dispatcher also performs real CPI into adapters (fork-verified). A critical bug was fixed: `vault_token_account` and `vault_authority` were swapped in `cpi_deposit` account ordering (root cause of prior `AccountNotInitialized` errors).

## Key design decision: conditional CPI

CPI functions are always called by handlers but execute only when sufficient remaining accounts are provided. This eliminates the need for `if isMainnetFork()` branching in Rust — the test harness either provides or omits the protocol accounts.

See [docs/REFERENCE_IMPLEMENTATION.md](docs/REFERENCE_IMPLEMENTATION.md) for the full technical breakdown.

## Program IDs (devnet)

Synced in `Anchor.toml` via `anchor keys sync`:

| Program | Devnet address | Deployed |
|---------|----------------|----------|
| `adapter_registry` | `CeyDkRgegNUz2TeFfFjRdL89G9EGGDymiqHoJkeFGcZ4` | ✅ Live |
| `yield_dispatcher` | `7oUKys5XKMzD2NmFCZyLDyTF2Hm1VH3qX8jVfZEY4f3r` | ✅ Live |
| `adapter_kamino` | `BzuVWb3UgCW6axee6ZNb812D268XrWkJsE7mxkX9b3Kp` | ⚠️ Needs redeploy (outdated build) |
| `adapter_marginfi` | `FrCvyyGSukMZcLhpU7EneuhfPmqS5p8E2ysnFdwHhopR` | ⚠️ Needs redeploy (outdated build) |
| `adapter_jupiter` | `2acqkTDi2VQ4FCZVDB8PeMVLVWnREogE5HA2GxvHdWxu` | ❌ Not deployed |
| `adapter_maple` | `Ft2Yvaiqwsjvo1yyYEWvt12YCsDB4kjGBd7vrF8RwwjU` | ❌ Not deployed |
| `adapter_drift` | `CVfb8T9tf9WEeus4mKWsxTehVezeY9TGwYsSc3JmxWYz` | ❌ Not deployed |

Deploy all programs: `./scripts/deploy-devnet.sh` (requires ~8 SOL in wallet).

## Devnet deployment

**Registry and dispatcher are live on devnet** at the addresses above, both owned by authority `5FsXjNmmudnBndWPgQWj8uvY7kfs3dSpf655i39Q6A9A`.

Kamino and MarginFi adapters were deployed in an earlier session but contain **pre-CPI code** and need redeployment. Jupiter, Maple, and Drift have never been deployed.

To finish devnet deployment, fund the wallet and run:

```bash
./scripts/deploy-devnet.sh
```

Then initialize registry and dispatcher from your wallet (see `tests/registry.test.ts` / `tests/dispatcher.test.ts` account layout).

## Test commands

```bash
# Install JS deps
npm install

# Build all programs (.so + IDL)
npm run build

# Local validator tests (all programs + TS suite)
npm test

# Mainnet fork tests (requires cloned programs + USDC fixture)
npm run test:fork
```

Fork setup (first time):

```bash
./scripts/setup-fork-usdc-fixture.sh
MAINNET_FORK=1 ./scripts/run-mainnet-fork-tests.sh
```

## Architecture highlights

- **Registry:** propose → approve governance for adapter metadata and mint binding.
- **Dispatcher:** validates `AdapterEntry` is `Approved`, then **CPI** to the matching adapter.
- **Adapters:** share-priced vault PDAs; implement `YieldAdapter` trait surface with conditional protocol CPI.
- **CPI by convention:** All `protocol.rs` modules are always called; they execute real `invoke_signed` only when remaining accounts are present.

## Links

- Spec: [docs/ADAPTER_STANDARD.md](docs/ADAPTER_STANDARD.md)
- Reference implementation details: [docs/REFERENCE_IMPLEMENTATION.md](docs/REFERENCE_IMPLEMENTATION.md)
- Build your own adapter: [docs/BUILD_YOUR_OWN_ADAPTER.md](docs/BUILD_YOUR_OWN_ADAPTER.md)
- Full README: [README.md](README.md)
