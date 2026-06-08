use anchor_lang::prelude::*;
use crate::state::AdapterPosition;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use yield_adapter_trait::{
    user_position_underlying_value, WithdrawEvent, YieldAdapterError,
    ADAPTER_POSITION_SEED,
};

use crate::state::{DriftVaultState, VAULT_AUTHORITY_SEED, VAULT_STATE_SEED};
use crate::UNSTAKE_COOLDOWN_SECONDS;

/// Custom error for Drift-specific cooldown enforcement.
#[error_code]
pub enum DriftAdapterError {
    /// The unstaking cooldown period has not elapsed.
    #[msg("Unstaking cooldown has not elapsed (13 days required)")]
    CooldownNotElapsed = 7000,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_STATE_SEED],
        bump = vault_state.bump,
        constraint = vault_state.status.is_operational() @ YieldAdapterError::AdapterNotActive,
    )]
    pub vault_state: Account<'info, DriftVaultState>,

    #[account(
        mut,
        seeds = [ADAPTER_POSITION_SEED, user.key().as_ref()],
        bump = user_position.bump,
        constraint = user_position.owner == user.key() @ YieldAdapterError::Unauthorized,
    )]
    pub user_position: Account<'info, AdapterPosition>,

    #[account(
        mut,
        constraint = user_token_account.owner == user.key(),
        constraint = user_token_account.mint == vault_state.underlying_mint @ YieldAdapterError::MintMismatch,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = vault_token_account.mint == vault_state.underlying_mint @ YieldAdapterError::MintMismatch,
        constraint = vault_token_account.owner == vault_authority.key() @ YieldAdapterError::Unauthorized,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    /// CHECK: Vault authority PDA.
    #[account(seeds = [VAULT_AUTHORITY_SEED], bump)]
    pub vault_authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Withdraw>, shares_to_burn: u64) -> Result<()> {
    require!(shares_to_burn > 0, YieldAdapterError::ZeroWithdrawAmount);

    let vault = &mut ctx.accounts.vault_state;
    let position = &mut ctx.accounts.user_position;
    let clock = Clock::get()?;

    require!(
        position.receipt_token_balance >= shares_to_burn,
        YieldAdapterError::InsufficientReceiptBalance
    );

    if position.last_withdraw_request > 0 {
        let elapsed = clock
            .unix_timestamp
            .saturating_sub(position.last_withdraw_request);
        require!(
            elapsed >= UNSTAKE_COOLDOWN_SECONDS,
            DriftAdapterError::CooldownNotElapsed
        );
    }

    let underlying_amount =
        user_position_underlying_value(shares_to_burn, vault.total_underlying, vault.total_shares)?;

    let bump = ctx.bumps.vault_authority;
    let signer_seeds: &[&[&[u8]]] = &[&[VAULT_AUTHORITY_SEED, &[bump]]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            signer_seeds,
        ),
        underlying_amount,
    )?;

    vault.total_underlying = vault
        .total_underlying
        .checked_sub(underlying_amount)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?;
    vault.total_shares = vault
        .total_shares
        .checked_sub(shares_to_burn)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?;

    position.receipt_token_balance = position
        .receipt_token_balance
        .checked_sub(shares_to_burn)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?;
    position.withdrawn_amount = position
        .withdrawn_amount
        .checked_add(underlying_amount)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?;
    position.last_updated = clock.unix_timestamp;
    position.last_withdraw_request = clock.unix_timestamp;

    emit!(WithdrawEvent {
        user: ctx.accounts.user.key(),
        adapter: crate::ID,
        amount: underlying_amount,
        receipt_burned: shares_to_burn,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Drift IF unstake: {} shares -> {} USDC (per-user cooldown set)",
        shares_to_burn,
        underlying_amount
    );

    Ok(())
}
