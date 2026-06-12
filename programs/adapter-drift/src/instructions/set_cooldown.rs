use anchor_lang::prelude::*;
use yield_adapter_trait::YieldAdapterError;

use crate::state::{DriftVaultState, VAULT_STATE_SEED};

#[derive(Accounts)]
pub struct SetCooldown<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_STATE_SEED],
        bump = vault_state.bump,
        constraint = vault_state.authority == authority.key() @ YieldAdapterError::Unauthorized,
    )]
    pub vault_state: Account<'info, DriftVaultState>,
}

pub fn handler(ctx: Context<SetCooldown>, cooldown_seconds: i64) -> Result<()> {
    let vault = &mut ctx.accounts.vault_state;
    vault.unstake_cooldown_seconds = cooldown_seconds;

    msg!(
        "Drift unstake cooldown set to {}s",
        cooldown_seconds
    );
    Ok(())
}
