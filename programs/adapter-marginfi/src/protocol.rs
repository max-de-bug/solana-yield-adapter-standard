use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::Instruction, program::invoke_signed};
use yield_adapter_trait::YieldAdapterError;

use crate::state::{MarginfiVaultState, VAULT_AUTHORITY_SEED};
use crate::MARGINFI_V2_ID;

/// Discriminator for MarginFi v2 `lending_account_deposit`.
/// SHA256("global:lending_account_deposit")[..8]
const MARGINFI_LENDING_ACCOUNT_DEPOSIT: [u8; 8] = [0xab, 0x5e, 0xeb, 0x67, 0x52, 0x40, 0xd4, 0x8c];

/// Discriminator for MarginFi v2 `lending_account_withdraw`.
/// SHA256("global:lending_account_withdraw")[..8]
const MARGINFI_LENDING_ACCOUNT_WITHDRAW: [u8; 8] = [0x24, 0x48, 0x4a, 0x13, 0xd2, 0xd2, 0xc0, 0xc0];

/// Expected remaining accounts for deposit:
///   [0] marginfi_group (writable)
///   [1] marginfi_account (writable)
///   [2] bank (writable)
///   [3] bank_liquidity_vault (writable)
///   [4] mint (writable)
///   [5] token_program (unchecked)
pub fn on_deposit<'info>(
    vault: &mut MarginfiVaultState,
    vault_authority: &AccountInfo<'info>,
    vault_token_account: &AccountInfo<'info>,
    amount: u64,
    remaining: &[AccountInfo<'info>],
    vault_authority_bump: u8,
) -> Result<()> {
    if remaining.len() >= 6 {
        let marginfi_group = &remaining[0];
        let marginfi_account = &remaining[1];
        let bank = &remaining[2];
        let bank_liquidity_vault = &remaining[3];
        let mint = &remaining[4];
        let token_program = &remaining[5];

        let seed: &[&[u8]] = &[VAULT_AUTHORITY_SEED, &[vault_authority_bump]];
        let signer_seeds: &[&[&[u8]]] = &[seed];

        let instruction = Instruction {
            program_id: MARGINFI_V2_ID,
            accounts: vec![
                AccountMeta::new(marginfi_group.key(), false),
                AccountMeta::new(vault_authority.key(), true),
                AccountMeta::new(marginfi_account.key(), false),
                AccountMeta::new(bank.key(), false),
                AccountMeta::new(bank_liquidity_vault.key(), false),
                AccountMeta::new(vault_token_account.key(), false),
                AccountMeta::new(mint.key(), false),
                AccountMeta::new_readonly(token_program.key(), false),
            ],
            data: [
                MARGINFI_LENDING_ACCOUNT_DEPOSIT.as_slice(),
                &amount.to_le_bytes(),
            ]
            .concat(),
        };

        let account_infos = [
            marginfi_group.clone(),
            vault_authority.clone(),
            marginfi_account.clone(),
            bank.clone(),
            bank_liquidity_vault.clone(),
            vault_token_account.clone(),
            mint.clone(),
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
///   [0] marginfi_group (writable)
///   [1] marginfi_account (writable)
///   [2] bank (writable)
///   [3] bank_liquidity_vault (writable)
///   [4] mint (writable)
///   [5] token_program (unchecked)
pub fn on_withdraw<'info>(
    vault: &mut MarginfiVaultState,
    vault_authority: &AccountInfo<'info>,
    vault_token_account: &AccountInfo<'info>,
    amount: u64,
    remaining: &[AccountInfo<'info>],
    vault_authority_bump: u8,
) -> Result<()> {
    if remaining.len() >= 6 {
        let marginfi_group = &remaining[0];
        let marginfi_account = &remaining[1];
        let bank = &remaining[2];
        let bank_liquidity_vault = &remaining[3];
        let mint = &remaining[4];
        let token_program = &remaining[5];

        let seed: &[&[u8]] = &[VAULT_AUTHORITY_SEED, &[vault_authority_bump]];
        let signer_seeds: &[&[&[u8]]] = &[seed];

        let instruction = Instruction {
            program_id: MARGINFI_V2_ID,
            accounts: vec![
                AccountMeta::new(marginfi_group.key(), false),
                AccountMeta::new(vault_authority.key(), true),
                AccountMeta::new(marginfi_account.key(), false),
                AccountMeta::new(bank.key(), false),
                AccountMeta::new(bank_liquidity_vault.key(), false),
                AccountMeta::new(vault_token_account.key(), false),
                AccountMeta::new(mint.key(), false),
                AccountMeta::new_readonly(token_program.key(), false),
            ],
            data: [
                MARGINFI_LENDING_ACCOUNT_WITHDRAW.as_slice(),
                &amount.to_le_bytes(),
            ]
            .concat(),
        };

        let account_infos = [
            marginfi_group.clone(),
            vault_authority.clone(),
            marginfi_account.clone(),
            bank.clone(),
            bank_liquidity_vault.clone(),
            vault_token_account.clone(),
            mint.clone(),
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

pub fn before_value_query(_vault: &MarginfiVaultState, remaining: &[AccountInfo]) -> Result<()> {
    if !remaining.is_empty() {
        let program = &remaining[0];
        require!(
            program.key() == MARGINFI_V2_ID,
            YieldAdapterError::AdapterProgramMismatch
        );
        require!(program.executable, YieldAdapterError::ProtocolCpiError);
    }
    Ok(())
}
