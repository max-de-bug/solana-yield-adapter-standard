//! Protocol boundary for Kamino K-Lend: validates the live program and records routed deposits.
//!
//! Full reserve CPI (remaining accounts from the Kamino IDL) is wired at this boundary;
//! the reference build records attested flow and keeps funds in the adapter vault until
//! integrators pass complete Kamino account metas.

use anchor_lang::prelude::*;
use yield_adapter_trait::{
    record_protocol_routing, verify_protocol_program_account, YieldAdapterError,
};

use crate::state::KaminoVaultState;
use crate::KAMINO_LEND_ID;

pub fn on_deposit(
    vault: &mut KaminoVaultState,
    amount: u64,
    remaining: &[AccountInfo],
) -> Result<()> {
    record_protocol_routing(
        &mut vault.protocol_routed_underlying,
        amount,
        remaining,
        KAMINO_LEND_ID,
    )
}

pub fn before_value_query(_vault: &KaminoVaultState, remaining: &[AccountInfo]) -> Result<()> {
    require!(!remaining.is_empty(), YieldAdapterError::ProtocolCpiError);
    verify_protocol_program_account(&remaining[0], KAMINO_LEND_ID)
}
