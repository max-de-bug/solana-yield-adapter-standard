//! # Maple Syrup Adapter
//!
//! Reference adapter for Maple Finance (syrupUSDC) lending pools.
//!
//! ## Important Note
//!
//! Maple Finance operates primarily on EVM chains. This adapter serves as a
//! **reference implementation** demonstrating correct interface compliance for
//! the Yield Adapter Standard. The CPI layer uses a local vault model that
//! mirrors the share-based syrupUSDC mechanism.
//!
//! ## Protocol Details
//! - **Model**: Share-based lending pool (syrupUSDC receipt tokens)
//! - **Underlying**: USDC
//! - **Status**: Reference / mock CPI (Maple is EVM-primary)

use anchor_lang::prelude::*;

pub mod instructions;
pub mod protocol;
pub mod state;

use instructions::*;

declare_id!("Ft2Yvaiqwsjvo1yyYEWvt12YCsDB4kjGBd7vrF8RwwjU");

/// Maple is EVM-primary; metadata-only routing id (not a live Solana program).
pub const MAPLE_PROTOCOL_PLACEHOLDER: Pubkey =
    pubkey!("11111111111111111111111111111111");

#[program]
pub mod adapter_maple {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, underlying_mint: Pubkey) -> Result<()> {
        instructions::initialize::handler(ctx, underlying_mint)
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit::handler(ctx, amount)
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        instructions::withdraw::handler(ctx, amount)
    }

    pub fn current_value(ctx: Context<CurrentValue>) -> Result<()> {
        instructions::current_value::handler(ctx)
    }
}
