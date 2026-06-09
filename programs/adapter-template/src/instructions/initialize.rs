use anchor_lang::prelude::*;

use crate::state::{TemplateVaultState, VAULT_STATE_SEED};
use crate::EXTERNAL_PROGRAM_ID;
use yield_adapter_trait::VaultStatus;

#[derive(Accounts)]
pub struct Initialize<'info> {
    /// The vault authority who will own and manage this vault.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The vault state PDA that stores vault configuration and accounting.
    /// Initialized once per vault deployment.
    #[account(
        init,
        payer = authority,
        space = 8 + TemplateVaultState::INIT_SPACE,
        seeds = [VAULT_STATE_SEED],
        bump,
    )]
    pub vault_state: Account<'info, TemplateVaultState>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>, underlying_mint: Pubkey) -> Result<()> {
    let state = &mut ctx.accounts.vault_state;
    state.authority = ctx.accounts.authority.key();
    state.underlying_mint = underlying_mint;
    state.total_underlying = 0;
    state.total_shares = 0;
    state.protocol_program_id = EXTERNAL_PROGRAM_ID;
    state.protocol_routed_underlying = 0;
    state.last_yield_sync_ts = 0;
    state.status = VaultStatus::Active;
    state.bump = ctx.bumps.vault_state;

    msg!(
        "Template adapter initialized. Mint: {}, protocol: {}",
        underlying_mint,
        EXTERNAL_PROGRAM_ID
    );
    Ok(())
}
