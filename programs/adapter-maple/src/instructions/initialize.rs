use crate::state::{MapleVaultState, VAULT_AUTHORITY_SEED, VAULT_STATE_SEED, VAULT_SYRUP_SEED};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use yield_adapter_trait::VaultStatus;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + MapleVaultState::INIT_SPACE,
        seeds = [VAULT_STATE_SEED],
        bump,
    )]
    pub vault_state: Account<'info, MapleVaultState>,
    /// CHECK: vault authority PDA
    #[account(seeds = [VAULT_AUTHORITY_SEED], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub underlying_mint: InterfaceAccount<'info, Mint>,
    pub syrup_mint: InterfaceAccount<'info, Mint>,
    #[account(
        init_if_needed,
        payer = authority,
        seeds = [VAULT_SYRUP_SEED],
        bump,
        token::mint = syrup_mint,
        token::authority = vault_authority,
        token::token_program = token_program,
    )]
    pub vault_syrup: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>, underlying_mint: Pubkey) -> Result<()> {
    let state = &mut ctx.accounts.vault_state;
    if state.authority == Pubkey::default() {
        state.authority = ctx.accounts.authority.key();
        state.underlying_mint = underlying_mint;
        state.syrup_mint = ctx.accounts.syrup_mint.key();
        state.total_underlying = 0;
        state.total_shares = 0;
        state.protocol_program_id = crate::protocol::ORCA_ID;
        state.protocol_routed_underlying = 0;
        state.last_yield_sync_ts = 0;
        state.status = VaultStatus::Active;
        state.bump = ctx.bumps.vault_state;
        state.vault_syrup_bump = ctx.bumps.vault_syrup;
        msg!(
            "Maple Syrup adapter initialized. USDC mint: {}, syrupUSDC mint: {}",
            underlying_mint,
            ctx.accounts.syrup_mint.key()
        );
    }
    Ok(())
}
