use anchor_lang::prelude::*;
use yield_adapter_trait::{VaultStatus, YieldAdapterError};

use crate::state::{JupiterVaultState, VAULT_STATE_SEED};

#[derive(Accounts)]
pub struct ToggleStatus<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_STATE_SEED],
        bump = vault_state.bump,
        constraint = vault_state.authority == authority.key() @ YieldAdapterError::Unauthorized,
    )]
    pub vault_state: Account<'info, JupiterVaultState>,
}

pub fn handler(ctx: Context<ToggleStatus>) -> Result<()> {
    let vault = &mut ctx.accounts.vault_state;

    match VaultStatus::from_u8(vault.status) {
        Some(VaultStatus::Active) => {
            vault.status = VaultStatus::Paused.as_u8();
            msg!("Jupiter vault paused");
        }
        Some(VaultStatus::Paused) => {
            vault.status = VaultStatus::Active.as_u8();
            msg!("Jupiter vault resumed");
        }
        Some(VaultStatus::Deprecated) => {
            return Err(YieldAdapterError::VaultDeprecated.into());
        }
        None => {
            return Err(YieldAdapterError::InvalidMetadata.into());
        }
    }

    Ok(())
}
