use anchor_lang::prelude::*;
use yield_adapter_trait::{VaultStatus, YieldAdapterError};

use crate::state::{MapleVaultState, VAULT_STATE_SEED};

#[derive(Accounts)]
pub struct ToggleStatus<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_STATE_SEED],
        bump = vault_state.bump,
        constraint = vault_state.authority == authority.key() @ YieldAdapterError::Unauthorized,
    )]
    pub vault_state: Account<'info, MapleVaultState>,
}

pub fn handler(ctx: Context<ToggleStatus>) -> Result<()> {
    let vault = &mut ctx.accounts.vault_state;

    match vault.status {
        VaultStatus::Active => {
            vault.status = VaultStatus::DepositsPaused;
            msg!("Maple Syrup vault: deposits paused, withdrawals allowed");
        }
        VaultStatus::DepositsPaused => {
            vault.status = VaultStatus::Paused;
            msg!("Maple Syrup vault: fully paused");
        }
        VaultStatus::Paused => {
            vault.status = VaultStatus::Active;
            msg!("Maple Syrup vault: fully resumed");
        }
        VaultStatus::Deprecated => {
            return Err(YieldAdapterError::VaultDeprecated.into());
        }
    }

    Ok(())
}
