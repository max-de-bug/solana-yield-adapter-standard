use anchor_lang::prelude::*;

use crate::state::{DriftVaultState, VAULT_STATE_SEED};
use crate::DRIFT_V2_ID;
use yield_adapter_trait::VaultStatus;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + DriftVaultState::INIT_SPACE,
        seeds = [VAULT_STATE_SEED],
        bump,
    )]
    pub vault_state: Account<'info, DriftVaultState>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>, underlying_mint: Pubkey) -> Result<()> {
    let state = &mut ctx.accounts.vault_state;
    state.authority = ctx.accounts.authority.key();
    state.underlying_mint = underlying_mint;
    state.total_underlying = 0;
    state.total_shares = 0;
    state.protocol_program_id = DRIFT_V2_ID;
    state.protocol_routed_underlying = 0;
    state.last_yield_sync_ts = 0;
    state.status = VaultStatus::Active;
    state.unstake_cooldown_seconds = crate::UNSTAKE_COOLDOWN_SECONDS;
    state.bump = ctx.bumps.vault_state;

    msg!(
        "Drift IF adapter initialized. Mint: {}, protocol: {}, cooldown: {}s",
        underlying_mint,
        DRIFT_V2_ID,
        state.unstake_cooldown_seconds
    );
    Ok(())
}
