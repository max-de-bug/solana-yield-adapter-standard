#![allow(clippy::diverging_sub_expression)]
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub mod instructions;
pub mod protocol;
pub mod state;

use instructions::*;

declare_id!("GRyFctNGZFhHnpHFyyB8xtYdVtC58ZuwyC63PrEy3Vrk");

#[program]
pub mod adapter_maple {
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

    pub fn current_value(ctx: Context<CurrentValue>) -> Result<()> {
        instructions::current_value::handler(ctx)
    }

    pub fn toggle_status(ctx: Context<ToggleStatus>) -> Result<()> {
        instructions::toggle_status::handler(ctx)
    }
}
