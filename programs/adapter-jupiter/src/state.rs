use anchor_lang::prelude::*;

yield_adapter_trait::define_adapter_position!();

/// Adapter-level vault state tracking total deposits and share prices.
#[account]
#[derive(Debug, InitSpace)]
pub struct JupiterVaultState {
    pub authority: Pubkey,
    pub underlying_mint: Pubkey,
    pub total_underlying: u64,
    pub total_shares: u64,
    /// Target protocol program (Jupiter Perpetuals on mainnet).
    pub protocol_program_id: Pubkey,
    /// Cumulative underlying attested as routed to the protocol layer.
    pub protocol_routed_underlying: u64,
    pub last_yield_sync_ts: i64,
    pub is_active: bool,
    pub bump: u8,
}

pub const VAULT_STATE_SEED: &[u8] = b"jupiter_vault_state";
pub const VAULT_AUTHORITY_SEED: &[u8] = b"jupiter_vault_authority";
