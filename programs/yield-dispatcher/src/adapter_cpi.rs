//! CPI routing from the dispatcher into registered reference adapters.

use adapter_drift::program::AdapterDrift;
use adapter_jupiter::program::AdapterJupiter;
use adapter_kamino::program::AdapterKamino;
use adapter_maple::program::AdapterMaple;
use adapter_marginfi::program::AdapterMarginfi;
use anchor_lang::prelude::*;

use crate::error::DispatcherError;
use yield_adapter_trait::{read_adapter_position_receipt, read_reference_vault_totals};

/// Read global vault totals from any reference adapter vault state account.
pub fn read_vault_totals(vault_state: &AccountInfo) -> Result<(u64, u64)> {
    read_reference_vault_totals(vault_state).map_err(|_| DispatcherError::AdapterCpiError.into())
}

/// Read receipt balance from an adapter `AdapterPosition` account.
pub fn read_position_receipt(user_position: &AccountInfo) -> Result<u64> {
    read_adapter_position_receipt(user_position)
        .map_err(|_| DispatcherError::AdapterCpiError.into())
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
) -> Result<u64> {
    let vault_state = accounts.vault_state.clone();
    let (_, shares_before) = read_vault_totals(&vault_state)?;
    let program_id = accounts.adapter_program.key();

    if program_id == AdapterKamino::id() {
        adapter_kamino::cpi::deposit(
            CpiContext::new(
                program_id,
                adapter_kamino::cpi::accounts::Deposit {
                    user: accounts.user,
                    vault_state: accounts.vault_state,
                    user_position: accounts.user_position,
                    user_token_account: accounts.user_token_account,
                    vault_authority: accounts.vault_authority,
                    vault_token_account: accounts.vault_token_account,
                    token_program: accounts.token_program,
                    system_program: accounts.system_program,
                },
            ),
            amount,
        )?;
    } else if program_id == AdapterMarginfi::id() {
        adapter_marginfi::cpi::deposit(
            CpiContext::new(
                program_id,
                adapter_marginfi::cpi::accounts::Deposit {
                    user: accounts.user,
                    vault_state: accounts.vault_state,
                    user_position: accounts.user_position,
                    user_token_account: accounts.user_token_account,
                    vault_authority: accounts.vault_authority,
                    vault_token_account: accounts.vault_token_account,
                    token_program: accounts.token_program,
                    system_program: accounts.system_program,
                },
            ),
            amount,
        )?;
    } else if program_id == AdapterJupiter::id() {
        adapter_jupiter::cpi::deposit(
            CpiContext::new(
                program_id,
                adapter_jupiter::cpi::accounts::Deposit {
                    user: accounts.user,
                    vault_state: accounts.vault_state,
                    user_position: accounts.user_position,
                    user_token_account: accounts.user_token_account,
                    vault_authority: accounts.vault_authority,
                    vault_token_account: accounts.vault_token_account,
                    token_program: accounts.token_program,
                    system_program: accounts.system_program,
                },
            ),
            amount,
        )?;
    } else if program_id == AdapterMaple::id() {
        adapter_maple::cpi::deposit(
            CpiContext::new(
                program_id,
                adapter_maple::cpi::accounts::Deposit {
                    user: accounts.user,
                    vault_state: accounts.vault_state,
                    user_position: accounts.user_position,
                    user_token_account: accounts.user_token_account,
                    vault_authority: accounts.vault_authority,
                    vault_token_account: accounts.vault_token_account,
                    token_program: accounts.token_program,
                    system_program: accounts.system_program,
                },
            ),
            amount,
        )?;
    } else if program_id == AdapterDrift::id() {
        adapter_drift::cpi::deposit(
            CpiContext::new(
                program_id,
                adapter_drift::cpi::accounts::Deposit {
                    user: accounts.user,
                    vault_state: accounts.vault_state,
                    user_position: accounts.user_position,
                    user_token_account: accounts.user_token_account,
                    vault_authority: accounts.vault_authority,
                    vault_token_account: accounts.vault_token_account,
                    token_program: accounts.token_program,
                    system_program: accounts.system_program,
                },
            ),
            amount,
        )?;
    } else {
        return Err(DispatcherError::AdapterNotApproved.into());
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
) -> Result<()> {
    let program_id = accounts.adapter_program.key();

    if program_id == AdapterKamino::id() {
        adapter_kamino::cpi::withdraw(
            CpiContext::new(
                program_id,
                adapter_kamino::cpi::accounts::Withdraw {
                    user: accounts.user,
                    vault_state: accounts.vault_state,
                    user_position: accounts.user_position,
                    user_token_account: accounts.user_token_account,
                    vault_token_account: accounts.vault_token_account,
                    vault_authority: accounts.vault_authority,
                    token_program: accounts.token_program,
                },
            ),
            shares,
        )?;
    } else if program_id == AdapterMarginfi::id() {
        adapter_marginfi::cpi::withdraw(
            CpiContext::new(
                program_id,
                adapter_marginfi::cpi::accounts::Withdraw {
                    user: accounts.user,
                    vault_state: accounts.vault_state,
                    user_position: accounts.user_position,
                    user_token_account: accounts.user_token_account,
                    vault_token_account: accounts.vault_token_account,
                    vault_authority: accounts.vault_authority,
                    token_program: accounts.token_program,
                },
            ),
            shares,
        )?;
    } else if program_id == AdapterJupiter::id() {
        adapter_jupiter::cpi::withdraw(
            CpiContext::new(
                program_id,
                adapter_jupiter::cpi::accounts::Withdraw {
                    user: accounts.user,
                    vault_state: accounts.vault_state,
                    user_position: accounts.user_position,
                    user_token_account: accounts.user_token_account,
                    vault_token_account: accounts.vault_token_account,
                    vault_authority: accounts.vault_authority,
                    token_program: accounts.token_program,
                },
            ),
            shares,
        )?;
    } else if program_id == AdapterMaple::id() {
        adapter_maple::cpi::withdraw(
            CpiContext::new(
                program_id,
                adapter_maple::cpi::accounts::Withdraw {
                    user: accounts.user,
                    vault_state: accounts.vault_state,
                    user_position: accounts.user_position,
                    user_token_account: accounts.user_token_account,
                    vault_token_account: accounts.vault_token_account,
                    vault_authority: accounts.vault_authority,
                    token_program: accounts.token_program,
                },
            ),
            shares,
        )?;
    } else if program_id == AdapterDrift::id() {
        adapter_drift::cpi::withdraw(
            CpiContext::new(
                program_id,
                adapter_drift::cpi::accounts::Withdraw {
                    user: accounts.user,
                    vault_state: accounts.vault_state,
                    user_position: accounts.user_position,
                    user_token_account: accounts.user_token_account,
                    vault_token_account: accounts.vault_token_account,
                    vault_authority: accounts.vault_authority,
                    token_program: accounts.token_program,
                },
            ),
            shares,
        )?;
    } else {
        return Err(DispatcherError::AdapterNotApproved.into());
    }

    Ok(())
}

pub struct AdapterCurrentValueAccounts<'info> {
    pub adapter_program: AccountInfo<'info>,
    pub user: AccountInfo<'info>,
    pub vault_state: AccountInfo<'info>,
    pub user_position: AccountInfo<'info>,
}

pub fn cpi_current_value<'info>(accounts: AdapterCurrentValueAccounts<'info>) -> Result<()> {
    let program_id = accounts.adapter_program.key();

    if program_id == AdapterKamino::id() {
        adapter_kamino::cpi::current_value(CpiContext::new(
            program_id,
            adapter_kamino::cpi::accounts::CurrentValue {
                user: accounts.user,
                vault_state: accounts.vault_state,
                user_position: accounts.user_position,
            },
        ))?;
    } else if program_id == AdapterMarginfi::id() {
        adapter_marginfi::cpi::current_value(CpiContext::new(
            program_id,
            adapter_marginfi::cpi::accounts::CurrentValue {
                user: accounts.user,
                vault_state: accounts.vault_state,
                user_position: accounts.user_position,
            },
        ))?;
    } else if program_id == AdapterJupiter::id() {
        adapter_jupiter::cpi::current_value(CpiContext::new(
            program_id,
            adapter_jupiter::cpi::accounts::CurrentValue {
                user: accounts.user,
                vault_state: accounts.vault_state,
                user_position: accounts.user_position,
            },
        ))?;
    } else if program_id == AdapterMaple::id() {
        adapter_maple::cpi::current_value(CpiContext::new(
            program_id,
            adapter_maple::cpi::accounts::CurrentValue {
                user: accounts.user,
                vault_state: accounts.vault_state,
                user_position: accounts.user_position,
            },
        ))?;
    } else if program_id == AdapterDrift::id() {
        adapter_drift::cpi::current_value(CpiContext::new(
            program_id,
            adapter_drift::cpi::accounts::CurrentValue {
                user: accounts.user,
                vault_state: accounts.vault_state,
                user_position: accounts.user_position,
            },
        ))?;
    } else {
        return Err(DispatcherError::AdapterNotApproved.into());
    }

    Ok(())
}
