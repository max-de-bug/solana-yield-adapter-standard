//! # Jupiter LP Adapter
//!
//! Reference adapter for Jupiter Perpetuals JLP pool.
//!
//! ## Protocol Details
//! - **Model**: JLP (Jupiter Liquidity Provider) pool
//! - **Underlying**: USDC (contributed as liquidity to perp markets)

use anchor_lang::prelude::*;

pub mod instructions;
pub mod protocol;
pub mod state;

use instructions::*;

declare_id!("8QdkGAkLvpN7JPxf3dgKFUXVGPS2LWW4BumbNkVkXkux");

/// Jupiter Perpetuals program ID on mainnet.
pub const JUPITER_PERP_PROGRAM_ID: &str = "PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu";

pub const JUPITER_PERP_ID: Pubkey =
    pubkey!("PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu");

#[program]
pub mod adapter_jupiter {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, underlying_mint: Pubkey) -> Result<()> {
        instructions::initialize::handler(ctx, underlying_mint)
    }

    pub fn deposit<'a>(ctx: Context<'a, Deposit<'a>>, amount: u64) -> Result<()> {
        instructions::deposit::handler(ctx, amount)
    }

    pub fn withdraw<'a>(ctx: Context<'a, Withdraw<'a>>, amount: u64) -> Result<()> {
        instructions::withdraw::handler(ctx, amount)
    }

    pub fn current_value(ctx: Context<CurrentValue>) -> Result<()> {
        instructions::current_value::handler(ctx)
    }

    pub fn toggle_status(ctx: Context<ToggleStatus>) -> Result<()> {
        instructions::toggle_status::handler(ctx)
    }
}
