//! # Yield Dispatcher
//!
//! The core router program for the Solana Yield Adapter Standard.
//! Acts as a unified entry point that validates adapters against the registry,
//! tracks user positions, and performs CPI calls to registered adapter programs.

use anchor_lang::prelude::*;

pub mod adapter_cpi;
pub mod adapter_validation;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("7oUKys5XKMzD2NmFCZyLDyTF2Hm1VH3qX8jVfZEY4f3r");

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
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit::handler(ctx, amount)
    }

    /// Withdraw underlying tokens from a registered adapter.
    ///
    /// Burns receipt tokens and returns underlying tokens to the user.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        instructions::withdraw::handler(ctx, amount)
    }

    /// Query the current value of a user's position in an adapter.
    ///
    /// Returns the value in underlying token units via an event emission.
    pub fn current_value(ctx: Context<CurrentValue>) -> Result<()> {
        instructions::current_value::handler(ctx)
    }
}
