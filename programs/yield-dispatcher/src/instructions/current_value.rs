use adapter_registry::program::AdapterRegistry;
use adapter_registry::state::{AdapterEntry, AdapterStatus, ADAPTER_ENTRY_SEED};
use anchor_lang::prelude::*;

use crate::adapter_cpi::{cpi_current_value, AdapterCurrentValueAccounts};
use crate::adapter_validation;
use crate::error::DispatcherError;
use crate::events::DispatchCurrentValueEvent;
use crate::state::{DispatcherState, UserPosition, DISPATCHER_STATE_SEED, USER_POSITION_SEED};

#[derive(Accounts)]
pub struct CurrentValue<'info> {
    pub user: Signer<'info>,

    #[account(
        seeds = [DISPATCHER_STATE_SEED],
        bump = dispatcher_state.bump,
    )]
    pub dispatcher_state: Account<'info, DispatcherState>,

    #[account(
        seeds = [USER_POSITION_SEED, user.key().as_ref(), adapter_program.key().as_ref()],
        bump = user_position.bump,
        constraint = user_position.owner == user.key() @ DispatcherError::Unauthorized,
    )]
    pub user_position: Account<'info, UserPosition>,

    #[account(
        constraint = registry_program.key() == dispatcher_state.registry_program_id
            @ DispatcherError::RegistryMismatch,
    )]
    pub registry_program: Program<'info, AdapterRegistry>,

    #[account(
        seeds = [ADAPTER_ENTRY_SEED, adapter_program.key().as_ref()],
        bump = adapter_entry.bump,
        seeds::program = registry_program,
        constraint = adapter_entry.adapter_program_id == adapter_program.key()
            @ DispatcherError::AdapterNotApproved,
        constraint = adapter_entry.status == AdapterStatus::Approved
            @ DispatcherError::AdapterNotApproved,
    )]
    pub adapter_entry: Account<'info, AdapterEntry>,

    /// CHECK: Approved adapter program.
    #[account(constraint = adapter_program.key() == adapter_entry.adapter_program_id)]
    pub adapter_program: UncheckedAccount<'info>,

    /// CHECK: Canonical adapter vault state PDA.
    #[account(
        mut,
        constraint = adapter_validation::is_adapter_vault_state(
            &adapter_vault_state.to_account_info(),
            &adapter_entry.vault_state_seed,
            &adapter_program.key(),
        ) @ DispatcherError::AdapterCpiError,
    )]
    pub adapter_vault_state: UncheckedAccount<'info>,

    /// CHECK: Canonical adapter user position PDA.
    #[account(
        constraint = adapter_validation::is_adapter_user_position(
            &adapter_user_position.to_account_info(),
            &adapter_program.key(),
            &user.key(),
        ) @ DispatcherError::AdapterCpiError,
    )]
    pub adapter_user_position: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<CurrentValue>) -> Result<()> {
    let value = cpi_current_value(AdapterCurrentValueAccounts {
        adapter_program: ctx.accounts.adapter_program.to_account_info(),
        user: ctx.accounts.user.to_account_info(),
        vault_state: ctx.accounts.adapter_vault_state.to_account_info(),
        user_position: ctx.accounts.adapter_user_position.to_account_info(),
    })?;

    let clock = Clock::get()?;

    emit!(DispatchCurrentValueEvent {
        user: ctx.accounts.user.key(),
        adapter_program_id: ctx.accounts.adapter_program.key(),
        value,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Current value for {} in {}: {} underlying",
        ctx.accounts.user.key(),
        ctx.accounts.adapter_program.key(),
        value
    );

    Ok(())
}
