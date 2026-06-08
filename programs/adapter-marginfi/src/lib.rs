//! # MarginFi USDC Adapter
//!
//! Reference adapter for MarginFi v2 USDC lending.
//!
//! ## Protocol Details
//! - **Program**: `MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA`
//! - **Model**: Lending account with JIT risk engine
//! - **Underlying**: USDC

use anchor_lang::prelude::*;

pub mod instructions;
pub mod protocol;
pub mod state;

use instructions::*;

declare_id!("LtccLreoDVj2vurvsWpvfC8PvYTnUpTaxz6P9pDg5Y2");

pub const MARGINFI_PROGRAM_ID: &str = "MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA";

pub const MARGINFI_V2_ID: Pubkey =
    pubkey!("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA");

#[program]
pub mod adapter_marginfi {
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

    pub fn toggle_status(ctx: Context<ToggleStatus>) -> Result<()> {
        instructions::toggle_status::handler(ctx)
    }
}
