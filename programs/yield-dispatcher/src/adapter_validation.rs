//! Validates adapter PDAs before dispatcher CPI.
//!
//! Vault state PDA seeds are read from the registry's `AdapterEntry` at runtime,
//! so the dispatcher never needs to be redeployed when adding a new adapter.
//! Vault authority and user position use standardized seeds from the trait crate.

use anchor_lang::prelude::*;
use yield_adapter_trait::{ADAPTER_POSITION_SEED, VAULT_AUTHORITY_SEED};

pub fn expected_vault_state_pda(vault_state_seed: &[u8], adapter: &Pubkey) -> Pubkey {
    let (pda, _) = Pubkey::find_program_address(&[vault_state_seed], adapter);
    pda
}

pub fn expected_vault_authority_pda(adapter: &Pubkey) -> Pubkey {
    let (pda, _) = Pubkey::find_program_address(&[VAULT_AUTHORITY_SEED], adapter);
    pda
}

pub fn expected_user_position_pda(adapter: &Pubkey, user: &Pubkey) -> Pubkey {
    let (pda, _) =
        Pubkey::find_program_address(&[ADAPTER_POSITION_SEED, user.as_ref()], adapter);
    pda
}

pub fn is_adapter_vault_state(
    account: &AccountInfo,
    vault_state_seed: &[u8],
    adapter: &Pubkey,
) -> bool {
    let expected = expected_vault_state_pda(vault_state_seed, adapter);
    account.key() == expected && account.owner == adapter
}

pub fn is_adapter_vault_authority(account: &AccountInfo, adapter: &Pubkey) -> bool {
    let expected = expected_vault_authority_pda(adapter);
    account.key() == expected
}

pub fn is_adapter_user_position(
    account: &AccountInfo,
    adapter: &Pubkey,
    user: &Pubkey,
) -> bool {
    let expected = expected_user_position_pda(adapter, user);
    account.key() == expected && account.owner == adapter
}
