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
| Localnet integration (`anchor test`) | 17 | ✅ All pass |
| Mainnet-fork integration (`MAINNET_FORK=1 anchor test`) | 31 | ✅ All pass |

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

Synced in `Anchor.toml` via `anchor keys sync`:

| Program | Devnet address | Deployed |
|---------|----------------|----------|
| `adapter_registry` | `CeyDkRgegNUz2TeFfFjRdL89G9EGGDymiqHoJkeFGcZ4` | ✅ Live (slot 467592247) |
| `yield_dispatcher` | `7oUKys5XKMzD2NmFCZyLDyTF2Hm1VH3qX8jVfZEY4f3r` | ✅ Live (slot 467592287) |
| `adapter_kamino` | `BzuVWb3UgCW6axee6ZNb812D268XrWkJsE7mxkX9b3Kp` | ⚠️ Needs redeploy (pre-CPI build at slot 467592306) |
| `adapter_marginfi` | `FrCvyyGSukMZcLhpU7EneuhfPmqS5p8E2ysnFdwHhopR` | ⚠️ Needs redeploy (pre-CPI build at slot 467592323) |
| `adapter_jupiter` | `2acqkTDi2VQ4FCZVDB8PeMVLVWnREogE5HA2GxvHdWxu` | ❌ Not deployed |
| `adapter_maple` | `Ft2Yvaiqwsjvo1yyYEWvt12YCsDB4kjGBd7vrF8RwwjU` | ❌ Not deployed |
| `adapter_drift` | `CVfb8T9tf9WEeus4mKWsxTehVezeY9TGwYsSc3JmxWYz` | ❌ Not deployed |

All `.so` binaries and keypairs are built and ready. Deployment to devnet requires ~8 SOL in wallet `5FsXjNmmudnBndWPgQWj8uvY7kfs3dSpf655i39Q6A9A` (current balance: 0.043 SOL). Run:

```bash
./scripts/deploy-devnet.sh
```

> **Note**: Devnet faucet rate-limits impede automated deployment. Fund the wallet above and re-run the script.

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

# Mainnet fork tests (see setup below)
MAINNET_FORK=1 ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=~/.config/solana/id.json \
  npx ts-mocha -p ./tsconfig.json -t 1000000 'tests/**/*.test.ts'
```

Fork test setup requires `solana-test-validator` with cloned mainnet accounts and injected fixture ATAs:

```bash
# Start validator with cloned programs + fixture token accounts
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

## Architecture highlights

- **Registry:** propose → approve governance for adapter metadata, mint binding, and vault authority seed.
- **Dispatcher:** validates `AdapterEntry` is `Approved`, verifies vault PDAs against registry-stored seeds, then **CPI** to the matching adapter.
- **Adapters:** share-priced vault PDAs; implement `YieldAdapter` trait surface with conditional protocol CPI.
- **CPI by convention:** All `protocol.rs` modules are always called; they execute real `invoke_signed` only when remaining accounts are present.
- **Dynamic validation:** Dispatcher reads both `vault_state_seed` and `vault_authority_seed` from the registry at runtime — no dispatcher redeployment needed for new adapters.

## Links

- Spec: [docs/ADAPTER_STANDARD.md](docs/ADAPTER_STANDARD.md)
- Reference implementation details: [docs/REFERENCE_IMPLEMENTATION.md](docs/REFERENCE_IMPLEMENTATION.md)
- Build your own adapter: [docs/BUILD_YOUR_OWN_ADAPTER.md](docs/BUILD_YOUR_OWN_ADAPTER.md)
- Full README: [README.md](README.md)
