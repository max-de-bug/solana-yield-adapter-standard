use anchor_lang::prelude::*;

use crate::events::DispatcherInitializedEvent;
use crate::state::{DispatcherState, DISPATCHER_STATE_SEED};

/// Accounts required to initialize the dispatcher.
#[derive(Accounts)]
pub struct Initialize<'info> {
    /// The governance authority who will control this dispatcher.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The dispatcher state PDA — created on first call.
    #[account(
        init,
        payer = authority,
        space = 8 + DispatcherState::INIT_SPACE,
        seeds = [DISPATCHER_STATE_SEED],
        bump,
    )]
    pub dispatcher_state: Account<'info, DispatcherState>,

    /// The adapter registry program that this dispatcher will trust.
    /// CHECK: We only store its ID; no deserialization needed.
    pub registry_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

/// Initialize the dispatcher with a governance authority and registry reference.
pub fn handler(ctx: Context<Initialize>) -> Result<()> {
    let state = &mut ctx.accounts.dispatcher_state;

    state.authority = ctx.accounts.authority.key();
    state.registry_program_id = ctx.accounts.registry_program.key();
    state.total_deposits = 0;
    state.total_withdrawals = 0;
    state.is_paused = false;
    state.bump = ctx.bumps.dispatcher_state;

    let clock = Clock::get()?;

    emit!(DispatcherInitializedEvent {
        authority: state.authority,
        registry_program_id: state.registry_program_id,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Dispatcher initialized. Authority: {}. Registry: {}.",
        state.authority,
        state.registry_program_id
    );

    Ok(())
}
