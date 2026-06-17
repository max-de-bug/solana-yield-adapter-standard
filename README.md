<h1 align="center">
  <code>Solana Yield Adapter Standard</code>
</h1>
<p align="center">
  A standardized <code>deposit</code>, <code>withdraw</code>, and <code>current_value</code> interface for Solana yield protocols.
</p>



<div align="center">

![Solana](https://img.shields.io/badge/Solana-2.2.20-9945FF?style=for-the-badge&logo=solana)
![Anchor](https://img.shields.io/badge/Anchor-1.0.1-blue?style=for-the-badge)
![Rust](https://img.shields.io/badge/Rust-2021-orange?style=for-the-badge&logo=rust)
![License](https://img.shields.io/badge/License-Apache_2.0-green?style=for-the-badge)
![Tests](https://img.shields.io/badge/Tests-Mainnet_Fork-brightgreen?style=for-the-badge)

[Adapter Standard](docs/ADAPTER_STANDARD.md) · [Build Your Own](docs/BUILD_YOUR_OWN_ADAPTER.md) · [Documentation](https://syas.mintlify.app)

</div>

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Quick Start](#quick-start)
4. [Reference Adapters](#reference-adapters)
5. [Project Structure](#project-structure)
6. [Testing](#testing)
7. [Deployment](#deployment)
8. [Adapter Standard Specification](#adapter-standard-specification)
9. [Build Your Own Adapter](#build-your-own-adapter)
10. [Security Model](#security-model)
11. [Contributing](#contributing)
12. [License](#license)

---

## Overview

The **Solana Yield Adapter Standard** defines a minimal, composable interface for interacting with yield-bearing protocols on Solana. Think of it as an **ERC-4626 for Solana** — a universal adapter layer that lets wallets, aggregators, and dApps interact with any yield source through three simple instructions:

| Instruction | Description |
|---|---|
| **`deposit(amount)`** | Deposit underlying tokens into the yield source |
| **`withdraw(amount)`** | Withdraw underlying tokens from the yield source |
| **`current_value()`** | Query the current value of a position |

### Why?

Every DeFi protocol on Solana has its own unique interface. This means:
- Aggregators must write custom integration code for each protocol
- Wallets can't display yield positions in a standardized way
- New protocols face adoption friction due to integration overhead

The Yield Adapter Standard solves this by providing a **single interface** that all yield protocols can implement.

---

## Architecture

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                    Solana Yield Adapter Standard                        │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                     Core Dispatcher Program                          ││
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────┐                      ││
│  │  │ deposit() │  │withdraw()│  │current_value()│                      ││
│  │  └─────┬─────┘  └─────┬────┘  └──────┬───────┘                      ││
│  │        └──────────────┴───────────────┘                              ││
│  │                    │  Validates & Routes                              ││
│  └────────────────────┼────────────────────────────────────────────────┘│
│                       │                                                  │
│  ┌────────────────────▼────────────────────────────────────────────────┐│
│  │                    Adapter Registry (Governance-Gated)               ││
│  │  propose_adapter() → approve_adapter() → revoke_adapter()           ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                       │                                                  │
│  ┌────────────────────▼────────────────────────────────────────────────┐│
│  │                     Reference Adapters                               ││
 │  │  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌───────┐ ┌──────────────┐ ┌──────────┐ ││
 │  │  │ Kamino  │ │ MarginFi │ │ Jupiter  │ │ Maple │ │    Drift     │ │Template │ ││
 │  │  │  USDC   │ │   USDC   │ │   LP     │ │ Syrup │ │ Insurance    │ │Scaffold │ ││
 │  │  └─────────┘ └──────────┘ └──────────┘ └───────┘ └──────────────┘ └──────────┘ ││
│  └─────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────┘
```

### Components

| Component | Description |
|---|---|---|
| **Yield Adapter Trait** | Shared crate defining the standard interface, types, events, math, and account macros |
| **Yield Dispatcher** | Router that validates adapters and tracks user positions |
| **Adapter Registry** | Governance-gated on-chain registry with guardian role for adapter approval/revocation |
| **Reference Adapters** | Five reference adapters + template scaffold |

---

## Quick Start

### Prerequisites

- [Rust](https://rustup.rs/) (1.75+)
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools) (2.2.20+)
- [Anchor CLI](https://www.anchor-lang.com/docs/installation) (1.0.1)
- [Node.js](https://nodejs.org/) (18+)

### Build

```bash
# Clone the repository
git clone https://github.com/your-org/solana-yield-adapter-standard.git
cd solana-yield-adapter-standard

# Install toolchain (Solana 2.2.20 + Anchor 1.0.1)
./scripts/install-toolchain.sh

# Install dependencies
npm install

# Build all programs (.so in target/deploy/)
# Requires Agave 3.1.x platform-tools for SBF: agave-install init 3.1.10
npm run build
```

### Test

```bash
# Run localnet integration tests
npm test

# Run mainnet-fork integration tests via Surfpool
bash scripts/run-fork-surfpool.sh
```

### Deploy to Devnet

```bash
./scripts/deploy-devnet.sh
```

---

## Reference Adapters

| Adapter | Protocol | Underlying | Model | CPI Round-trip | Status |
|---|---|---|---|---|---|---|
| **Kamino USDC** | [Kamino Finance](https://kamino.finance) | USDC | Share-based lending vault | ✅ Real CPI | 🔶 Reference |
| **MarginFi USDC** | [MarginFi](https://marginfi.com) | USDC | Share-based lending vault | ✅ Real CPI | 🔶 Reference |
| **Jupiter LP** | [Jupiter](https://jup.ag) | USDC | Share-based LP vault | ✅ Real CPI | 🔶 Reference |
| **Maple Syrup** | [Maple Finance](https://maple.finance) | syrupUSDC | Swap-and-hold via Orca Whirlpool + Chainlink | ✅ Real Orca CPI | 🔶 Reference |
| **Drift Insurance** | [Drift Protocol](https://drift.trade) | USDC | Two-phase spot market deposit (IF staking blocked upstream) | ✅ Real Drift CPI | 🔶 Reference |

> **Maple**: Uses Orca Whirlpool to swap USDC ↔ syrupUSDC at deposit/withdraw time, and Chainlink oracle for `current_value`. This is a genuine mainnet-fork CPI round-trip — syrupUSDC has no native Solana program, so the adapter acquires it via a DEX swap.
>
> **Drift**: Performs a real CPI round-trip into Drift's spot market (deposit/withdraw). The ideal yield source (Insurance Fund staking) is blocked upstream — those instructions are commented out of Drift's deployed `#[program]`. We document this transparently and provide a probe script at `scripts/probe-drift-if.sh`. The two-phase (cooldown) withdrawal lifecycle is fully tested.

---

## Project Structure

```
solana-yield-adapter-standard/
├── crates/
│   └── yield-adapter-trait/     # Core interface definitions (shared crate)
├── programs/
│   ├── yield-dispatcher/        # Router with standardized interface
│   ├── adapter-registry/        # Governance-gated adapter registry
│   ├── adapter-kamino/          # Kamino USDC adapter
│   ├── adapter-marginfi/        # MarginFi USDC adapter
│   ├── adapter-jupiter/         # Jupiter LP adapter
│   ├── adapter-maple/           # Maple Syrup adapter
│   ├── adapter-drift/           # Drift Insurance Fund adapter
│   └── adapter-template/        # Scaffold for new adapters
├── tests/
│   ├── helpers/                 # Shared test utilities
│   ├── registry.test.ts         # Registry governance tests
│   └── dispatcher.test.ts       # Dispatcher routing tests
├── scripts/
│   ├── run-fork-surfpool.sh        # Surfpool-based fork tests (default)
│   ├── run-mainnet-fork-tests.sh   # Legacy fork tests (manual --clone)
│   └── deploy-devnet.sh
├── docs/
│   ├── ADAPTER_STANDARD.md      # Formal specification
│   └── BUILD_YOUR_OWN_ADAPTER.md # Developer guide
├── docs-site/                   # Mintlify documentation site
├── Anchor.toml
├── Cargo.toml
└── README.md
```

---

## Testing

### Test Suites

| Suite | Command | Count |
|-------|---------|-------|
| Unit | `cargo test` | 28 |
| Localnet integration | `anchor test` | 32 (26 passing, 6 pre-existing slippage failures on localnet-only) |
| Mainnet-fork integration (Surfpool) | `bash scripts/run-fork-surfpool.sh` | **96** — 6 adapters (×12) + dispatcher (11) + registry (13) |

Tests cover:
- **Registry**: Initialize → Propose → Approve → Revoke → Set guardian → Transfer governance
- **Dispatcher**: Initialize → Deposit → Withdraw → Current value → Pause → Error cases  
- **Adapters**: Deposit → Verify shares → Withdraw → Verify balances (CPI round-trip on fork)

### Mainnet-Fork Tests

Uses [Surfpool](https://surfpool.run) for JIT account fetching — no manual `--clone` flags or fixture ATAs needed:

```bash
# Prerequisites
curl -sL https://run.surfpool.run/ | bash
export MAINNET_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY

# Run
bash scripts/run-fork-surfpool.sh
```

The script builds programs, starts a Surfpool validator (auto-fetches mainnet accounts on demand), deploys all programs, and runs:

```bash
MAINNET_FORK=1 anchor test --skip-local-validator --skip-build
```

Runs all **96 integration tests** (6 adapters × 12 + dispatcher + registry) including real CPI round-trips against all five protocols (Kamino, MarginFi, Jupiter, Drift, Maple) via `invoke_signed`, plus dispatcher routing, registry governance (with `force_transfer_governance` admin escape hatch for Surfpool persistence), and adapter template tests. All 96 pass on fork (the 6 slippage-test failures are localnet-only — on fork the JIT-fetched USDC ATAs resolve the mint mismatch).

---

## Deployment

### Devnet

```bash
./scripts/deploy-devnet.sh
```

The script will:
1. Build all programs via `scripts/build-sbf.sh` + `scripts/build-idls.sh`
2. Deploy all 7 programs (registry, dispatcher, and all 5 adapters) to devnet
3. Output the deployed program IDs

> **Note:** Keypair files must exist in `target/deploy/` (committed to the repo for localnet, separate keypairs for devnet). The script uses existing keypairs and does not generate new ones.

### Mainnet

For mainnet deployment, use the same flow with `--provider.cluster mainnet-beta` and ensure proper key management and multisig governance.

---

## Adapter Standard Specification

See [docs/ADAPTER_STANDARD.md](docs/ADAPTER_STANDARD.md) for the full specification.

### TL;DR — Three Instructions

Every compliant adapter MUST implement:

```rust
// 1. Deposit underlying tokens, receive receipt tokens
fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()>;

// 2. Burn receipt tokens, receive underlying tokens
fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()>;

// 3. Query current value of position
fn current_value(ctx: Context<CurrentValue>) -> Result<()>;
```

Every adapter MUST emit standardized events: `DepositEvent`, `WithdrawEvent`, `CurrentValueEvent`.

---

## Build Your Own Adapter

See [docs/BUILD_YOUR_OWN_ADAPTER.md](docs/BUILD_YOUR_OWN_ADAPTER.md) for a step-by-step guide.

**Target: Ship a working adapter in less than a day.**

```bash
# 1. Scaffold
anchor init my-adapter && cd my-adapter

# 2. Add the trait dependency
# In Cargo.toml: yield-adapter-trait = { git = "..." }

# 3. Implement three instructions: deposit, withdraw, current_value

# 4. Register with the on-chain registry
# Call propose_adapter() → wait for governance approval
```

---

## Devnet Deployments

### Programs

| Program | Devnet Program ID |
|---------|------------------|
| Adapter Registry | [`3DQGCPAjHcoT7uf9MJDM5ZTL7GEvTKU3MXFzzrHvqSWt`](https://explorer.solana.com/address/3DQGCPAjHcoT7uf9MJDM5ZTL7GEvTKU3MXFzzrHvqSWt?cluster=devnet) |
| Yield Dispatcher | [`HUGWpAwFyeWrnH7f9pfWX93puZdC2ud4MYZQT8FtEBvH`](https://explorer.solana.com/address/HUGWpAwFyeWrnH7f9pfWX93puZdC2ud4MYZQT8FtEBvH?cluster=devnet) |
| Adapter Kamino | [`AjvTbsYhcEehGTSx7yvF4qSiQLWyfeqe3PRhHVyZB3Xe`](https://explorer.solana.com/address/AjvTbsYhcEehGTSx7yvF4qSiQLWyfeqe3PRhHVyZB3Xe?cluster=devnet) |
| Adapter MarginFi | [`5yQiba9TNit1FJx3KqXY5nJM3zuQTreqBFWfeGohBqat`](https://explorer.solana.com/address/5yQiba9TNit1FJx3KqXY5nJM3zuQTreqBFWfeGohBqat?cluster=devnet) |
| Adapter Jupiter | [`AwpaZYbeNe3vD17JuGMjsv73b3JuqM3eEoqEVnQk9NMo`](https://explorer.solana.com/address/AwpaZYbeNe3vD17JuGMjsv73b3JuqM3eEoqEVnQk9NMo?cluster=devnet) |
| Adapter Maple | [`GohmCi1aDJAfSg4Sp4rELDwku8ptUs8qafF5aju6p5gz`](https://explorer.solana.com/address/GohmCi1aDJAfSg4Sp4rELDwku8ptUs8qafF5aju6p5gz?cluster=devnet) |
| Adapter Drift | [`4FyuKY2HeXemKoDYoPo1J2xPoeY29YJj7tF7PJLjhS91`](https://explorer.solana.com/address/4FyuKY2HeXemKoDYoPo1J2xPoeY29YJj7tF7PJLjhS91?cluster=devnet) |
| Adapter Template | [`jbLUHXvc9P26MpQdGXht4aKnbn68i2GijxsFX6RXahV`](https://explorer.solana.com/address/jbLUHXvc9P26MpQdGXht4aKnbn68i2GijxsFX6RXahV?cluster=devnet) |

---

## Security Model

| Layer | Protection |
|-------|------------|
| **Adapter Registry** | Governance-gated approval with optional guardian role prevents malicious adapters from being routed through the dispatcher. Only `Approved` entries pass the CPI gate. |
| **Dispatcher Validation** | Every CPI call validates that the target adapter has `status == Approved` in the registry and verifies vault PDA seeds match registered values. |
| **PDA Authority** | All vault funds are controlled by program-derived addresses. No human key has direct custody over deposited tokens. |
| **Checked Arithmetic** | Share calculations use `checked_*` operations and fall back to u256 arithmetic to prevent overflow, underflow, or precision loss. |
| **Event Auditability** | Every deposit, withdraw, and value query emits standardized events (`DepositEvent`, `WithdrawEvent`, `CurrentValueEvent`) for off-chain monitoring and indexing. |
| **Emergency Pause** | Governance can pause the dispatcher at any time, blocking all deposits and withdrawals until unpaused. |
| **Admin Escape Hatch** | Registry includes a dev-only `force_transfer_governance` instruction gated by a hardcoded admin key for resetting stale governor on persistent forks (Surfpool). Defaults to `Pubkey::default()` in production builds. |

---

## Related Projects

- [syas-quasar](https://github.com/max-de-bug/syas-quasar) — Quasar port with framework benchmark comparisons

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-adapter`)
3. Implement your changes following the adapter standard
4. Add tests for all new functionality
5. Run `cargo fmt && cargo clippy --workspace`
6. Submit a pull request

---

## License

This project is licensed under the Apache License 2.0 — see the [LICENSE](LICENSE) file for details.

---

<div align="center">

**Built for the Solana ecosystem 🌊**

[Documentation](https://syas.mintlify.app) · [Adapter Standard](docs/ADAPTER_STANDARD.md) · [Report Issue](https://github.com/max-de-bug/solana-yield-adapter-standard/issues)

</div>
