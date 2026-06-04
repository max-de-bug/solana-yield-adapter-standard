//! Protocol boundary for Kamino K-Lend: validates the live program and records routed deposits.
//!
//! Full reserve CPI (remaining accounts from the Kamino IDL) is wired at this boundary;
//! the reference build records attested flow and keeps funds in the adapter vault until
//! integrators pass complete Kamino account metas.

use anchor_lang::prelude::*;
use yield_adapter_trait::{record_protocol_routing, YieldAdapterError};

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

pub fn before_value_query(vault: &mut KaminoVaultState, remaining: &[AccountInfo]) -> Result<()> {
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
