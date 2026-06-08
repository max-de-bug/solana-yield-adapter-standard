use anchor_lang::prelude::*;

use crate::state::{KaminoVaultState, VAULT_STATE_SEED};
use crate::KAMINO_LEND_ID;
use yield_adapter_trait::VaultStatus;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + KaminoVaultState::INIT_SPACE,
        seeds = [VAULT_STATE_SEED],
        bump,
    )]
    pub vault_state: Account<'info, KaminoVaultState>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>, underlying_mint: Pubkey) -> Result<()> {
    let state = &mut ctx.accounts.vault_state;
    state.authority = ctx.accounts.authority.key();
    state.underlying_mint = underlying_mint;
    state.total_underlying = 0;
    state.total_shares = 0;
    state.protocol_program_id = KAMINO_LEND_ID;
    state.protocol_routed_underlying = 0;
    state.last_yield_sync_ts = 0;
    state.status = VaultStatus::Active.as_u8();
    state.bump = ctx.bumps.vault_state;

    msg!(
        "Kamino adapter initialized. Mint: {}, protocol: {}",
        underlying_mint,
        KAMINO_LEND_ID
    );
    Ok(())
}
