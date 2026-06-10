use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::Instruction, program::invoke_signed};
use yield_adapter_trait::{YieldAdapterError, verify_protocol_program_account};

use crate::state::{DriftVaultState, VAULT_AUTHORITY_SEED};
use crate::DRIFT_V2_ID;

/// Discriminator for Drift v2 `spot_deposit`.
/// Drift is non-Anchor; these bytes were determined empirically via fork testing.
const DRIFT_SPOT_DEPOSIT: [u8; 8] = [0x99, 0xff, 0xd5, 0x6e, 0x5d, 0x77, 0x3d, 0x16];

/// Discriminator for Drift v2 `spot_withdraw`.
const DRIFT_SPOT_WITHDRAW: [u8; 8] = [0x9c, 0x0a, 0x7f, 0x2e, 0x39, 0x6b, 0x1c, 0x8c];

/// Expected remaining accounts for deposit (spot_deposit):
///   [0] spot_market (writable)
///   [1] spot_market_vault (writable)
///   [2] user_stats (writable)
///   [3] user (writable)
///   [4] authority (signer via PDA)
///   [5] token_program (unchecked)
pub fn on_deposit<'info>(
    vault: &mut DriftVaultState,
    vault_authority: &AccountInfo<'info>,
    vault_token_account: &AccountInfo<'info>,
    amount: u64,
    remaining: &[AccountInfo<'info>],
    vault_authority_bump: u8,
) -> Result<()> {
    if remaining.len() >= 6 {
        let spot_market = &remaining[0];
        let spot_market_vault = &remaining[1];
        let user_stats = &remaining[2];
        let user = &remaining[3];
        let token_program = &remaining[4];

        let seed: &[&[u8]] = &[VAULT_AUTHORITY_SEED, &[vault_authority_bump]];
        let signer_seeds: &[&[&[u8]]] = &[seed];

        let instruction = Instruction {
            program_id: DRIFT_V2_ID,
            accounts: vec![
                AccountMeta::new(spot_market.key(), false),
                AccountMeta::new(spot_market_vault.key(), false),
                AccountMeta::new(user_stats.key(), false),
                AccountMeta::new(vault_authority.key(), true),
                AccountMeta::new(user.key(), false),
                AccountMeta::new(vault_token_account.key(), false),
                AccountMeta::new_readonly(token_program.key(), false),
            ],
            data: [
                DRIFT_SPOT_DEPOSIT.as_slice(),
                &amount.to_le_bytes(),
                &0u8.to_le_bytes(),
            ]
            .concat(),
        };

        let account_infos = [
            spot_market.clone(),
            spot_market_vault.clone(),
            user_stats.clone(),
            vault_authority.clone(),
            user.clone(),
            vault_token_account.clone(),
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

/// Expected remaining accounts for withdraw (spot_withdraw):
///   [0] spot_market (writable)
///   [1] spot_market_vault (writable)
///   [2] user_stats (writable)
///   [3] user (writable)
///   [4] authority (signer via PDA)
///   [5] token_program (unchecked)
pub fn on_withdraw<'info>(
    vault: &mut DriftVaultState,
    vault_authority: &AccountInfo<'info>,
    vault_token_account: &AccountInfo<'info>,
    amount: u64,
    remaining: &[AccountInfo<'info>],
    vault_authority_bump: u8,
) -> Result<()> {
    if remaining.len() >= 6 {
        let spot_market = &remaining[0];
        let spot_market_vault = &remaining[1];
        let user_stats = &remaining[2];
        let user = &remaining[3];
        let token_program = &remaining[4];

        let seed: &[&[u8]] = &[VAULT_AUTHORITY_SEED, &[vault_authority_bump]];
        let signer_seeds: &[&[&[u8]]] = &[seed];

        let instruction = Instruction {
            program_id: DRIFT_V2_ID,
            accounts: vec![
                AccountMeta::new(spot_market.key(), false),
                AccountMeta::new(spot_market_vault.key(), false),
                AccountMeta::new(user_stats.key(), false),
                AccountMeta::new(vault_authority.key(), true),
                AccountMeta::new(user.key(), false),
                AccountMeta::new(vault_token_account.key(), false),
                AccountMeta::new_readonly(token_program.key(), false),
            ],
            data: [
                DRIFT_SPOT_WITHDRAW.as_slice(),
                &amount.to_le_bytes(),
                &0u8.to_le_bytes(),
            ]
            .concat(),
        };

        let account_infos = [
            spot_market.clone(),
            spot_market_vault.clone(),
            user_stats.clone(),
            vault_authority.clone(),
            user.clone(),
            vault_token_account.clone(),
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

pub fn before_value_query(_vault: &DriftVaultState, remaining: &[AccountInfo]) -> Result<()> {
    if !remaining.is_empty() {
        verify_protocol_program_account(&remaining[0], DRIFT_V2_ID)?;
    }
    Ok(())
}
