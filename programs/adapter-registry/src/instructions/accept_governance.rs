use anchor_lang::prelude::*;

use crate::error::RegistryError;
use crate::state::{RegistryState, REGISTRY_STATE_SEED};

#[derive(Accounts)]
pub struct AcceptGovernance<'info> {
    /// Must be the pending governance authority.
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [REGISTRY_STATE_SEED],
        bump = registry_state.bump,
    )]
    pub registry_state: Account<'info, RegistryState>,
}

/// Step 2 of two-step governance transfer: accept the nomination.
pub fn handler(ctx: Context<AcceptGovernance>) -> Result<()> {
    let state = &mut ctx.accounts.registry_state;

    let pending = state
        .pending_authority
        .ok_or(RegistryError::NoPendingTransfer)?;

    require!(
        pending == ctx.accounts.signer.key(),
        RegistryError::NotPendingAuthority
    );

    state.authority = pending;
    state.pending_authority = None;

    msg!("Governance accepted: new authority is {}", state.authority);

    Ok(())
}
