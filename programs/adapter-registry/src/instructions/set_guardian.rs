use anchor_lang::prelude::*;

use crate::error::RegistryError;
use crate::state::{RegistryState, REGISTRY_STATE_SEED};

#[derive(Accounts)]
pub struct SetGuardian<'info> {
    /// Must be the current governance authority.
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [REGISTRY_STATE_SEED],
        bump = registry_state.bump,
        constraint = registry_state.is_authority(&authority.key()) @ RegistryError::Unauthorized,
    )]
    pub registry_state: Account<'info, RegistryState>,
}

/// Set or remove the guardian.
/// Pass `Pubkey::default()` to clear the guardian role.
pub fn handler(ctx: Context<SetGuardian>, new_guardian: Pubkey) -> Result<()> {
    let state = &mut ctx.accounts.registry_state;

    state.guardian = if new_guardian == Pubkey::default() {
        None
    } else {
        Some(new_guardian)
    };

    msg!(
        "Guardian set to: {}",
        state.guardian.map(|k| k.to_string()).unwrap_or_else(|| "None".to_string())
    );

    Ok(())
}
