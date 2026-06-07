//! Protocol boundary for Maple Syrup adapter: holds real syrupUSDC (no Solana program).

use anchor_lang::prelude::*;

use crate::state::MapleVaultState;

/// Maple has no native Solana program — routing is a no-op.
pub fn on_deposit(_vault: &mut MapleVaultState, _amount: u64, _remaining: &[AccountInfo]) -> Result<()> {
    Ok(())
}

/// syrupUSDC yield is intrinsic to the token — no simulation needed.
pub fn before_value_query(_vault: &MapleVaultState, _remaining: &[AccountInfo]) -> Result<()> {
    Ok(())
}
