use anchor_lang::prelude::*;

use crate::state::{MarginfiVaultState, VAULT_STATE_SEED};
use crate::MARGINFI_V2_ID;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + MarginfiVaultState::INIT_SPACE,
        seeds = [VAULT_STATE_SEED],
        bump,
    )]
    pub vault_state: Account<'info, MarginfiVaultState>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>, underlying_mint: Pubkey) -> Result<()> {
    let state = &mut ctx.accounts.vault_state;
    state.authority = ctx.accounts.authority.key();
    state.underlying_mint = underlying_mint;
    state.total_underlying = 0;
    state.total_shares = 0;
    state.protocol_program_id = MARGINFI_V2_ID;
    state.protocol_routed_underlying = 0;
    state.last_yield_sync_ts = 0;
    state.is_active = true;
    state.bump = ctx.bumps.vault_state;

    msg!(
        "MarginFi adapter initialized. Mint: {}, protocol: {}",
        underlying_mint,
        MARGINFI_V2_ID
    );
    Ok(())
}
