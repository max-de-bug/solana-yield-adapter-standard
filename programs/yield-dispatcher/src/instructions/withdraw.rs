use adapter_registry::program::AdapterRegistry;
use adapter_registry::state::{AdapterEntry, AdapterStatus, ADAPTER_ENTRY_SEED};
use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::adapter_cpi::{cpi_withdraw, AdapterWithdrawAccounts};
use crate::adapter_validation;
use crate::error::DispatcherError;
use crate::events::DispatchWithdrawEvent;
use crate::state::{DispatcherState, UserPosition, DISPATCHER_STATE_SEED, USER_POSITION_SEED};

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [DISPATCHER_STATE_SEED],
        bump = dispatcher_state.bump,
        constraint = !dispatcher_state.is_paused @ DispatcherError::DispatcherPaused,
    )]
    pub dispatcher_state: Account<'info, DispatcherState>,

    #[account(
        mut,
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

    #[account(
        mut,
        constraint = user_token_account.owner == user.key(),
        constraint = user_token_account.mint == adapter_entry.underlying_mint
            @ DispatcherError::AdapterCpiError,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    /// CHECK: Canonical adapter vault state PDA.
    #[account(
        mut,
        constraint = adapter_validation::is_adapter_vault_state(
            &adapter_vault_state.to_account_info(),
            &adapter_program.key(),
        ) @ DispatcherError::AdapterCpiError,
    )]
    pub adapter_vault_state: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = adapter_vault.mint == adapter_entry.underlying_mint
            @ DispatcherError::AdapterCpiError,
        constraint = adapter_vault.owner == adapter_vault_authority.key()
            @ DispatcherError::AdapterCpiError,
    )]
    pub adapter_vault: Account<'info, TokenAccount>,

    /// CHECK: Canonical adapter vault authority PDA.
    #[account(
        constraint = adapter_validation::is_adapter_vault_authority(
            &adapter_vault_authority.to_account_info(),
            &adapter_program.key(),
        ) @ DispatcherError::AdapterCpiError,
    )]
    pub adapter_vault_authority: UncheckedAccount<'info>,

    /// CHECK: Canonical adapter user position PDA.
    #[account(
        mut,
        constraint = adapter_validation::is_adapter_user_position(
            &adapter_user_position.to_account_info(),
            &adapter_program.key(),
            &user.key(),
        ) @ DispatcherError::AdapterCpiError,
    )]
    pub adapter_user_position: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Withdraw>, shares: u64, min_underlying_out: u64) -> Result<()> {
    require!(shares > 0, DispatcherError::ZeroAmount);

    let position = &ctx.accounts.user_position;
    require!(
        position.receipt_token_balance >= shares,
        DispatcherError::AdapterCpiError
    );

    let clock = Clock::get()?;

    cpi_withdraw(
        AdapterWithdrawAccounts {
            adapter_program: ctx.accounts.adapter_program.to_account_info(),
            user: ctx.accounts.user.to_account_info(),
            vault_state: ctx.accounts.adapter_vault_state.to_account_info(),
            user_position: ctx.accounts.adapter_user_position.to_account_info(),
            user_token_account: ctx.accounts.user_token_account.to_account_info(),
            vault_token_account: ctx.accounts.adapter_vault.to_account_info(),
            vault_authority: ctx.accounts.adapter_vault_authority.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        },
        shares,
        min_underlying_out,
    )?;

    let position = &mut ctx.accounts.user_position;
    position.withdrawn_amount = position
        .withdrawn_amount
        .checked_add(shares)
        .ok_or(DispatcherError::AdapterCpiError)?;
    position.receipt_token_balance = position
        .receipt_token_balance
        .checked_sub(shares)
        .ok_or(DispatcherError::AdapterCpiError)?;
    position.last_updated = clock.unix_timestamp;

    let state = &mut ctx.accounts.dispatcher_state;
    state.total_withdrawals = state
        .total_withdrawals
        .checked_add(1)
        .ok_or(DispatcherError::AdapterCpiError)?;

    emit!(DispatchWithdrawEvent {
        user: ctx.accounts.user.key(),
        adapter_program_id: ctx.accounts.adapter_program.key(),
        amount: shares,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Withdraw CPI: {} shares from {}",
        shares,
        ctx.accounts.adapter_program.key()
    );

    Ok(())
}
