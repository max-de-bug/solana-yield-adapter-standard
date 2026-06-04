# Reference Implementation Scope

This repository is a **reference implementation** of the Solana Yield Adapter Standard—not a production integration with Kamino, MarginFi, Jupiter, Maple, or Drift.

## What is implemented

| Layer | Behavior |
|-------|----------|
| **Standard** | Three instructions: `deposit`, `withdraw`, `current_value` |
| **Trait crate** | Shared events, errors, share math, `define_adapter_position!` macro |
| **Adapters** | Share-based SPL vault PDAs per protocol name |
| **Dispatcher** | Registry-gated CPI into approved adapters |
| **Registry** | Propose → approve → revoke governance |
| **Tests** | Local (16) + mainnet-fork (20) integration suites |

## What is not implemented

- **Live protocol CPI** into yield programs (funds stay in adapter vault token accounts).
- **Maple on Solana** — Maple is EVM-primary; the Maple adapter uses simulated APY accrual in vault NAV.
- **Drift IF staking** — Cooldown is enforced in adapter `AdapterPosition` state, not via Drift program instructions.

## Fork tests

Fork tests validate:

1. The **standard interface** (deposit → current_value → withdraw).
2. **Cloned mainnet program accounts** where applicable (Kamino, MarginFi, Jupiter Perps, Drift).
3. **USDC** transfers using a fork fixture ATA.

They do **not** assert that position values match live mainnet positions in those protocols.

## Production adapters

Teams shipping production adapters should:

1. Implement the same three-instruction surface and events.
2. Replace local vault logic with **real protocol CPI** (Step 4 in the build guide).
3. Register via the on-chain registry after audit.

See the [Mintlify docs](https://your-docs-url.mintlify.app/guides/reference-implementation) (update URL after deploy) for the full developer site.
