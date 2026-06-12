use crate::state::AdapterPosition;
use anchor_lang::prelude::*;
use yield_adapter_trait::{YieldAdapterError, ADAPTER_POSITION_SEED};

use crate::state::{DriftWithdrawalTicket, TICKET_SEED};

#[derive(Accounts)]
pub struct CancelUnstake<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

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
        constraint = !ticket.is_settled @ crate::instructions::withdraw::DriftAdapterError::NoPendingTicket,
    )]
    pub ticket: Account<'info, DriftWithdrawalTicket>,
}

pub fn handler(ctx: Context<CancelUnstake>) -> Result<()> {
    let position = &mut ctx.accounts.user_position;
    let ticket = &ctx.accounts.ticket;

    // Return locked shares to the position
    position.receipt_token_balance = position
        .receipt_token_balance
        .checked_add(ticket.shares)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?;
    position.last_withdraw_request = 0;

    msg!(
        "Drift IF unstake cancelled: {} shares returned to position",
        ticket.shares
    );

    Ok(())
}
