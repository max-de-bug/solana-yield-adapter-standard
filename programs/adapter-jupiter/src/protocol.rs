//! Protocol boundary for Jupiter Perpetuals JLP: validates the live program and records routed deposits.

use anchor_lang::prelude::*;
use yield_adapter_trait::{
    record_protocol_routing, verify_protocol_program_account, YieldAdapterError,
};

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

pub fn before_value_query(_vault: &JupiterVaultState, remaining: &[AccountInfo]) -> Result<()> {
    require!(!remaining.is_empty(), YieldAdapterError::ProtocolCpiError);
    verify_protocol_program_account(&remaining[0], JUPITER_PERP_ID)
}
