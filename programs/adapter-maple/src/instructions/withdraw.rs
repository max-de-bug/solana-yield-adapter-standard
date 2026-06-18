use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};
use yield_adapter_trait::{WithdrawEvent, YieldAdapterError, ADAPTER_POSITION_SEED};

use crate::protocol;
use crate::state::{AdapterPosition, MapleVaultState, VAULT_AUTHORITY_SEED, VAULT_STATE_SEED};

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
    pub vault_state: Account<'info, MapleVaultState>,
    #[account(
        mut,
        seeds = [ADAPTER_POSITION_SEED, user.key().as_ref()],
        bump = user_position.bump,
        constraint = user_position.owner == user.key() @ YieldAdapterError::Unauthorized,
    )]
    pub user_position: Account<'info, AdapterPosition>,
    #[account(
        mut,
        constraint = user_token_account.mint == vault_state.underlying_mint @ YieldAdapterError::MintMismatch,
    )]
    pub user_token_account: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = vault_token_account.mint == vault_state.underlying_mint @ YieldAdapterError::MintMismatch,
        constraint = vault_token_account.owner == vault_authority.key() @ YieldAdapterError::Unauthorized,
    )]
    pub vault_token_account: Box<Account<'info, TokenAccount>>,
    /// CHECK: PDA delegated as token authority for swaps; marked mut for Orca swap CPI.
    #[account(mut, seeds = [VAULT_AUTHORITY_SEED], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn handler<'a>(
    ctx: Context<'a, Withdraw<'a>>,
    shares_to_burn: u64,
    min_underlying_out: u64,
) -> Result<()> {
    require!(shares_to_burn > 0, YieldAdapterError::ZeroWithdrawAmount);
    let vault = &mut ctx.accounts.vault_state;
    let position = &mut ctx.accounts.user_position;
    require!(
        position.receipt_token_balance >= shares_to_burn,
        YieldAdapterError::InsufficientReceiptBalance,
    );

    let underlying_amount = yield_adapter_trait::user_position_underlying_value(
        shares_to_burn,
        vault.total_underlying,
        vault.total_shares,
    )?;

    let clock = Clock::get()?;

    let usdc_received = protocol::on_withdraw(
        vault,
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.vault_authority.to_account_info(),
        &ctx.accounts.vault_token_account.to_account_info(),
        shares_to_burn,
        ctx.remaining_accounts,
        ctx.bumps.vault_authority,
    )?;

    require!(
        usdc_received >= min_underlying_out,
        YieldAdapterError::SlippageExceeded
    );

    let bump = ctx.bumps.vault_authority;
    let signer_seeds: &[&[&[u8]]] = &[&[VAULT_AUTHORITY_SEED, &[bump]]];

    anchor_spl::token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            anchor_spl::token::Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            signer_seeds,
        ),
        usdc_received,
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
        .checked_add(usdc_received)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?;
    position.last_updated = clock.unix_timestamp;

    emit!(WithdrawEvent {
        user: ctx.accounts.user.key(),
        adapter: crate::ID,
        amount: usdc_received,
        receipt_burned: shares_to_burn,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Maple withdraw: {} shares -> {} USDC (expected: {})",
        shares_to_burn,
        usdc_received,
        underlying_amount,
    );
    Ok(())
}
