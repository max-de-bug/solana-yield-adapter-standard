use anchor_lang::prelude::*;

use crate::error::RegistryError;
use crate::state::{RegistryState, REGISTRY_STATE_SEED};

#[derive(Accounts)]
pub struct NominateGovernance<'info> {
    /// Must be the current governance authority.
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [REGISTRY_STATE_SEED],
        bump = registry_state.bump,
        constraint = registry_state.authority == authority.key() @ RegistryError::Unauthorized,
    )]
    pub registry_state: Account<'info, RegistryState>,

    /// The new governance authority (nominated).
    /// CHECK: Any pubkey can be nominated; they must accept via `accept_governance`.
    pub new_authority: UncheckedAccount<'info>,
}

/// Step 1 of two-step governance transfer: nominate a new authority.
pub fn handler(ctx: Context<NominateGovernance>) -> Result<()> {
    let state = &mut ctx.accounts.registry_state;

    state.pending_authority = Some(ctx.accounts.new_authority.key());

    msg!(
        "Governance nominated: {} -> {} (pending accept)",
        state.authority,
        ctx.accounts.new_authority.key()
    );

    Ok(())
}
