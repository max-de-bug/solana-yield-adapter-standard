use crate::state::AdapterPosition;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use yield_adapter_trait::{
    user_position_underlying_value, WithdrawEvent, YieldAdapterError, ADAPTER_POSITION_SEED,
};

use crate::protocol;
use crate::state::{DriftVaultState, DriftWithdrawalTicket, TICKET_SEED, VAULT_AUTHORITY_SEED, VAULT_STATE_SEED};
use crate::instructions::withdraw::DriftAdapterError;

#[derive(Accounts)]
pub struct SettleWithdrawal<'info> {
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

    #[account(
        mut,
        close = user,
        seeds = [TICKET_SEED, user_position.key().as_ref()],
        bump = ticket.bump,
        constraint = !ticket.is_settled @ DriftAdapterError::NoPendingTicket,
    )]
    pub ticket: Account<'info, DriftWithdrawalTicket>,

    #[account(
        mut,
        constraint = user_token_account.owner == user.key(),
        constraint = user_token_account.mint == vault_state.underlying_mint @ YieldAdapterError::MintMismatch,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = vault_token_account.mint == vault_state.underlying_mint @ YieldAdapterError::MintMismatch,
        constraint = vault_token_account.owner == vault_authority.key() @ YieldAdapterError::Unauthorized,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    /// CHECK: Vault authority PDA.
    #[account(seeds = [VAULT_AUTHORITY_SEED], bump)]
    pub vault_authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn handler<'a>(
    ctx: Context<'a, SettleWithdrawal<'a>>,
) -> Result<()> {
    let vault = &mut ctx.accounts.vault_state;
    let position = &mut ctx.accounts.user_position;
    let ticket = &ctx.accounts.ticket;
    let clock = Clock::get()?;

    require!(
        clock.unix_timestamp >= ticket.unlock_ts,
        DriftAdapterError::CooldownNotElapsed
    );

    let underlying_amount = user_position_underlying_value(
        ticket.shares,
        vault.total_underlying,
        vault.total_shares,
    )?;

    require!(
        underlying_amount >= ticket.min_amount_out,
        YieldAdapterError::SlippageExceeded
    );

    let bump = ctx.bumps.vault_authority;
    let signer_seeds: &[&[&[u8]]] = &[&[VAULT_AUTHORITY_SEED, &[bump]]];

    protocol::on_withdraw(
        vault,
        &ctx.accounts.vault_authority.to_account_info(),
        &ctx.accounts.vault_token_account.to_account_info(),
        underlying_amount,
        ctx.remaining_accounts,
        bump,
    )?;

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            signer_seeds,
        ),
        underlying_amount,
    )?;

    vault.total_underlying = vault
        .total_underlying
        .checked_sub(underlying_amount)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?;
    vault.total_shares = vault
        .total_shares
        .checked_sub(ticket.shares)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?;

    position.withdrawn_amount = position
        .withdrawn_amount
        .checked_add(underlying_amount)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?;
    position.last_updated = clock.unix_timestamp;

    emit!(WithdrawEvent {
        user: ctx.accounts.user.key(),
        adapter: crate::ID,
        amount: underlying_amount,
        receipt_burned: ticket.shares,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Drift IF unstake settle: {} shares -> {} USDC (after cooldown)",
        ticket.shares,
        underlying_amount
    );

    Ok(())
}
