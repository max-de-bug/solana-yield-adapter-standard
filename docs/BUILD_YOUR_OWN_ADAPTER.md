# Build Your Own Adapter — Developer Guide

> **Goal**: Ship a working, conformant yield adapter in less than a day.

This guide walks you through building a yield adapter from scratch. By the end, you'll have a fully functional adapter that integrates with the Solana Yield Adapter Standard.

---

## Prerequisites

- Rust + Cargo (1.75+)
- Solana CLI (2.2.20+)
- Anchor CLI (1.0.1)
- Node.js 18+
- Familiarity with Anchor programs

## Step 1: Scaffold Your Project (15 min)

```bash
# Create a new Anchor project
anchor init my-yield-adapter
cd my-yield-adapter

# Add the trait crate dependency
# In programs/my-yield-adapter/Cargo.toml:
```

```toml
[dependencies]
anchor-lang = "1.0.1"
anchor-spl = "1.0.1"

# TypeScript client (Anchor 1.x)
# npm install @anchor-lang/core@1.0.1
yield-adapter-trait = { git = "https://github.com/your-org/solana-yield-adapter-standard", path = "programs/yield-adapter-trait" }
```

## Step 2: Define Your Vault State (15 min)

Create `src/state.rs`:

```rust
use anchor_lang::prelude::*;
use yield_adapter_trait::VaultStatus;

#[account]
#[derive(Debug, InitSpace)]
pub struct MyVaultState {
    pub authority: Pubkey,
    pub underlying_mint: Pubkey,
    pub total_underlying: u64,
    pub total_shares: u64,
    pub status: VaultStatus,
    pub bump: u8,
}

pub const VAULT_STATE_SEED: &[u8] = b"my_vault_state";
pub const VAULT_AUTHORITY_SEED: &[u8] = b"my_vault_authority";
```

**Key decisions**:
- Use unique PDA seeds (prefix with your protocol name)
- Add any protocol-specific fields you need
- Always include `status: VaultStatus` for emergency stops (use the enum directly — `Active`, `Paused`, `Deprecated`, `DepositsPaused`)

## Step 3: Implement the Three Instructions (2-3 hours)

### 3a. Deposit

```rust
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use yield_adapter_trait::{DepositEvent, YieldAdapterError};
use crate::state::{MyVaultState, VAULT_STATE_SEED};

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_STATE_SEED],
        bump = vault_state.bump,
        constraint = vault_state.status.can_deposit()
            @ YieldAdapterError::AdapterNotActive,
    )]
    pub vault_state: Account<'info, MyVaultState>,

    #[account(
        mut,
        constraint = user_token_account.owner == user.key(),
        constraint = user_token_account.mint == vault_state.underlying_mint
            @ YieldAdapterError::MintMismatch,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Deposit>, amount: u64, min_shares_out: u64) -> Result<()> {
    require!(amount > 0, YieldAdapterError::ZeroDepositAmount);

    let vault = &mut ctx.accounts.vault_state;
    let clock = Clock::get()?;

    // Calculate shares using the standard formula
    let shares = if vault.total_shares == 0 {
        amount // 1:1 for first deposit
    } else {
        (amount as u128)
            .checked_mul(vault.total_shares as u128)
            .ok_or(YieldAdapterError::ArithmeticOverflow)?
            .checked_div(vault.total_underlying as u128)
            .ok_or(YieldAdapterError::ArithmeticOverflow)? as u64
    };

    // Slippage protection: guard against unfavorable share price movement.
    require!(
        shares >= min_shares_out,
        YieldAdapterError::SlippageExceeded
    );

    // Transfer tokens
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_token_account.to_account_info(),
                to: ctx.accounts.vault_token_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
    )?;

    // Update state
    vault.total_underlying = vault.total_underlying
        .checked_add(amount)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?;
    vault.total_shares = vault.total_shares
        .checked_add(shares)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?;

    // Emit standard event (REQUIRED)
    emit!(DepositEvent {
        user: ctx.accounts.user.key(),
        adapter: crate::ID,
        amount,
        receipt_amount: shares,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
```

### 3b. Withdraw

Same pattern but reversed: burn shares → calculate underlying → transfer out via PDA signer.

**Important**: Use `CpiContext::new_with_signer` with your vault authority PDA seeds.

**Slippage protection**: Add `min_underlying_out: u64` to the function signature and check `underlying_amount >= min_underlying_out` after the calculation (same position as the deposit check).

### 3c. Current Value

Read-only query that emits the share price:

```rust
pub fn handler(ctx: Context<CurrentValue>) -> Result<()> {
    let vault = &ctx.accounts.vault_state;
    let clock = Clock::get()?;

    let share_price = if vault.total_shares == 0 {
        1_000_000_000u64
    } else {
        ((vault.total_underlying as u128) * 1_000_000_000
            / (vault.total_shares as u128)) as u64
    };

    emit!(CurrentValueEvent {
        user: ctx.accounts.user.key(),
        adapter: crate::ID,
        value: share_price,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
```

## Step 4: Add Protocol-Specific CPI (1-2 hours)

This is where your adapter gets interesting. Instead of holding tokens in a local vault, you'll CPI into the target protocol.

### Example: CPI to a Lending Protocol

```rust
// In your deposit handler, AFTER the token transfer:
// CPI to the protocol's deposit instruction
let cpi_accounts = ProtocolDeposit {
    user_account: ...,
    pool: ...,
    vault: ...,
};
let cpi_ctx = CpiContext::new(
    ctx.accounts.protocol_program.to_account_info(),
    cpi_accounts,
);
protocol::deposit(cpi_ctx, amount)?;
```

### Tips:
- Study the target protocol's IDL for account requirements
- Clone the protocol's program in your test validator for testing
- Handle protocol-specific errors in the `7000+` error range

## Step 5: Write Tests (1-2 hours)

```typescript
describe("my-yield-adapter", () => {
  it("deposits and receives proportional shares", async () => {
    // Setup: create mint, token accounts, initialize vault
    // Action: deposit 1000 USDC, min_shares_out = 0 (no slippage protection)
    // Assert: shares == 1000 (first deposit is 1:1)
    // Assert: vault.total_underlying == 1000
  });

  it("withdraws proportionally", async () => {
    // Deposit 1000, withdraw 500 shares, min_underlying_out = 0
    // Assert: user receives 500 USDC
    // Assert: vault state updated correctly
  });

  it("reports correct share price", async () => {
    // Deposit, then query current_value
    // Assert: share_price == 1_000_000_000 (1:1 initially)
  });

  it("rejects zero deposits", async () => {
    // Assert: deposit(0, 0) throws ZeroDepositAmount
  });

  it("reverts on slippage", async () => {
    // Assert: deposit(1000, 1001) throws SlippageExceeded
    // Assert: withdraw(1000, 1_000_000_001) throws SlippageExceeded
  });
});
```

## Step 6: Register Your Adapter (10 min)

Once your adapter is deployed, register it with the on-chain registry:

```typescript
// 1. Propose your adapter — include the vault state seed your adapter uses
await registryProgram.methods
  .proposeAdapter(
    "My Yield Adapter",
    "https://my-docs.com/adapter.json",
    "my_vault_state",      // vault_state_seed: must match your VAULT_STATE_SEED constant
  )
  .accounts({
    proposer: wallet.publicKey,
    registryState: registryStatePda,
    adapterEntry: adapterEntryPda,
    adapterProgram: myAdapterProgramId,
    underlyingMint: usdcMint,
    systemProgram: SystemProgram.programId,
  })
  .rpc();

// 2. Wait for governance approval
// The registry authority will call approve_adapter()

// 3. (Optional) Governance uses two-step transfer to hand off to multisig:
//    nominateGovernance → acceptGovernance
```

## Checklist

Before submitting your adapter:

- [ ] Implements `deposit`, `withdraw`, `current_value`
- [ ] Emits `DepositEvent`, `WithdrawEvent`, `CurrentValueEvent`
- [ ] Uses `checked_*` arithmetic everywhere
- [ ] Validates `amount > 0` on deposit and withdraw
- [ ] Validates `status.can_deposit()` on deposit and `status.can_withdraw()` on withdraw
- [ ] Validates token mint matches `underlying_mint`
- [ ] Validates `shares >= min_shares_out` on deposit and `underlying_amount >= min_underlying_out` on withdraw
- [ ] Uses PDA authority for vault transfers
- [ ] Has comprehensive tests (deposit, withdraw, current_value, edge cases, slippage reverts)
- [ ] `vault_state_seed` included when proposing in registry
- [ ] Passes `cargo clippy --workspace` with zero warnings
- [ ] Protocol-specific errors use error codes 7000+

## Common Pitfalls

| Pitfall | Solution |
|---|---|
| Unchecked arithmetic | Always use `checked_add`, `checked_sub`, `checked_mul`, `checked_div` |
| Missing event emissions | Every state change MUST emit the corresponding standard event |
| Hardcoded share price | Use the dynamic formula: `total_underlying * 1e9 / total_shares` |
| Missing mint validation | Always validate `token_account.mint == vault.underlying_mint` |
| External signer for vault | Use a PDA derived from known seeds — never an external keypair |
| No slippage protection | Pass `min_shares_out` / `min_underlying_out` and check after calculation, before any transfers |

## Need Help?

- Review the [Adapter Standard Specification](./ADAPTER_STANDARD.md)
- Study the five reference adapters in `programs/adapter-*`
- Open an issue on GitHub
