# Solana Yield Adapter Standard — Core Trait Definitions

Shared types, events, error codes, and math helpers for building compliant yield adapter programs on Solana.

Part of the [Solana Yield Adapter Standard](https://github.com/max-de-bug/solana-yield-adapter-standard).

## Usage

```toml
[dependencies]
yield-adapter-trait = "1.0.0"
```

## What's included

- **`VaultStatus`** — enum with `Active`, `DepositsPaused`, `Paused`, `Deprecated`
- **`AdapterMetadata`** — on-chain metadata PDA layout
- **`define_adapter_position!()`** — macro to emit the canonical `AdapterPosition` struct
- **`DepositEvent`**, **`WithdrawEvent`**, **`CurrentValueEvent`** — standard events
- **`YieldAdapterError`** — shared error codes (range 6000+)
- **Math helpers** — exact u256 arithmetic for share calculations (`mul_div_u64`, `shares_for_deposit`, `user_position_underlying_value`, etc.)
- **Account readers** — Borsh-based helpers to read vault totals and position data without Anchor IDL

## Adapter requirements

Every compliant adapter program must expose exactly three instructions:

1. **`deposit`** — Transfer underlying tokens into the yield source, receive receipt tokens
2. **`withdraw`** — Burn receipt tokens, receive underlying tokens back
3. **`current_value`** — Query the current value (in underlying units) of a position

## License

Apache-2.0
