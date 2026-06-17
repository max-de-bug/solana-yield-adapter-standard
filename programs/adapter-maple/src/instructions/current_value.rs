use anchor_lang::prelude::*;
use yield_adapter_trait::{CurrentValueEvent, YieldAdapterError, ADAPTER_POSITION_SEED};

use crate::protocol;
use crate::state::{AdapterPosition, MapleVaultState, VAULT_STATE_SEED};

#[derive(Accounts)]
pub struct CurrentValue<'info> {
    pub user: Signer<'info>,
    #[account(seeds = [VAULT_STATE_SEED], bump = vault_state.bump)]
    pub vault_state: Account<'info, MapleVaultState>,
    #[account(
        seeds = [ADAPTER_POSITION_SEED, user.key().as_ref()],
        bump = user_position.bump,
        constraint = user_position.owner == user.key() @ YieldAdapterError::Unauthorized,
    )]
    pub user_position: Account<'info, AdapterPosition>,
}

pub fn handler(ctx: Context<CurrentValue>) -> Result<()> {
    let position = &ctx.accounts.user_position;
    let clock = Clock::get()?;
    require!(
        ctx.remaining_accounts.len() >= 1,
        YieldAdapterError::ProtocolCpiError,
    );

    let value = protocol::chainlink_value(
        position.receipt_token_balance,
        &ctx.remaining_accounts[0],
    )?;

    emit!(CurrentValueEvent {
        user: ctx.accounts.user.key(),
        adapter: crate::ID,
        value,
        timestamp: clock.unix_timestamp,
    });

    msg!("Maple position value: {} USDC ({} shares)", value, position.receipt_token_balance);
    Ok(())
}
