//! Protocol boundary for Jupiter Perpetuals JLP: validates the live program and records routed deposits.

use anchor_lang::prelude::*;
use yield_adapter_trait::{record_protocol_routing, YieldAdapterError};

use crate::state::JupiterVaultState;
use crate::JUPITER_PERP_ID;

pub fn on_deposit(
    vault: &mut JupiterVaultState,
    amount: u64,
    remaining: &[AccountInfo],
) -> Result<()> {
    record_protocol_routing(
        &mut vault.protocol_routed_underlying,
        amount,
        remaining,
        JUPITER_PERP_ID,
    )
}

pub fn before_value_query(vault: &mut JupiterVaultState, remaining: &[AccountInfo]) -> Result<()> {
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
