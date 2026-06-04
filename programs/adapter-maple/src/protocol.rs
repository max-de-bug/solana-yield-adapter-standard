//! Protocol boundary for Maple reference model: time-based yield accrual before value queries.

use anchor_lang::prelude::*;
use yield_adapter_trait::{accrue_time_based_yield, record_protocol_routing};

use crate::state::MapleVaultState;
use crate::MAPLE_PROTOCOL_PLACEHOLDER;

pub fn on_deposit(
    vault: &mut MapleVaultState,
    amount: u64,
    remaining: &[AccountInfo],
) -> Result<()> {
    if !remaining.is_empty() {
        record_protocol_routing(
            &mut vault.protocol_routed_underlying,
            amount,
            remaining,
            MAPLE_PROTOCOL_PLACEHOLDER,
        )?;
    }
    Ok(())
}

pub fn before_value_query(vault: &mut MapleVaultState, _remaining: &[AccountInfo]) -> Result<()> {
    let clock = Clock::get()?;
    accrue_time_based_yield(
        &mut vault.total_underlying,
        vault.total_shares,
        vault.simulated_apy_bps,
        &mut vault.last_yield_sync_ts,
        clock.unix_timestamp,
    )
}
