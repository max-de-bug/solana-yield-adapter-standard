//! Protocol boundary for Drift Insurance Fund: validates the live program and records routed deposits.

use anchor_lang::prelude::*;
use yield_adapter_trait::{record_protocol_routing, YieldAdapterError};

use crate::state::DriftVaultState;
use crate::DRIFT_V2_ID;

pub fn on_deposit(
    vault: &mut DriftVaultState,
    amount: u64,
    remaining: &[AccountInfo],
) -> Result<()> {
    record_protocol_routing(
        &mut vault.protocol_routed_underlying,
        amount,
        remaining,
        DRIFT_V2_ID,
    )
}

pub fn before_value_query(vault: &mut DriftVaultState, remaining: &[AccountInfo]) -> Result<()> {
    if !remaining.is_empty() {
        let program = &remaining[0];
        require!(
            program.key() == DRIFT_V2_ID,
            YieldAdapterError::AdapterProgramMismatch
        );
        require!(program.executable, YieldAdapterError::ProtocolCpiError);
    }
    Ok(())
}
