use anchor_lang::prelude::*;
use crate::state::AdapterPosition;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use yield_adapter_trait::{
    user_position_underlying_value, WithdrawEvent, YieldAdapterError,
    ADAPTER_POSITION_SEED,
};

use crate::protocol;
use crate::state::{KaminoVaultState, VAULT_AUTHORITY_SEED, VAULT_STATE_SEED};

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_STATE_SEED],
        bump = vault_state.bump,
        constraint = vault_state.status.can_withdraw() @ YieldAdapterError::AdapterNotActive,
    )]
    pub vault_state: Account<'info, KaminoVaultState>,

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

pub fn handler<'a>(ctx: Context<'a, Withdraw<'a>>, shares_to_burn: u64) -> Result<()> {
    require!(shares_to_burn > 0, YieldAdapterError::ZeroWithdrawAmount);

    let vault = &mut ctx.accounts.vault_state;
    let position = &mut ctx.accounts.user_position;

    require!(
        position.receipt_token_balance >= shares_to_burn,
        YieldAdapterError::InsufficientReceiptBalance
    );

    let underlying_amount =
        user_position_underlying_value(shares_to_burn, vault.total_underlying, vault.total_shares)?;

    let clock = Clock::get()?;
    let bump = ctx.bumps.vault_authority;
    let signer_seeds: &[&[&[u8]]] = &[&[VAULT_AUTHORITY_SEED, &[bump]]];

    protocol::on_withdraw(
        vault,
        &ctx.accounts.vault_authority.to_account_info(),
        &ctx.accounts.token_program.to_account_info(),
        underlying_amount,
        ctx.remaining_accounts,
        bump,
    )?;

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

    emit!(WithdrawEvent {
        user: ctx.accounts.user.key(),
        adapter: crate::ID,
        amount: underlying_amount,
        receipt_burned: shares_to_burn,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Kamino withdraw: {} shares -> {} USDC",
        shares_to_burn,
        underlying_amount
    );

    Ok(())
}
