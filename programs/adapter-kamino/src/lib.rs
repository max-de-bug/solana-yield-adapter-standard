//! # Kamino USDC Adapter
//!
//! Reference adapter for Kamino Finance (K-Lend) USDC lending vaults.
//!
//! ## Protocol Details
//! - **Program**: `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD`
//! - **Model**: Share-based vault (kToken receipt tokens)
//! - **Underlying**: USDC
//!
//! ## How It Works
//! 1. `deposit` — Transfers USDC into the adapter vault, mints proportional receipt tokens.
//! 2. `withdraw` — Burns receipt tokens, returns proportional USDC from the vault.
//! 3. `current_value` — Calculates current USDC value based on receipt token balance × share price.

use anchor_lang::prelude::*;

pub mod instructions;
pub mod protocol;
pub mod state;

use instructions::*;

declare_id!("BQMHrbTGx9ruKQN54XzMajLq769ax3e33YJ5FMkowrg9");

/// Kamino K-Lend program ID on mainnet.
pub const KAMINO_PROGRAM_ID: &str = "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD";

pub const KAMINO_LEND_ID: Pubkey =
    pubkey!("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");

#[program]
pub mod adapter_kamino {
    use super::*;

    /// Initialize the Kamino adapter vault state.
    pub fn initialize(ctx: Context<Initialize>, underlying_mint: Pubkey) -> Result<()> {
        instructions::initialize::handler(ctx, underlying_mint)
    }

    /// Deposit USDC into the Kamino lending vault.
    pub fn deposit<'a>(ctx: Context<'a, Deposit<'a>>, amount: u64, min_shares_out: u64) -> Result<()> {
        instructions::deposit::handler(ctx, amount, min_shares_out)
    }

    /// Withdraw USDC from the Kamino lending vault.
    pub fn withdraw<'a>(ctx: Context<'a, Withdraw<'a>>, amount: u64, min_underlying_out: u64) -> Result<()> {
        instructions::withdraw::handler(ctx, amount, min_underlying_out)
    }

    /// Query the current USDC value of the user's position.
    pub fn current_value(ctx: Context<CurrentValue>) -> Result<()> {
        instructions::current_value::handler(ctx)
    }

    /// Toggle the vault status between Active and Paused.
    pub fn toggle_status(ctx: Context<ToggleStatus>) -> Result<()> {
        instructions::toggle_status::handler(ctx)
    }
}
