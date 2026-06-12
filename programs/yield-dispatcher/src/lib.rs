//! # Yield Dispatcher
//!
//! The core router program for the Solana Yield Adapter Standard.
//! Acts as a unified entry point that validates adapters against the registry,
//! tracks user positions, and performs CPI calls to registered adapter programs.

#![allow(clippy::diverging_sub_expression)]
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub mod adapter_cpi;
pub mod adapter_validation;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("HUGWpAwFyeWrnH7f9pfWX93puZdC2ud4MYZQT8FtEBvH");

#[program]
pub mod yield_dispatcher {
    use super::*;

    /// Initialize the dispatcher with a governance authority.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize::handler(ctx)
    }

    /// Deposit underlying tokens into a registered adapter.
    ///
    /// The dispatcher validates the adapter is approved in the registry,
    /// then performs a CPI to the adapter's `deposit` instruction.
    pub fn deposit(ctx: Context<Deposit>, amount: u64, min_shares_out: u64) -> Result<()> {
        instructions::deposit::handler(ctx, amount, min_shares_out)
    }

    /// Withdraw underlying tokens from a registered adapter.
    ///
    /// Burns receipt tokens and returns underlying tokens to the user.
    pub fn withdraw(ctx: Context<Withdraw>, shares: u64, min_underlying_out: u64) -> Result<()> {
        instructions::withdraw::handler(ctx, shares, min_underlying_out)
    }

    /// Query the current value of a user's position in an adapter.
    ///
    /// Returns the value in underlying token units via an event emission.
    pub fn current_value(ctx: Context<CurrentValue>) -> Result<()> {
        instructions::current_value::handler(ctx)
    }

    /// Toggle the dispatcher pause state. Authority-only.
    ///
    /// When paused, all deposit/withdraw routing is blocked.
    pub fn toggle_pause(ctx: Context<TogglePause>) -> Result<()> {
        instructions::toggle_pause::handler(ctx)
    }
}
