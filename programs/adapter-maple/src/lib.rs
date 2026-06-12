//! # Maple Syrup Adapter
//!
//! Adapter for Maple Finance (syrupUSDC) — vault holds real syrupUSDC (yield-bearing SPL token),
//! capturing Maple's institutional lending yield through natural token appreciation.
//!
//! ## Protocol Details
//! - **Model**: Share-based vault holding syrupUSDC tokens
//! - **Underlying**: syrupUSDC (yield-bearing SPL token)
//! - **Status**: Production-ready vault; no CPI to EVM-primary Maple contracts needed

#![allow(clippy::diverging_sub_expression)]
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub mod instructions;
pub mod protocol;
pub mod state;

use instructions::*;

declare_id!("Ft2Yvaiqwsjvo1yyYEWvt12YCsDB4kjGBd7vrF8RwwjU");

#[program]
pub mod adapter_maple {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, underlying_mint: Pubkey) -> Result<()> {
        instructions::initialize::handler(ctx, underlying_mint)
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64, min_shares_out: u64) -> Result<()> {
        instructions::deposit::handler(ctx, amount, min_shares_out)
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64, min_underlying_out: u64) -> Result<()> {
        instructions::withdraw::handler(ctx, amount, min_underlying_out)
    }

    pub fn current_value(ctx: Context<CurrentValue>) -> Result<()> {
        instructions::current_value::handler(ctx)
    }

    pub fn toggle_status(ctx: Context<ToggleStatus>) -> Result<()> {
        instructions::toggle_status::handler(ctx)
    }
}
