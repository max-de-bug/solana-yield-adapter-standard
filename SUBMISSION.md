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

## Reference / mock positioning

**This is a reference implementation**, not production integrations:

- Adapters implement the **standard trait** (`deposit`, `withdraw`, `current_value`) using **local share-based vaults** and SPL token transfers.
- **No on-chain CPI** into Kamino, MarginFi, Jupiter Perps, Maple, or Drift live programs.
- Mainnet program IDs in code/docs are for **fork visibility tests** and metadata only.
- Maple and Drift adapters are **illustrative** (bounty-listed protocols with simplified vault logic). Maple holds real syrupUSDC but makes no CPI to any Maple Solana program (none exists).

See [docs/REFERENCE_IMPLEMENTATION.md](docs/REFERENCE_IMPLEMENTATION.md) for details.

## Program IDs (localnet / devnet keypairs)

Synced in `Anchor.toml` via `anchor keys sync`:

| Program | Address |
|---------|---------|
| `adapter_registry` | `CeyDkRgegNUz2TeFfFjRdL89G9EGGDymiqHoJkeFGcZ4` |
| `yield_dispatcher` | `7oUKys5XKMzD2NmFCZyLDyTF2Hm1VH3qX8jVfZEY4f3r` |
| `adapter_kamino` | `BzuVWb3UgCW6axee6ZNb812D268XrWkJsE7mxkX9b3Kp` |
| `adapter_marginfi` | `FrCvyyGSukMZcLhpU7EneuhfPmqS5p8E2ysnFdwHhopR` |
| `adapter_jupiter` | `2acqkTDi2VQ4FCZVDB8PeMVLVWnREogE5HA2GxvHdWxu` |
| `adapter_maple` | `Ft2Yvaiqwsjvo1yyYEWvt12YCsDB4kjGBd7vrF8RwwjU` |
| `adapter_drift` | `CVfb8T9tf9WEeus4mKWsxTehVezeY9TGwYsSc3JmxWYz` |

Deploy all programs: `./scripts/deploy-devnet.sh` (uses `target/deploy/*` keypairs).

## Devnet (deployed)

| Program | Devnet address | Explorer |
|---------|----------------|----------|
| `adapter_registry` | `CeyDkRgegNUz2TeFfFjRdL89G9EGGDymiqHoJkeFGcZ4` | [view](https://explorer.solana.com/address/CeyDkRgegNUz2TeFfFjRdL89G9EGGDymiqHoJkeFGcZ4?cluster=devnet) |
| `yield_dispatcher` | `7oUKys5XKMzD2NmFCZyLDyTF2Hm1VH3qX8jVfZEY4f3r` | Deploy with `./scripts/deploy-devnet.sh` (~2.6 SOL; program ID fixed in `target/deploy/`) |

**Registry is live on devnet.** Dispatcher and adapters use the same keypairs in `target/deploy/`; fund the wallet and run `./scripts/deploy-devnet.sh` to finish.

After deploy, initialize registry and dispatcher from your wallet (see `tests/registry.test.ts` / `tests/dispatcher.test.ts` account layout).

## Test commands

```bash
# Install JS deps
npm install

# Build all programs (.so + IDL)
npm run build

# Local validator tests (all programs + TS suite)
npm test
# equivalent: anchor test --validator legacy --skip-build

# Mainnet fork tests (requires cloned programs + USDC fixture)
npm run test:fork
# equivalent: ./scripts/run-mainnet-fork-tests.sh
```

Fork setup (first time):

```bash
./scripts/setup-fork-usdc-fixture.sh
MAINNET_FORK=1 ./scripts/run-mainnet-fork-tests.sh
```

## Architecture highlights

- **Registry:** propose → approve governance for adapter metadata and mint binding.
- **Dispatcher:** validates `AdapterEntry` is `Approved`, then **CPI** to the matching reference adapter.
- **Adapters:** share-priced vault PDAs; implement `YieldAdapter` trait surface.

## Links

- Spec: [docs/ADAPTER_STANDARD.md](docs/ADAPTER_STANDARD.md)
- Build your own adapter: [docs/BUILD_YOUR_OWN_ADAPTER.md](docs/BUILD_YOUR_OWN_ADAPTER.md)
- Full README: [README.md](README.md)
