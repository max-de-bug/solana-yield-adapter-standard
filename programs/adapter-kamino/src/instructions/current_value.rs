use crate::state::AdapterPosition;
use anchor_lang::prelude::*;
use yield_adapter_trait::{
    user_position_underlying_value, CurrentValueEvent, YieldAdapterError, ADAPTER_POSITION_SEED,
};

use crate::protocol;
use crate::state::{KaminoVaultState, VAULT_STATE_SEED};

#[derive(Accounts)]
pub struct CurrentValue<'info> {
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_STATE_SEED],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, KaminoVaultState>,

    #[account(
        seeds = [ADAPTER_POSITION_SEED, user.key().as_ref()],
        bump = user_position.bump,
        constraint = user_position.owner == user.key() @ YieldAdapterError::Unauthorized,
    )]
    pub user_position: Account<'info, AdapterPosition>,
}

pub fn handler(ctx: Context<CurrentValue>) -> Result<()> {
    let vault = &mut ctx.accounts.vault_state;
    let position = &ctx.accounts.user_position;
    let clock = Clock::get()?;

    protocol::before_value_query(vault, ctx.remaining_accounts)?;

    let value = user_position_underlying_value(
        position.receipt_token_balance,
        vault.total_underlying,
        vault.total_shares,
    )?;

    emit!(CurrentValueEvent {
        user: ctx.accounts.user.key(),
        adapter: crate::ID,
        value,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Kamino position value: {} USDC ({} shares)",
        value,
        position.receipt_token_balance
    );

    Ok(())
}
