use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use yield_adapter_trait::{
    shares_for_deposit, DepositEvent, YieldAdapterError,
    ADAPTER_POSITION_SEED,
};

use crate::protocol;
use crate::state::{AdapterPosition, TemplateVaultState, VAULT_AUTHORITY_SEED, VAULT_STATE_SEED};

#[derive(Accounts)]
pub struct Deposit<'info> {
    /// The user making the deposit.
    #[account(mut)]
    pub user: Signer<'info>,

    /// Vault state — must be Active and use the canonical vault PDA.
    #[account(
        mut,
        seeds = [VAULT_STATE_SEED],
        bump = vault_state.bump,
        constraint = vault_state.status.can_deposit() @ YieldAdapterError::AdapterNotActive,
    )]
    pub vault_state: Account<'info, TemplateVaultState>,

    /// Per-user position tracking account. Created on first deposit.
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + AdapterPosition::INIT_SPACE,
        seeds = [ADAPTER_POSITION_SEED, user.key().as_ref()],
        bump,
    )]
    pub user_position: Account<'info, AdapterPosition>,

    /// User's associated token account for the underlying mint.
    #[account(
        mut,
        constraint = user_token_account.owner == user.key(),
        constraint = user_token_account.mint == vault_state.underlying_mint @ YieldAdapterError::MintMismatch,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    /// CHECK: Vault authority PDA — signs for protocol CPI and vault token transfers.
    #[account(seeds = [VAULT_AUTHORITY_SEED], bump)]
    pub vault_authority: UncheckedAccount<'info>,

    /// Vault's token account holding the underlying tokens.
    #[account(
        mut,
        constraint = vault_token_account.mint == vault_state.underlying_mint @ YieldAdapterError::MintMismatch,
        constraint = vault_token_account.owner == vault_authority.key() @ YieldAdapterError::Unauthorized,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler<'a>(ctx: Context<'a, Deposit<'a>>, amount: u64) -> Result<()> {
    require!(amount > 0, YieldAdapterError::ZeroDepositAmount);

    let vault = &mut ctx.accounts.vault_state;
    let clock = Clock::get()?;

    // Compute how many shares the user receives for their deposit.
    let shares = shares_for_deposit(amount, vault.total_underlying, vault.total_shares)?;

    // Transfer underlying tokens from user → vault.
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

    // Update vault accounting.
    vault.total_underlying = vault
        .total_underlying
        .checked_add(amount)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?;
    vault.total_shares = vault
        .total_shares
        .checked_add(shares)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?;

    // Route deposit to the external protocol (conditional CPI).
    protocol::on_deposit(
        vault,
        &ctx.accounts.vault_authority.to_account_info(),
        &ctx.accounts.vault_token_account.to_account_info(),
        &ctx.accounts.token_program.to_account_info(),
        amount,
        ctx.remaining_accounts,
        ctx.bumps.vault_authority,
    )?;

    // Initialize or update the user position.
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
        "Template deposit: {} underlying -> {} shares (routed: {})",
        amount,
        shares,
        vault.protocol_routed_underlying,
    );

    Ok(())
}
