use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::Instruction, program::invoke_signed};
use yield_adapter_trait::YieldAdapterError;

use crate::state::{JupiterVaultState, VAULT_AUTHORITY_SEED};
use crate::JUPITER_PERP_ID;

/// Discriminator for Jupiter Perps `add_liquidity`.
/// SHA256("global:add_liquidity")[..8]
const JUPITER_ADD_LIQUIDITY: [u8; 8] = [0xb5, 0x9d, 0x59, 0x43, 0x8f, 0xb6, 0x34, 0x48];

/// Discriminator for Jupiter Perps `remove_liquidity`.
/// SHA256("global:remove_liquidity")[..8]
const JUPITER_REMOVE_LIQUIDITY: [u8; 8] = [0x50, 0x55, 0xd1, 0x48, 0x18, 0xce, 0xb1, 0x6c];

/// Expected remaining accounts for deposit (add_liquidity):
///   [0] lp_token_mint (writable)
///   [1] custody (writable)
///   [2] custody_token_account (writable)
///   [3] lp_token_receiver (writable) — vault authority's JLP ATA
///   [4] token_program (unchecked)
pub fn on_deposit<'info>(
    vault: &mut JupiterVaultState,
    vault_authority: &AccountInfo<'info>,
    vault_token_account: &AccountInfo<'info>,
    amount: u64,
    remaining: &[AccountInfo<'info>],
    vault_authority_bump: u8,
) -> Result<()> {
    if remaining.len() >= 5 {
        let lp_token_mint = &remaining[0];
        let custody = &remaining[1];
        let custody_token_account = &remaining[2];
        let lp_token_receiver = &remaining[3];
        let token_program = &remaining[4];

        let seed: &[&[u8]] = &[VAULT_AUTHORITY_SEED, &[vault_authority_bump]];
        let signer_seeds: &[&[&[u8]]] = &[seed];

        let instruction = Instruction {
            program_id: JUPITER_PERP_ID,
            accounts: vec![
                AccountMeta::new(vault_authority.key(), true),
                AccountMeta::new(vault_token_account.key(), false),
                AccountMeta::new(lp_token_mint.key(), false),
                AccountMeta::new(lp_token_receiver.key(), false),
                AccountMeta::new(custody.key(), false),
                AccountMeta::new(custody_token_account.key(), false),
                AccountMeta::new_readonly(token_program.key(), false),
            ],
            data: [
                JUPITER_ADD_LIQUIDITY.as_slice(),
                &amount.to_le_bytes(),
            ]
            .concat(),
        };

        let account_infos = [
            vault_authority.clone(),
            vault_token_account.clone(),
            lp_token_mint.clone(),
            lp_token_receiver.clone(),
            custody.clone(),
            custody_token_account.clone(),
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

/// Expected remaining accounts for withdraw (remove_liquidity):
///   [0] lp_token_mint (writable)
///   [1] custody (writable)
///   [2] custody_token_account (writable)
///   [3] lp_token_source (writable) — vault authority's JLP ATA
///   [4] token_program (unchecked)
pub fn on_withdraw<'info>(
    vault: &mut JupiterVaultState,
    vault_authority: &AccountInfo<'info>,
    vault_token_account: &AccountInfo<'info>,
    lp_amount: u64,
    remaining: &[AccountInfo<'info>],
    vault_authority_bump: u8,
) -> Result<()> {
    if remaining.len() >= 5 {
        let lp_token_mint = &remaining[0];
        let custody = &remaining[1];
        let custody_token_account = &remaining[2];
        let lp_token_source = &remaining[3];
        let token_program = &remaining[4];

        let seed: &[&[u8]] = &[VAULT_AUTHORITY_SEED, &[vault_authority_bump]];
        let signer_seeds: &[&[&[u8]]] = &[seed];

        let instruction = Instruction {
            program_id: JUPITER_PERP_ID,
            accounts: vec![
                AccountMeta::new(vault_authority.key(), true),
                AccountMeta::new(vault_token_account.key(), false),
                AccountMeta::new(lp_token_mint.key(), false),
                AccountMeta::new(lp_token_source.key(), false),
                AccountMeta::new(custody.key(), false),
                AccountMeta::new(custody_token_account.key(), false),
                AccountMeta::new_readonly(token_program.key(), false),
            ],
            data: [
                JUPITER_REMOVE_LIQUIDITY.as_slice(),
                &lp_amount.to_le_bytes(),
            ]
            .concat(),
        };

        let account_infos = [
            vault_authority.clone(),
            vault_token_account.clone(),
            lp_token_mint.clone(),
            lp_token_source.clone(),
            custody.clone(),
            custody_token_account.clone(),
            token_program.clone(),
        ];

        invoke_signed(&instruction, &account_infos, signer_seeds)?;
    }

    vault.protocol_routed_underlying = vault
        .protocol_routed_underlying
        .checked_sub(lp_amount)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?;

    Ok(())
}

pub fn before_value_query(_vault: &JupiterVaultState, remaining: &[AccountInfo]) -> Result<()> {
    if !remaining.is_empty() {
        let program = &remaining[0];
        require!(
            program.key() == JUPITER_PERP_ID,
            YieldAdapterError::AdapterProgramMismatch
        );
        require!(program.executable, YieldAdapterError::ProtocolCpiError);
    }
    Ok(())
}
