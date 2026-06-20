use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke,
};
use sha2::{Digest, Sha256};

use crate::error::DispatcherError;
use yield_adapter_trait::{
    read_adapter_position_receipt, read_reference_vault_totals, try_read_cpi_return_value,
};

/// Read global vault totals from any reference adapter vault state account.
pub fn read_vault_totals(vault_state: &AccountInfo) -> Result<(u64, u64)> {
    read_reference_vault_totals(vault_state).map_err(|_| DispatcherError::AdapterCpiError.into())
}

/// Read receipt balance from an adapter `AdapterPosition` account.
pub fn read_position_receipt(user_position: &AccountInfo) -> Result<u64> {
    read_adapter_position_receipt(user_position)
        .map_err(|_| DispatcherError::AdapterCpiError.into())
}

/// Compute the Anchor discriminator for a given instruction name.
fn discriminator(method: &str) -> [u8; 8] {
    let mut hasher = Sha256::new();
    hasher.update(b"global:");
    hasher.update(method.as_bytes());
    let result = hasher.finalize();
    let mut out = [0u8; 8];
    out.copy_from_slice(&result[..8]);
    out
}

/// Build instruction data: 8-byte Anchor discriminator + zero or more u64 arguments.
fn build_instruction_data(method: &str, amounts: &[u64]) -> Vec<u8> {
    let mut data = discriminator(method).to_vec();
    for amt in amounts {
        data.extend_from_slice(&amt.to_le_bytes());
    }
    data
}

/// Perform a generic CPI call to any adapter program.
fn cpi_call(
    program_id: Pubkey,
    accounts: &[AccountInfo],
    metas: &[AccountMeta],
    method: &str,
    amounts: &[u64],
) -> Result<()> {
    let ix = Instruction {
        program_id,
        accounts: metas.to_vec(),
        data: build_instruction_data(method, amounts),
    };
    invoke(&ix, accounts).map_err(|_| DispatcherError::AdapterCpiError.into())
}

pub struct AdapterDepositAccounts<'info> {
    pub adapter_program: AccountInfo<'info>,
    pub user: AccountInfo<'info>,
    pub vault_state: AccountInfo<'info>,
    pub user_position: AccountInfo<'info>,
    pub user_token_account: AccountInfo<'info>,
    pub vault_token_account: AccountInfo<'info>,
    pub vault_authority: AccountInfo<'info>,
    pub token_program: AccountInfo<'info>,
    pub system_program: AccountInfo<'info>,
}

pub fn cpi_deposit<'info>(
    accounts: AdapterDepositAccounts<'info>,
    amount: u64,
    min_shares_out: u64,
) -> Result<u64> {
    let vault_state = accounts.vault_state.clone();
    let (_, shares_before) = read_vault_totals(&vault_state)?;
    let program_id = accounts.adapter_program.key();

    let account_infos = [
        accounts.user.clone(),
        accounts.vault_state.clone(),
        accounts.user_position.clone(),
        accounts.user_token_account.clone(),
        accounts.vault_authority.clone(),
        accounts.vault_token_account.clone(),
        accounts.token_program.clone(),
        accounts.system_program.clone(),
    ];

    let account_metas = [
        AccountMeta::new(accounts.user.key(), true),
        AccountMeta::new(accounts.vault_state.key(), false),
        AccountMeta::new(accounts.user_position.key(), false),
        AccountMeta::new(accounts.user_token_account.key(), false),
        AccountMeta::new_readonly(accounts.vault_authority.key(), false),
        AccountMeta::new(accounts.vault_token_account.key(), false),
        AccountMeta::new_readonly(accounts.token_program.key(), false),
        AccountMeta::new_readonly(accounts.system_program.key(), false),
    ];

    cpi_call(
        program_id,
        &account_infos,
        &account_metas,
        "deposit",
        &[amount, min_shares_out],
    )?;

    if let Some(shares_minted) = try_read_cpi_return_value(&program_id) {
        return Ok(shares_minted);
    }

    let (_, shares_after) = read_vault_totals(&vault_state)?;
    shares_after
        .checked_sub(shares_before)
        .ok_or(DispatcherError::AdapterCpiError.into())
}

pub struct AdapterWithdrawAccounts<'info> {
    pub adapter_program: AccountInfo<'info>,
    pub user: AccountInfo<'info>,
    pub vault_state: AccountInfo<'info>,
    pub user_position: AccountInfo<'info>,
    pub user_token_account: AccountInfo<'info>,
    pub vault_token_account: AccountInfo<'info>,
    pub vault_authority: AccountInfo<'info>,
    pub token_program: AccountInfo<'info>,
}

pub fn cpi_withdraw<'info>(
    accounts: AdapterWithdrawAccounts<'info>,
    shares: u64,
    min_underlying_out: u64,
) -> Result<u64> {
    let program_id = accounts.adapter_program.key();

    let account_infos = [
        accounts.user.clone(),
        accounts.vault_state.clone(),
        accounts.user_position.clone(),
        accounts.user_token_account.clone(),
        accounts.vault_token_account.clone(),
        accounts.vault_authority.clone(),
        accounts.token_program.clone(),
    ];

    let account_metas = [
        AccountMeta::new(accounts.user.key(), true),
        AccountMeta::new(accounts.vault_state.key(), false),
        AccountMeta::new(accounts.user_position.key(), false),
        AccountMeta::new(accounts.user_token_account.key(), false),
        AccountMeta::new(accounts.vault_token_account.key(), false),
        AccountMeta::new_readonly(accounts.vault_authority.key(), false),
        AccountMeta::new_readonly(accounts.token_program.key(), false),
    ];

    cpi_call(
        program_id,
        &account_infos,
        &account_metas,
        "withdraw",
        &[shares, min_underlying_out],
    )?;

    Ok(try_read_cpi_return_value(&program_id).unwrap_or(0))
}

pub struct AdapterCurrentValueAccounts<'info> {
    pub adapter_program: AccountInfo<'info>,
    pub user: AccountInfo<'info>,
    pub vault_state: AccountInfo<'info>,
    pub user_position: AccountInfo<'info>,
}

pub fn cpi_current_value<'info>(accounts: AdapterCurrentValueAccounts<'info>) -> Result<u64> {
    let program_id = accounts.adapter_program.key();

    let account_infos = [
        accounts.user.clone(),
        accounts.vault_state.clone(),
        accounts.user_position.clone(),
    ];

    let account_metas = [
        AccountMeta::new_readonly(accounts.user.key(), true),
        AccountMeta::new(accounts.vault_state.key(), false),
        AccountMeta::new_readonly(accounts.user_position.key(), false),
    ];

    cpi_call(
        program_id,
        &account_infos,
        &account_metas,
        "current_value",
        &[],
    )?;

    try_read_cpi_return_value(&program_id).ok_or(DispatcherError::AdapterCpiError.into())
}
