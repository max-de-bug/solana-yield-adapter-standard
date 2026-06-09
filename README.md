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
│  │  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌───────┐ ┌──────────────┐ ││
│  │  │ Kamino  │ │ MarginFi │ │ Jupiter  │ │ Maple │ │    Drift     │ ││
│  │  │  USDC   │ │   USDC   │ │   LP     │ │ Syrup │ │ Insurance    │ ││
│  │  └─────────┘ └──────────┘ └──────────┘ └───────┘ └──────────────┘ ││
│  └─────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────┘
```

### Components

| Component | Description |
|---|---|
| **Yield Adapter Trait** | Shared crate defining the standard interface, types, events, and errors |
| **Yield Dispatcher** | Router that validates adapters and tracks user positions |
| **Adapter Registry** | Governance-gated on-chain registry for adapter approval |
| **Reference Adapters** | Five production-grade adapter implementations |

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
yarn install

# Build all programs (.so in target/deploy/)
# Requires Agave 3.1.x platform-tools for SBF: agave-install init 3.1.10
npm run build
```

### Test

```bash
# Run unit tests (local validator, legacy mode)
npm test

# Run mainnet-fork integration tests
npm run test:fork
```

See [SUBMISSION.md](SUBMISSION.md) and [docs/REFERENCE_IMPLEMENTATION.md](docs/REFERENCE_IMPLEMENTATION.md) for bounty submission notes (reference adapters, program IDs).

### Deploy to Devnet

```bash
./scripts/deploy-devnet.sh
```

---

## Reference Adapters

| Adapter | Protocol | Underlying | Model | Status |
|---|---|---|---|---|
| **Kamino USDC** | [Kamino Finance](https://kamino.finance) | USDC | Share-based reference vault | 🔶 Reference |
| **MarginFi USDC** | [MarginFi](https://marginfi.com) | USDC | Share-based reference vault | 🔶 Reference |
| **Jupiter LP** | [Jupiter](https://jup.ag) | USDC | Share-based reference vault | 🔶 Reference |
| **Maple Syrup** | [Maple Finance](https://maple.finance) | syrupUSDC | Share vault on syrupUSDC (yield-bearing SPL) | 🔶 Reference |
| **Drift Insurance** | [Drift Protocol](https://drift.trade) | USDC | IF staking (13d cooldown) | 🔶 Reference |

> **Note**: Maple and Drift adapters are reference implementations demonstrating correct interface compliance. Maple has no native Solana program — the adapter holds real syrupUSDC (a yield-bearing SPL token). Drift's protocol status may affect live CPI availability.

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
│   └── adapter-drift/           # Drift Insurance Fund adapter
├── tests/
│   ├── helpers/                 # Shared test utilities
│   ├── registry.test.ts         # Registry governance tests
│   └── dispatcher.test.ts       # Dispatcher routing tests
├── scripts/
│   ├── run-mainnet-fork-tests.sh
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

### Unit Tests

```bash
anchor test
```

Tests cover:
- **Registry**: Initialize → Propose → Approve → Revoke → Transfer governance
- **Dispatcher**: Initialize → Deposit → Withdraw → Current value → Error cases
- **Adapters**: Deposit → Verify shares → Withdraw → Verify balances

### Mainnet-Fork Tests

```bash
./scripts/run-mainnet-fork-tests.sh
```

Clones live program state from mainnet (Kamino, MarginFi, Drift) and runs integration tests against real on-chain state.

---

## Deployment

### Devnet

```bash
./scripts/deploy-devnet.sh
```

The script will:
1. Generate program keypairs (if needed)
2. Build all programs
3. Deploy registry and dispatcher to devnet
4. Verify deployment
5. Output the program IDs to update in `Anchor.toml`

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

## Security Model

| Layer | Protection |
|---|---|
| **Adapter Registry** | Governance-gated approval prevents malicious adapters |
| **Dispatcher Validation** | All CPI routes are validated against the registry |
| **PDA Authority** | Vault funds are controlled by program-derived addresses |
| **Checked Arithmetic** | All math uses `checked_*` operations to prevent overflows |
| **Event Auditability** | All operations emit standardized events for monitoring |
| **Emergency Pause** | Dispatcher can be paused by governance in emergencies |

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
