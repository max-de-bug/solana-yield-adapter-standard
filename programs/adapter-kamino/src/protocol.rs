use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::Instruction, program::invoke_signed};
use yield_adapter_trait::YieldAdapterError;

use crate::state::{KaminoVaultState, VAULT_AUTHORITY_SEED};
use crate::KAMINO_LEND_ID;

/// Discriminator for Kamino K-Lend `deposit_reserve_liquidity`.
/// SHA256("global:deposit_reserve_liquidity")[..8] = a9c91e7e06cd6644
const KAMINO_DEPOSIT_RESERVE_LIQUIDITY: [u8; 8] = [0xa9, 0xc9, 0x1e, 0x7e, 0x06, 0xcd, 0x66, 0x44];

/// Discriminator for Kamino K-Lend `withdraw_reserve_liquidity`.
/// SHA256("global:withdraw_reserve_liquidity")[..8] = 00174d97e0646770
const KAMINO_WITHDRAW_RESERVE_LIQUIDITY: [u8; 8] = [0x00, 0x17, 0x4d, 0x97, 0xe0, 0x64, 0x67, 0x70];

/// Expected remaining accounts for deposit:
///   [0] reserve (writable)
///   [1] reserve_liquidity_vault (writable)
///   [2] reserve_collateral_mint (writable)
///   [3] collateral_receiver (writable) — vault authority's kToken ATA
///   [4] reserve_liquidity_fee_receiver (writable)
///   [5] instruction_sysvar_account (unchecked)
///
/// vault_authority (signer), vault_token_account (liquidity_supply_receiver),
/// and token_program are passed from the instruction context.
pub fn on_deposit<'info>(
    vault: &mut KaminoVaultState,
    vault_authority: &AccountInfo<'info>,
    vault_token_account: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    amount: u64,
    remaining: &[AccountInfo<'info>],
    vault_authority_bump: u8,
) -> Result<()> {
    if remaining.len() >= 6 {
        let reserve = &remaining[0];
        let reserve_liquidity_vault = &remaining[1];
        let reserve_collateral_mint = &remaining[2];
        let collateral_receiver = &remaining[3];
        let reserve_liquidity_fee_receiver = &remaining[4];
        let instruction_sysvar = &remaining[5];

        let seed: &[&[u8]] = &[VAULT_AUTHORITY_SEED, &[vault_authority_bump]];
        let signer_seeds: &[&[&[u8]]] = &[seed];

        let instruction = Instruction {
            program_id: KAMINO_LEND_ID,
            accounts: vec![
                AccountMeta::new(vault_authority.key(), true),
                AccountMeta::new(reserve.key(), false),
                AccountMeta::new(reserve_liquidity_vault.key(), false),
                AccountMeta::new(reserve_collateral_mint.key(), false),
                AccountMeta::new(vault_token_account.key(), false),
                AccountMeta::new(collateral_receiver.key(), false),
                AccountMeta::new(reserve_liquidity_fee_receiver.key(), false),
                AccountMeta::new_readonly(instruction_sysvar.key(), false),
                AccountMeta::new_readonly(token_program.key(), false),
            ],
            data: [KAMINO_DEPOSIT_RESERVE_LIQUIDITY.as_slice(), &amount.to_le_bytes()].concat(),
        };

        let account_infos = [
            vault_authority.clone(),
            reserve.clone(),
            reserve_liquidity_vault.clone(),
            reserve_collateral_mint.clone(),
            vault_token_account.clone(),
            collateral_receiver.clone(),
            reserve_liquidity_fee_receiver.clone(),
            instruction_sysvar.clone(),
            token_program.clone(),
        ];

        invoke_signed(&instruction, &account_infos, signer_seeds)?;
    }

    vault.protocol_routed_underlying = vault
        .protocol_routed_underlying
        .checked_add(amount)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?;

    Ok(())
}

/// Expected remaining accounts for withdraw:
///   [0] reserve (writable)
///   [1] reserve_collateral_mint (writable)
///   [2] reserve_liquidity_vault (writable)
///   [3] collateral_source (writable) — vault authority's kToken ATA
///   [4] withdraw_destination (writable) — receives USDC back
///   [5] reserve_liquidity_fee_receiver (writable)
///   [6] instruction_sysvar_account (unchecked)
///
/// vault_authority (signer) and token_program are passed from the instruction context.
pub fn on_withdraw<'info>(
    vault: &mut KaminoVaultState,
    vault_authority: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    amount: u64,
    remaining: &[AccountInfo<'info>],
    vault_authority_bump: u8,
) -> Result<()> {
    if remaining.len() >= 7 {
        let reserve = &remaining[0];
        let reserve_collateral_mint = &remaining[1];
        let reserve_liquidity_vault = &remaining[2];
        let collateral_source = &remaining[3];
        let withdraw_destination = &remaining[4];
        let reserve_liquidity_fee_receiver = &remaining[5];
        let instruction_sysvar = &remaining[6];

        let seed: &[&[u8]] = &[VAULT_AUTHORITY_SEED, &[vault_authority_bump]];
        let signer_seeds: &[&[&[u8]]] = &[seed];

        let instruction = Instruction {
            program_id: KAMINO_LEND_ID,
            accounts: vec![
                AccountMeta::new(vault_authority.key(), true),
                AccountMeta::new(reserve.key(), false),
                AccountMeta::new(reserve_collateral_mint.key(), false),
                AccountMeta::new(reserve_liquidity_vault.key(), false),
                AccountMeta::new(collateral_source.key(), false),
                AccountMeta::new(withdraw_destination.key(), false),
                AccountMeta::new(reserve_liquidity_fee_receiver.key(), false),
                AccountMeta::new_readonly(instruction_sysvar.key(), false),
                AccountMeta::new_readonly(token_program.key(), false),
            ],
            data: [KAMINO_WITHDRAW_RESERVE_LIQUIDITY.as_slice(), &amount.to_le_bytes()].concat(),
        };

        let account_infos = [
            vault_authority.clone(),
            reserve.clone(),
            reserve_collateral_mint.clone(),
            reserve_liquidity_vault.clone(),
            collateral_source.clone(),
            withdraw_destination.clone(),
            reserve_liquidity_fee_receiver.clone(),
            instruction_sysvar.clone(),
            token_program.clone(),
        ];

        invoke_signed(&instruction, &account_infos, signer_seeds)?;
    }

    vault.protocol_routed_underlying = vault
        .protocol_routed_underlying
        .checked_sub(amount)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?;

    Ok(())
}

/// Verifies the first remaining account is the Kamino K-Lend program.
pub fn before_value_query(_vault: &KaminoVaultState, remaining: &[AccountInfo]) -> Result<()> {
    if !remaining.is_empty() {
        let program = &remaining[0];
        require!(
            program.key() == KAMINO_LEND_ID,
            YieldAdapterError::AdapterProgramMismatch
        );
        require!(program.executable, YieldAdapterError::ProtocolCpiError);
    }
    Ok(())
}
