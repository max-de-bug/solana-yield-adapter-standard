use anchor_lang::prelude::*;

use crate::error::RegistryError;
use crate::state::{
    AdapterEntry, AdapterStatus, RegistryState, ADAPTER_ENTRY_SEED, REGISTRY_STATE_SEED,
};

#[derive(Accounts)]
pub struct RevokeAdapter<'info> {
    /// Must be the governance authority or guardian.
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [REGISTRY_STATE_SEED],
        bump = registry_state.bump,
        constraint = registry_state.is_authority_or_guardian(&authority.key()) @ RegistryError::Unauthorized,
    )]
    pub registry_state: Account<'info, RegistryState>,

    #[account(
        mut,
        seeds = [ADAPTER_ENTRY_SEED, adapter_entry.adapter_program_id.as_ref()],
        bump = adapter_entry.bump,
        constraint = adapter_entry.status == AdapterStatus::Approved @ RegistryError::InvalidStatus,
    )]
    pub adapter_entry: Account<'info, AdapterEntry>,
}

pub fn handler(ctx: Context<RevokeAdapter>) -> Result<()> {
    let clock = Clock::get()?;
    let entry = &mut ctx.accounts.adapter_entry;

    entry.status = AdapterStatus::Revoked;
    entry.revoked_at = clock.unix_timestamp;

    let state = &mut ctx.accounts.registry_state;
    state.total_approved = state.total_approved.saturating_sub(1);

    msg!(
        "Adapter revoked: '{}' (program: {})",
        entry.name,
        entry.adapter_program_id
    );

    Ok(())
}
