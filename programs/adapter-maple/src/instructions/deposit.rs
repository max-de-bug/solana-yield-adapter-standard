use crate::state::AdapterPosition;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use yield_adapter_trait::{
    shares_for_deposit, DepositEvent, YieldAdapterError, ADAPTER_POSITION_SEED,
};

use crate::protocol;
use crate::state::{MapleVaultState, VAULT_AUTHORITY_SEED, VAULT_STATE_SEED};

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_STATE_SEED],
        bump = vault_state.bump,
        constraint = vault_state.status.can_deposit() @ YieldAdapterError::AdapterNotActive,
    )]
    pub vault_state: Account<'info, MapleVaultState>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + AdapterPosition::INIT_SPACE,
        seeds = [ADAPTER_POSITION_SEED, user.key().as_ref()],
        bump,
    )]
    pub user_position: Account<'info, AdapterPosition>,

    #[account(
        mut,
        constraint = user_token_account.owner == user.key(),
        constraint = user_token_account.mint == vault_state.underlying_mint @ YieldAdapterError::MintMismatch,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    /// CHECK: Vault authority PDA; marked mut for Orca swap CPI.
    #[account(mut, seeds = [VAULT_AUTHORITY_SEED], bump)]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = vault_token_account.mint == vault_state.underlying_mint @ YieldAdapterError::MintMismatch,
        constraint = vault_token_account.owner == vault_authority.key() @ YieldAdapterError::Unauthorized,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler<'a>(ctx: Context<'a, Deposit<'a>>, amount: u64, min_shares_out: u64) -> Result<()> {
    require!(amount > 0, YieldAdapterError::ZeroDepositAmount);

    let vault = &mut ctx.accounts.vault_state;
    let clock = Clock::get()?;

    let shares = shares_for_deposit(amount, vault.total_underlying, vault.total_shares)?;

    require!(
        shares >= min_shares_out,
        YieldAdapterError::SlippageExceeded
    );

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.user_token_account.to_account_info(),
                to: ctx.accounts.vault_token_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
    )?;

    vault.total_underlying = vault
        .total_underlying
        .checked_add(amount)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?;
    vault.total_shares = vault
        .total_shares
        .checked_add(shares)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?;

    protocol::on_deposit(
        vault,
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.vault_authority.to_account_info(),
        &ctx.accounts.vault_token_account.to_account_info(),
        amount,
        ctx.remaining_accounts,
        ctx.bumps.vault_authority,
    )?;

    let position = &mut ctx.accounts.user_position;
    if position.owner == Pubkey::default() {
        position.owner = ctx.accounts.user.key();
        position.adapter_program_id = crate::ID;
        position.bump = ctx.bumps.user_position;
    }
    position.deposited_amount = position
        .deposited_amount
        .checked_add(amount)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?;
    position.receipt_token_balance = position
        .receipt_token_balance
        .checked_add(shares)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?;
    position.last_updated = clock.unix_timestamp;

    emit!(DepositEvent {
        user: ctx.accounts.user.key(),
        adapter: crate::ID,
        amount,
        receipt_amount: shares,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Maple Syrup deposit: {} USDC -> {} shares (routed: {})",
        amount,
        shares,
        vault.protocol_routed_underlying
    );

    Ok(())
}
