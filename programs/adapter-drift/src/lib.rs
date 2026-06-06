//! # Drift Insurance Fund Adapter
//!
//! Reference adapter for the Drift Protocol Insurance Fund staking.
//!
//! ## Protocol Details
//! - **Program**: `dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH`
//! - **Model**: Insurance fund staking with 13-day unstaking cooldown
//! - **Underlying**: USDC
//!
//! ## Important Note
//! Drift Protocol experienced a security incident in April 2026.
//! This adapter implements the correct interface against the protocol-v2
//! program specification. The cooldown period is tracked in adapter state.

use anchor_lang::prelude::*;

pub mod instructions;
pub mod protocol;
pub mod state;

use instructions::*;

declare_id!("2XVcoTcAcsCqnSh7zA1tzBaGxN3fBTmDKX52U8eozk8y");

pub const DRIFT_PROGRAM_ID: &str = "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH";

pub const DRIFT_V2_ID: Pubkey =
    pubkey!("dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH");

/// 13-day unstaking cooldown in seconds.
pub const UNSTAKE_COOLDOWN_SECONDS: i64 = 13 * 24 * 60 * 60;

#[program]
pub mod adapter_drift {
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
