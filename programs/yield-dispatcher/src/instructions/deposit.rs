use adapter_registry::program::AdapterRegistry;
use adapter_registry::state::{AdapterEntry, AdapterStatus, ADAPTER_ENTRY_SEED};
use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::adapter_cpi::{cpi_deposit, AdapterDepositAccounts};
use crate::adapter_validation;
use crate::error::DispatcherError;
use crate::events::DispatchDepositEvent;
use crate::state::{DispatcherState, UserPosition, DISPATCHER_STATE_SEED, USER_POSITION_SEED};

/// Accounts required for a deposit through the dispatcher.
#[derive(Accounts)]
pub struct Deposit<'info> {
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
        init_if_needed,
        payer = user,
        space = 8 + UserPosition::INIT_SPACE,
        seeds = [USER_POSITION_SEED, user.key().as_ref(), adapter_program.key().as_ref()],
        bump,
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

    /// CHECK: Must match the approved adapter entry and be an executable program.
    #[account(
        constraint = adapter_program.key() == adapter_entry.adapter_program_id,
        constraint = adapter_program.executable,
    )]
    pub adapter_program: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = user_token_account.owner == user.key(),
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    /// CHECK: Canonical adapter vault state PDA for this program.
    #[account(
        mut,
        constraint = adapter_validation::is_adapter_vault_state(
            &adapter_vault_state.to_account_info(),
            &adapter_entry.vault_state_seed,
            &adapter_program.key(),
        ) @ DispatcherError::AdapterCpiError,
    )]
    pub adapter_vault_state: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = adapter_vault.owner == adapter_vault_authority.key()
            @ DispatcherError::AdapterCpiError,
    )]
    pub adapter_vault: Account<'info, TokenAccount>,

    /// CHECK: Canonical adapter vault authority PDA.
    #[account(
        constraint = adapter_validation::is_adapter_vault_authority(
            &adapter_vault_authority.to_account_info(),
            &adapter_entry.vault_authority_seed,
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
    pub system_program: Program<'info, System>,
}

/// Route a deposit through the dispatcher to an approved adapter via CPI.
pub fn handler(ctx: Context<Deposit>, amount: u64, min_shares_out: u64) -> Result<()> {
    require!(amount > 0, DispatcherError::ZeroAmount);

    let clock = Clock::get()?;
    let shares_minted = cpi_deposit(
        AdapterDepositAccounts {
            adapter_program: ctx.accounts.adapter_program.to_account_info(),
            user: ctx.accounts.user.to_account_info(),
            vault_state: ctx.accounts.adapter_vault_state.to_account_info(),
            user_position: ctx.accounts.adapter_user_position.to_account_info(),
            user_token_account: ctx.accounts.user_token_account.to_account_info(),
            vault_token_account: ctx.accounts.adapter_vault.to_account_info(),
            vault_authority: ctx.accounts.adapter_vault_authority.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
        },
        amount,
        min_shares_out,
    )?;

    let position = &mut ctx.accounts.user_position;
    if position.owner == Pubkey::default() {
        position.owner = ctx.accounts.user.key();
        position.adapter_program_id = ctx.accounts.adapter_program.key();
        position.bump = ctx.bumps.user_position;
    }

    position.deposited_amount = position
        .deposited_amount
        .checked_add(amount)
        .ok_or(DispatcherError::AdapterCpiError)?;
    position.receipt_token_balance = position
        .receipt_token_balance
        .checked_add(shares_minted)
        .ok_or(DispatcherError::AdapterCpiError)?;
    position.last_updated = clock.unix_timestamp;

    let state = &mut ctx.accounts.dispatcher_state;
    state.total_deposits = state
        .total_deposits
        .checked_add(1)
        .ok_or(DispatcherError::AdapterCpiError)?;

    emit!(DispatchDepositEvent {
        user: ctx.accounts.user.key(),
        adapter_program_id: ctx.accounts.adapter_program.key(),
        amount,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Deposit CPI: {} underlying -> {} shares via {}",
        amount,
        shares_minted,
        ctx.accounts.adapter_program.key()
    );

    Ok(())
}
