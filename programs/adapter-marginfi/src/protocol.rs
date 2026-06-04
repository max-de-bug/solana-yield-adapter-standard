//! Protocol boundary for MarginFi v2: validates the live program and records routed deposits.

use anchor_lang::prelude::*;
use yield_adapter_trait::{record_protocol_routing, YieldAdapterError};

use crate::state::MarginfiVaultState;
use crate::MARGINFI_V2_ID;

pub fn on_deposit(
    vault: &mut MarginfiVaultState,
    amount: u64,
    remaining: &[AccountInfo],
) -> Result<()> {
    record_protocol_routing(
        &mut vault.protocol_routed_underlying,
        amount,
        remaining,
        MARGINFI_V2_ID,
    )
}

pub fn before_value_query(vault: &mut MarginfiVaultState, remaining: &[AccountInfo]) -> Result<()> {
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
