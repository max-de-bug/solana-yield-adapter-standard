//! # Drift Insurance Fund Adapter
//!
//! Reference adapter for the Drift Protocol with two-phase unstaking.
//!
//! ## Protocol Details
//! - **Program**: `dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH`
//! - **Model**: Spot market deposit/withdraw with 13-day unstaking cooldown
//! - **Underlying**: USDC
//!
//! ## Important Note — Honest Position on Insurance Fund Staking
//!
//! Drift's Insurance Fund staking instructions (`*_insurance_fund_stake`) are the
//! intended yield source for this adapter. However, these instructions are **commented
//! out of Drift's deployed `#[program]`** as of June 2025
//! (programs/drift/src/lib.rs ~lines 796-880 in drift-labs/protocol-v2).
//!
//! This adapter therefore uses Drift's **spot market deposit/withdraw** instructions
//! as the protocol CPI leg — a real, working CPI round-trip on mainnet fork, but one
//! that does not generate yield (spot market deposits are not a yield source).
//!
//! What we prove:
//!   1. Full CPI round-trip (deposit → current_value → withdraw) on real Drift mainnet state ✅
//!   2. Two-phase lifecycle (request → cooldown → settle) with configurable cooldown ✅
//!   3. Spec-correct IF-staking code is bundled and unit-tested (executes when Drift
//!      re-enables the exports)
//!   4. Probe script at `scripts/probe-drift-if.sh` confirms IF discriminators are
//!      rejected by the live program
//!
//! See `bash scripts/probe-drift-if.sh` and `docs/adapters/drift.md` for details.

#![allow(clippy::diverging_sub_expression)]
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub mod instructions;
pub mod protocol;
pub mod state;

use instructions::*;

declare_id!("2zMNZcFzAx9bFNchTWDqiJGt5H3bCDgo8PW1TTskwcLJ");

pub const DRIFT_PROGRAM_ID: &str = "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH";

pub const DRIFT_V2_ID: Pubkey = pubkey!("dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH");

/// 13-day unstaking cooldown in seconds.
pub const UNSTAKE_COOLDOWN_SECONDS: i64 = 13 * 24 * 60 * 60;

#[program]
pub mod adapter_drift {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, underlying_mint: Pubkey) -> Result<()> {
        instructions::initialize::handler(ctx, underlying_mint)
    }

    pub fn deposit<'a>(
        ctx: Context<'a, Deposit<'a>>,
        amount: u64,
        min_shares_out: u64,
    ) -> Result<()> {
        instructions::deposit::handler(ctx, amount, min_shares_out)
    }

    pub fn withdraw<'a>(
        ctx: Context<'a, Withdraw<'a>>,
        amount: u64,
        min_underlying_out: u64,
    ) -> Result<()> {
        instructions::withdraw::handler(ctx, amount, min_underlying_out)
    }

    /// Settle a pending unstake request after the cooldown has elapsed.
    ///
    /// Executes the Drift CPI withdrawal and transfers underlying to the user.
    /// The `WithdrawalTicket` account is closed and rent returned to the user.
    pub fn settle_withdrawal<'a>(ctx: Context<'a, SettleWithdrawal<'a>>) -> Result<()> {
        instructions::settle_withdrawal::handler(ctx)
    }

    pub fn current_value(ctx: Context<CurrentValue>) -> Result<()> {
        instructions::current_value::handler(ctx)
    }

    pub fn toggle_status(ctx: Context<ToggleStatus>) -> Result<()> {
        instructions::toggle_status::handler(ctx)
    }

    /// Set the unstaking cooldown duration (authority only). Used for testing or
    /// adapting to protocol parameter changes.
    pub fn set_unstake_cooldown(ctx: Context<SetCooldown>, cooldown_seconds: i64) -> Result<()> {
        instructions::set_cooldown::handler(ctx, cooldown_seconds)
    }

    /// Cancel a pending unstake request and return locked shares to the position.
    pub fn cancel_unstake(ctx: Context<CancelUnstake>) -> Result<()> {
        instructions::cancel_unstake::handler(ctx)
    }
}
