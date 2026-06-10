use anchor_lang::prelude::*;

use crate::state::{MapleVaultState, VAULT_STATE_SEED};
use yield_adapter_trait::VaultStatus;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + MapleVaultState::INIT_SPACE,
        seeds = [VAULT_STATE_SEED],
        bump,
    )]
    pub vault_state: Account<'info, MapleVaultState>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>, underlying_mint: Pubkey) -> Result<()> {
    let state = &mut ctx.accounts.vault_state;
    state.authority = ctx.accounts.authority.key();
    state.underlying_mint = underlying_mint;
    state.total_underlying = 0;
    state.total_shares = 0;
    state.protocol_routed_underlying = 0;
    state.status = VaultStatus::Active;
    state.bump = ctx.bumps.vault_state;

    msg!("Maple Syrup adapter initialized. Mint: {}", underlying_mint,);
    Ok(())
}
