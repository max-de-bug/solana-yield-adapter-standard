use anchor_lang::prelude::*;
use crate::state::AdapterPosition;
use yield_adapter_trait::{
    user_position_underlying_value, CurrentValueEvent, YieldAdapterError,
    ADAPTER_POSITION_SEED,
};

use crate::protocol;
use crate::state::{DriftVaultState, VAULT_STATE_SEED};
use crate::UNSTAKE_COOLDOWN_SECONDS;

#[derive(Accounts)]
pub struct CurrentValue<'info> {
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_STATE_SEED],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, DriftVaultState>,

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

    let cooldown_remaining = if position.last_withdraw_request > 0 {
        let elapsed = clock.unix_timestamp - position.last_withdraw_request;
        (UNSTAKE_COOLDOWN_SECONDS - elapsed).max(0)
    } else {
        0
    };

    emit!(CurrentValueEvent {
        user: ctx.accounts.user.key(),
        adapter: crate::ID,
        value,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Drift IF position value: {} USDC ({} shares, cooldown remaining: {}s)",
        value,
        position.receipt_token_balance,
        cooldown_remaining
    );

    Ok(())
}
