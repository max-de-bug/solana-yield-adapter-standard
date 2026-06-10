use anchor_lang::prelude::*;

pub mod instructions;
pub mod protocol;
pub mod state;

use instructions::*;

// Replace this with your own program ID generated via `solana-keygen grind --starts-with TMPL`.
// Keep the `declare_id!` at the top of `lib.rs` as required by Anchor.
// IMPORTANT: Replace this with your own program ID before deploying.
// Generate a new keypair:  solana-keygen grind --starts-with YOUR_PREFIX
// Then update the keypair file at  target/deploy/adapter_template-keypair.json
declare_id!("jbLUHXvc9P26MpQdGXht4aKnbn68i2GijxsFX6RXahV");

/// Program ID of the external yield protocol. Set to `Pubkey::default()` for no-op adapters.
pub const EXTERNAL_PROGRAM_ID: Pubkey = pubkey!("11111111111111111111111111111111");

#[program]
pub mod adapter_template {
    use super::*;

    /// Initialize the vault state with the underlying token mint.
    /// Called once when deploying a new vault for a given yield source.
    pub fn initialize(ctx: Context<Initialize>, underlying_mint: Pubkey) -> Result<()> {
        instructions::initialize::handler(ctx, underlying_mint)
    }

    /// Deposit `amount` underlying tokens into the yield source.
    /// The vault authority PDA transfers user tokens, then routes them to the protocol.
    pub fn deposit<'a>(
        ctx: Context<'a, Deposit<'a>>,
        amount: u64,
        min_shares_out: u64,
    ) -> Result<()> {
        instructions::deposit::handler(ctx, amount, min_shares_out)
    }

    /// Withdraw `shares_to_burn` receipt tokens, returning underlying tokens to the user.
    /// Withdraws from the protocol via CPI, then transfers tokens back to the user.
    pub fn withdraw<'a>(
        ctx: Context<'a, Withdraw<'a>>,
        shares_to_burn: u64,
        min_underlying_out: u64,
    ) -> Result<()> {
        instructions::withdraw::handler(ctx, shares_to_burn, min_underlying_out)
    }

    /// Query the current value of a user's position in underlying token units.
    /// No tokens are transferred; this is a read-only query.
    pub fn current_value(ctx: Context<CurrentValue>) -> Result<()> {
        instructions::current_value::handler(ctx)
    }

    /// Toggle vault status between Active ↔ Paused.
    /// Only the vault authority may call this.
    pub fn toggle_status(ctx: Context<ToggleStatus>) -> Result<()> {
        instructions::toggle_status::handler(ctx)
    }
}
