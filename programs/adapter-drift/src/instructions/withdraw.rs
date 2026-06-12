use crate::state::AdapterPosition;
use anchor_lang::prelude::*;
use anchor_spl::token::Token;
use yield_adapter_trait::{
    user_position_underlying_value, YieldAdapterError, ADAPTER_POSITION_SEED,
};

use crate::state::{DriftVaultState, DriftWithdrawalTicket, TICKET_SEED, VAULT_STATE_SEED};

/// Custom error for Drift-specific cooldown enforcement.
#[error_code]
pub enum DriftAdapterError {
    /// The unstaking cooldown period has not elapsed.
    #[msg("Unstaking cooldown has not elapsed (13 days required)")]
    CooldownNotElapsed = 7000,
    /// A pending withdrawal ticket already exists for this position.
    #[msg("A pending withdrawal ticket already exists for this position")]
    TicketAlreadyExists = 7001,
    /// No pending ticket found for this position.
    #[msg("No pending withdrawal ticket found for this position")]
    NoPendingTicket = 7002,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_STATE_SEED],
        bump = vault_state.bump,
        constraint = vault_state.status.can_withdraw() @ YieldAdapterError::AdapterNotActive,
    )]
    pub vault_state: Account<'info, DriftVaultState>,

    #[account(
        mut,
        seeds = [ADAPTER_POSITION_SEED, user.key().as_ref()],
        bump = user_position.bump,
        constraint = user_position.owner == user.key() @ YieldAdapterError::Unauthorized,
    )]
    pub user_position: Account<'info, AdapterPosition>,

    /// The withdrawal ticket (initialized in the request phase).
    #[account(
        init,
        payer = user,
        space = 8 + std::mem::size_of::<DriftWithdrawalTicket>(),
        seeds = [TICKET_SEED, user_position.key().as_ref()],
        bump,
    )]
    pub ticket: Account<'info, DriftWithdrawalTicket>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler<'a>(
    ctx: Context<'a, Withdraw<'a>>,
    shares_to_burn: u64,
    min_underlying_out: u64,
) -> Result<()> {
    require!(shares_to_burn > 0, YieldAdapterError::ZeroWithdrawAmount);

    let vault = &ctx.accounts.vault_state;
    let position_key = ctx.accounts.user_position.key();
    let position = &mut ctx.accounts.user_position;
    let clock = Clock::get()?;

    require!(
        position.receipt_token_balance >= shares_to_burn,
        YieldAdapterError::InsufficientReceiptBalance
    );

    // Estimate underlying at request time for slippage protection.
    let estimated_underlying = user_position_underlying_value(
        shares_to_burn,
        vault.total_underlying,
        vault.total_shares,
    )?;
    require!(
        estimated_underlying >= min_underlying_out,
        YieldAdapterError::SlippageExceeded
    );

    let unlock_ts = if vault.unstake_cooldown_seconds > 0 {
        clock.unix_timestamp
            .checked_add(vault.unstake_cooldown_seconds)
            .ok_or(YieldAdapterError::ArithmeticOverflow)?
    } else {
        clock.unix_timestamp
    };

    let ticket = &mut ctx.accounts.ticket;
    ticket.position = position_key;
    ticket.shares = shares_to_burn;
    ticket.min_amount_out = min_underlying_out;
    ticket.unlock_ts = unlock_ts;
    ticket.is_settled = false;
    ticket.created_ts = clock.unix_timestamp;
    ticket.bump = ctx.bumps.ticket;

    position.receipt_token_balance = position
        .receipt_token_balance
        .checked_sub(shares_to_burn)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?;
    position.last_withdraw_request = clock.unix_timestamp;

    msg!(
        "Drift IF unstake request: {} shares locked, unlock at ts={} (cooldown: {}s)",
        shares_to_burn,
        unlock_ts,
        vault.unstake_cooldown_seconds
    );

    Ok(())
}
