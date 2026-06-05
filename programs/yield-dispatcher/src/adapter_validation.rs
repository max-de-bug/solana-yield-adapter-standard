//! Validates adapter PDAs and token accounts before dispatcher CPI.

use adapter_drift;
use adapter_jupiter;
use adapter_kamino;
use adapter_maple;
use adapter_marginfi;
use adapter_drift::state::{
    VAULT_AUTHORITY_SEED as DRIFT_AUTHORITY, VAULT_STATE_SEED as DRIFT_VAULT,
};
use adapter_jupiter::state::{
    VAULT_AUTHORITY_SEED as JUPITER_AUTHORITY, VAULT_STATE_SEED as JUPITER_VAULT,
};
use adapter_kamino::state::{
    VAULT_AUTHORITY_SEED as KAMINO_AUTHORITY, VAULT_STATE_SEED as KAMINO_VAULT,
};
use adapter_maple::state::{
    VAULT_AUTHORITY_SEED as MAPLE_AUTHORITY, VAULT_STATE_SEED as MAPLE_VAULT,
};
use adapter_marginfi::state::{
    VAULT_AUTHORITY_SEED as MARGINFI_AUTHORITY, VAULT_STATE_SEED as MARGINFI_VAULT,
};
use anchor_lang::prelude::*;
use yield_adapter_trait::ADAPTER_POSITION_SEED;

struct AdapterVaultSeeds {
    vault_state: &'static [u8],
    vault_authority: &'static [u8],
}

fn seeds_for_adapter(adapter: &Pubkey) -> Option<AdapterVaultSeeds> {
    if adapter == &adapter_kamino::ID {
        return Some(AdapterVaultSeeds {
            vault_state: KAMINO_VAULT,
            vault_authority: KAMINO_AUTHORITY,
        });
    }
    if adapter == &adapter_marginfi::ID {
        return Some(AdapterVaultSeeds {
            vault_state: MARGINFI_VAULT,
            vault_authority: MARGINFI_AUTHORITY,
        });
    }
    if adapter == &adapter_jupiter::ID {
        return Some(AdapterVaultSeeds {
            vault_state: JUPITER_VAULT,
            vault_authority: JUPITER_AUTHORITY,
        });
    }
    if adapter == &adapter_maple::ID {
        return Some(AdapterVaultSeeds {
            vault_state: MAPLE_VAULT,
            vault_authority: MAPLE_AUTHORITY,
        });
    }
    if adapter == &adapter_drift::ID {
        return Some(AdapterVaultSeeds {
            vault_state: DRIFT_VAULT,
            vault_authority: DRIFT_AUTHORITY,
        });
    }
    None
}

pub fn expected_vault_state_pda(adapter: &Pubkey) -> Option<Pubkey> {
    let seeds = seeds_for_adapter(adapter)?;
    let (pda, _) = Pubkey::find_program_address(&[seeds.vault_state], adapter);
    Some(pda)
}

pub fn expected_vault_authority_pda(adapter: &Pubkey) -> Option<Pubkey> {
    let seeds = seeds_for_adapter(adapter)?;
    let (pda, _) = Pubkey::find_program_address(&[seeds.vault_authority], adapter);
    Some(pda)
}

pub fn expected_user_position_pda(adapter: &Pubkey, user: &Pubkey) -> Option<Pubkey> {
    seeds_for_adapter(adapter)?;
    let (pda, _) =
        Pubkey::find_program_address(&[ADAPTER_POSITION_SEED, user.as_ref()], adapter);
    Some(pda)
}

pub fn is_adapter_vault_state(account: &AccountInfo, adapter: &Pubkey) -> bool {
    match expected_vault_state_pda(adapter) {
        Some(expected) => account.key() == expected && account.owner == adapter,
        None => false,
    }
}

pub fn is_adapter_vault_authority(account: &AccountInfo, adapter: &Pubkey) -> bool {
    match expected_vault_authority_pda(adapter) {
        Some(expected) => account.key() == expected,
        None => false,
    }
}

pub fn is_adapter_user_position(
    account: &AccountInfo,
    adapter: &Pubkey,
    user: &Pubkey,
) -> bool {
    match expected_user_position_pda(adapter, user) {
        Some(expected) => account.key() == expected && account.owner == adapter,
        None => false,
    }
}
