//! Protocol boundary for MarginFi v2: validates the live program and records routed deposits.

use anchor_lang::prelude::*;
use yield_adapter_trait::{
    record_protocol_routing, verify_protocol_program_account, YieldAdapterError,
};

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

pub fn before_value_query(_vault: &MarginfiVaultState, remaining: &[AccountInfo]) -> Result<()> {
    require!(!remaining.is_empty(), YieldAdapterError::ProtocolCpiError);
    verify_protocol_program_account(&remaining[0], MARGINFI_V2_ID)
}
