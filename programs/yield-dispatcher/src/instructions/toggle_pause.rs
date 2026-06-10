use anchor_lang::prelude::*;

use crate::error::DispatcherError;
use crate::state::{DispatcherState, DISPATCHER_STATE_SEED};

#[derive(Accounts)]
pub struct TogglePause<'info> {
    /// Must be the dispatcher authority.
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [DISPATCHER_STATE_SEED],
        bump = dispatcher_state.bump,
        constraint = dispatcher_state.authority == authority.key() @ DispatcherError::Unauthorized,
    )]
    pub dispatcher_state: Account<'info, DispatcherState>,
}

/// Toggle the dispatcher pause state. When paused, all deposit/withdraw routing is blocked.
pub fn handler(ctx: Context<TogglePause>) -> Result<()> {
    let state = &mut ctx.accounts.dispatcher_state;

    state.is_paused = !state.is_paused;

    msg!(
        "Dispatcher {}",
        if state.is_paused { "paused" } else { "resumed" }
    );

    Ok(())
}
