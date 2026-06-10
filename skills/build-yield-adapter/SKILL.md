# Skill: Build a Solana Yield Adapter

Build a conforming yield adapter for any Solana protocol in one pass. After loading this skill, the agent knows the exact file layout, account structure, CPI pattern, and test harness.

## Context

This repository implements the **Solana Yield Adapter Standard** — a uniform `deposit` / `withdraw` / `current_value` interface for yield-bearing protocols. Adapters are standalone Anchor programs that wrap a protocol behind this interface. Reference adapters live in `programs/adapter-*/`.

## When to use

- You have a Solana protocol (lending market, LP, staking pool, RWA token) and want to integrate it
- You need to add a new yield source to a dispatcher-based aggregator
- You want to wrap a non-yield token (e.g., syrupUSDC) that accrues value intrinsically

## File layout to create

```
programs/adapter-<name>/
  Cargo.toml
  src/
    lib.rs          # declare_id!, #[program] with 5 instructions
    state.rs        # VaultState + seeds + AdapterPosition (via macro)
    instructions/
      mod.rs        # re-exports
      initialize.rs
      deposit.rs
      withdraw.rs
      current_value.rs
      toggle_status.rs
    protocol.rs     # conditional CPI module
```

## Interface contract

Every adapter must expose exactly these instructions:

| Instruction | Signature | Description |
|---|---|---|
| `initialize` | `(underlying_mint: Pubkey)` | Create vault state PDA |
| `deposit` | `(amount: u64, min_shares_out: u64)` | Deposit underlying, mint shares |
| `withdraw` | `(amount: u64, min_underlying_out: u64)` | Burn shares, return underlying |
| `current_value` | `()` | Query position value via return data |
| `toggle_status` | `()` | Cycle vault status (Active→DepositsPaused→Paused→Active) |

## Account prefix (all instructions)

```
user: Signer
vault_state: VaultState (PDA)
user_position: AdapterPosition (PDA, seeds=["adapter_position", user])
vault_authority: PDA (seeds=[VAULT_AUTHORITY_SEED])
vault_token_account: TokenAccount (owned by vault_authority)
token_program: Token
system_program: System (deposit/initialize only)
```

`remaining_accounts` conveys protocol-specific accounts to `protocol.rs`.

## State template (state.rs)

```rust
use anchor_lang::prelude::*;
use yield_adapter_trait::VaultStatus;

yield_adapter_trait::define_adapter_position!();

#[account]
#[derive(Debug, InitSpace)]
pub struct MyVaultState {
    pub authority: Pubkey,
    pub underlying_mint: Pubkey,
    pub total_underlying: u64,
    pub total_shares: u64,
    pub protocol_program_id: Pubkey,
    pub protocol_routed_underlying: u64,
    pub last_yield_sync_ts: i64,
    pub status: VaultStatus,
    pub bump: u8,
}

pub const VAULT_STATE_SEED: &[u8] = b"my_vault_state";
pub const VAULT_AUTHORITY_SEED: &[u8] = b"my_vault_authority";
```

## CPI pattern (protocol.rs)

Use **conditional CPI** — the same compiled .so works on localnet (no protocol accounts) and mainnet fork (real CPI):

```rust
use anchor_lang::solana_program::{program::invoke_signed, instruction::Instruction};

pub fn on_deposit(
    vault: &mut MyVaultState,
    vault_authority: &AccountInfo,
    vault_token_account: &AccountInfo,
    token_program: &AccountInfo,
    amount: u64,
    remaining_accounts: &[AccountInfo],
    vault_bump: u8,
) -> Result<()> {
    if remaining_accounts.len() < N { // N = min accounts protocol needs
        vault.protocol_routed_underlying = vault
            .protocol_routed_underlying
            .checked_add(amount)
            .unwrap();
        return Ok(());
    }
    // Build instruction data with protocol discriminator + args
    // Call invoke_signed with vault PDA signer
    // Update vault.protocol_routed_underlying on success
}

pub fn on_withdraw(
    vault: &mut MyVaultState,
    remaining_accounts: &[AccountInfo],
    vault_authority: &AccountInfo,
    vault_token_account: &AccountInfo,
    token_program: &AccountInfo,
    amount: u64,
    vault_bump: u8,
) -> Result<()> { /* same pattern */ }

pub fn before_value_query(
    remaining_accounts: &[AccountInfo],
) -> Result<()> { /* read protocol state if accounts present */ }
```

## Share math

Use helpers from `yield_adapter_trait`:

```rust
use yield_adapter_trait::shares_for_deposit;
// shares = shares_for_deposit(amount, total_underlying, total_shares)?
use yield_adapter_trait::underlying_for_shares;
// underlying = underlying_for_shares(shares, total_underlying, total_shares)?
```

## Slippage protection

Check after calculation, before state mutation:

```rust
let shares = shares_for_deposit(amount, vault.total_underlying, vault.total_shares)?;
require!(shares >= min_shares_out, YieldAdapterError::SlippageExceeded);
```

## Current value (return data)

```rust
use anchor_lang::solana_program::program::set_return_data;
set_return_data(&value.to_le_bytes());
```

## Cargo.toml

```toml
[package]
name = "adapter-<name>"
version = "1.0.0"
edition = "2021"
license = "Apache-2.0"

[lib]
crate-type = ["cdylib", "lib"]
name = "adapter_<name>"

[features]
no-entrypoint = []
no-idl = []
no-log-ix-name = []
cpi = ["no-entrypoint"]
idl-build = ["anchor-lang/idl-build", "anchor-spl/idl-build"]
default = []

[dependencies]
anchor-lang = { workspace = true, features = ["init-if-needed"] }
anchor-spl = { workspace = true }
yield-adapter-trait = { path = "../../crates/yield-adapter-trait" }
```

## Adding to workspace

1. Add to `Cargo.toml` workspace members
2. Add to `Anchor.toml` under `[programs.localnet]` and `[programs.devnet]`
3. Add to `tests/adapters/` test file
4. Run `anchor keys sync` to generate keypair

## Key design rules

- **No crate dependency on the protocol** — build instruction data manually (discriminator + Borsh args), use raw `invoke`/`invoke_signed`
- **Conditional CPI** — always call `protocol::on_deposit` / `protocol::on_withdraw`; they only execute real CPI when `remaining_accounts` is sufficient
- **Maple pattern** — if the protocol token is natively yield-bearing (e.g., syrupUSDC), skip CPI entirely; the vault holds the token and value accrues intrinsically
- **Vault authority signs CPIs** — use `invoke_signed` with the vault authority PDA seeds
- **No branching on network** — the same binary handles localnet and fork via remaining accounts presence
