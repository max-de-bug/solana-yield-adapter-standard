use anchor_lang::prelude::*;
use yield_adapter_trait::{MAX_ADAPTER_NAME_LEN, MAX_METADATA_URI_LEN};

use crate::error::RegistryError;
use crate::state::{
    AdapterEntry, AdapterStatus, RegistryState, ADAPTER_ENTRY_SEED, REGISTRY_STATE_SEED,
};

#[derive(Accounts)]
pub struct ProposeAdapter<'info> {
    /// Anyone can propose an adapter.
    #[account(mut)]
    pub proposer: Signer<'info>,

    #[account(
        mut,
        seeds = [REGISTRY_STATE_SEED],
        bump = registry_state.bump,
    )]
    pub registry_state: Account<'info, RegistryState>,

    /// The adapter entry PDA — created for this adapter program ID.
    #[account(
        init,
        payer = proposer,
        space = 8 + AdapterEntry::INIT_SPACE,
        seeds = [ADAPTER_ENTRY_SEED, adapter_program.key().as_ref()],
        bump,
    )]
    pub adapter_entry: Account<'info, AdapterEntry>,

    /// The adapter program being proposed.
    /// CHECK: We only store its pubkey; the program may or may not be deployed yet.
    pub adapter_program: UncheckedAccount<'info>,

    /// The mint of the underlying token this adapter handles.
    /// CHECK: Stored as pubkey reference.
    pub underlying_mint: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ProposeAdapter>, name: String, metadata_uri: String) -> Result<()> {
    require!(name.len() <= MAX_ADAPTER_NAME_LEN, RegistryError::NameTooLong);
    require!(
        metadata_uri.len() <= MAX_METADATA_URI_LEN,
        RegistryError::UriTooLong
    );

    let clock = Clock::get()?;
    let entry = &mut ctx.accounts.adapter_entry;

    entry.adapter_program_id = ctx.accounts.adapter_program.key();
    entry.name = name.clone();
    entry.status = AdapterStatus::Proposed;
    entry.underlying_mint = ctx.accounts.underlying_mint.key();
    entry.metadata_uri = metadata_uri;
    entry.proposer = ctx.accounts.proposer.key();
    entry.proposed_at = clock.unix_timestamp;
    entry.approved_at = 0;
    entry.revoked_at = 0;
    entry.bump = ctx.bumps.adapter_entry;

    let state = &mut ctx.accounts.registry_state;
    state.total_proposed = state
        .total_proposed
        .checked_add(1)
        .ok_or(RegistryError::InvalidStatus)?;

    msg!(
        "Adapter proposed: '{}' (program: {})",
        name,
        entry.adapter_program_id
    );

    Ok(())
}
