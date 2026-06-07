//! Protocol boundary for Drift Insurance Fund: validates the live program and records routed deposits.

use anchor_lang::prelude::*;
use yield_adapter_trait::{record_protocol_routing, verify_protocol_program_account, YieldAdapterError};

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

pub fn before_value_query(_vault: &DriftVaultState, remaining: &[AccountInfo]) -> Result<()> {
    require!(!remaining.is_empty(), YieldAdapterError::ProtocolCpiError);
    verify_protocol_program_account(&remaining[0], DRIFT_V2_ID)
}
