use anchor_lang::prelude::*;

use crate::error::RegistryError;
use crate::state::{RegistryState, REGISTRY_STATE_SEED};

#[derive(Accounts)]
pub struct TransferGovernance<'info> {
    /// Must be the current governance authority.
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [REGISTRY_STATE_SEED],
        bump = registry_state.bump,
        constraint = registry_state.authority == authority.key() @ RegistryError::Unauthorized,
    )]
    pub registry_state: Account<'info, RegistryState>,

    /// The new governance authority.
    /// CHECK: Any pubkey can be the new authority.
    pub new_authority: UncheckedAccount<'info>,
}

/// Two-step governance transfer: current authority sets new authority directly.
/// For production, consider a two-step accept pattern.
pub fn handler(ctx: Context<TransferGovernance>) -> Result<()> {
    let state = &mut ctx.accounts.registry_state;
    let old_authority = state.authority;

    state.authority = ctx.accounts.new_authority.key();

    msg!(
        "Governance transferred: {} -> {}",
        old_authority,
        state.authority
    );

    Ok(())
}
