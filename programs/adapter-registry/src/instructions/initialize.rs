use anchor_lang::prelude::*;

use crate::state::{RegistryState, REGISTRY_STATE_SEED};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + RegistryState::INIT_SPACE,
        seeds = [REGISTRY_STATE_SEED],
        bump,
    )]
    pub registry_state: Account<'info, RegistryState>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>) -> Result<()> {
    let state = &mut ctx.accounts.registry_state;

    state.authority = ctx.accounts.authority.key();
    state.pending_authority = None;
    state.total_proposed = 0;
    state.total_approved = 0;
    state.bump = ctx.bumps.registry_state;

    msg!("Registry initialized. Authority: {}", state.authority);

    Ok(())
}
