use anchor_lang::prelude::*;

use crate::error::RegistryError;
use crate::state::{
    AdapterEntry, AdapterStatus, RegistryState, ADAPTER_ENTRY_SEED, REGISTRY_STATE_SEED,
};

#[derive(Accounts)]
pub struct ApproveAdapter<'info> {
    /// Must be the governance authority.
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [REGISTRY_STATE_SEED],
        bump = registry_state.bump,
        constraint = registry_state.authority == authority.key() @ RegistryError::Unauthorized,
    )]
    pub registry_state: Account<'info, RegistryState>,

    #[account(
        mut,
        seeds = [ADAPTER_ENTRY_SEED, adapter_entry.adapter_program_id.as_ref()],
        bump = adapter_entry.bump,
        constraint = adapter_entry.status == AdapterStatus::Proposed @ RegistryError::InvalidStatus,
    )]
    pub adapter_entry: Account<'info, AdapterEntry>,
}

pub fn handler(ctx: Context<ApproveAdapter>) -> Result<()> {
    let clock = Clock::get()?;
    let entry = &mut ctx.accounts.adapter_entry;

    entry.status = AdapterStatus::Approved;
    entry.approved_at = clock.unix_timestamp;

    let state = &mut ctx.accounts.registry_state;
    state.total_approved = state
        .total_approved
        .checked_add(1)
        .ok_or(RegistryError::InvalidStatus)?;

    msg!(
        "Adapter approved: '{}' (program: {})",
        entry.name,
        entry.adapter_program_id
    );

    Ok(())
}
