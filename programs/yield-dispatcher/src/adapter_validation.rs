//! Validates adapter PDAs before dispatcher CPI.
//!
//! Vault state PDA seeds and vault authority seeds are read from the registry's
//! `AdapterEntry` at runtime, so the dispatcher never needs to be redeployed
//! when adding a new adapter. User position uses the standardized seed from the
//! trait crate.

use anchor_lang::prelude::*;
use yield_adapter_trait::ADAPTER_POSITION_SEED;

pub fn is_adapter_vault_state(
    account: &AccountInfo,
    vault_state_seed: &[u8],
    adapter: &Pubkey,
) -> bool {
    let expected = expected_pda(vault_state_seed, adapter);
    account.key() == expected && account.owner == adapter
}

pub fn is_adapter_vault_authority(
    account: &AccountInfo,
    vault_authority_seed: &[u8],
    adapter: &Pubkey,
) -> bool {
    let expected = expected_pda(vault_authority_seed, adapter);
    account.key() == expected
}

pub fn is_adapter_user_position(account: &AccountInfo, adapter: &Pubkey, user: &Pubkey) -> bool {
    let expected = user_position_pda(adapter, user);
    account.key() == expected && account.owner == adapter
}

pub fn user_position_pda(adapter: &Pubkey, user: &Pubkey) -> Pubkey {
    let (pda, _) =
        Pubkey::find_program_address(&[ADAPTER_POSITION_SEED, user.as_ref()], adapter);
    pda
}

fn expected_pda(seed: &[u8], adapter: &Pubkey) -> Pubkey {
    let (pda, _) = Pubkey::find_program_address(&[seed], adapter);
    pda
}
