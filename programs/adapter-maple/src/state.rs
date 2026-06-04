use anchor_lang::prelude::*;

yield_adapter_trait::define_adapter_position!();

/// Reference Maple syrup vault state (EVM-primary; simulated yield on Solana).
#[account]
#[derive(Debug, InitSpace)]
pub struct MapleVaultState {
    pub authority: Pubkey,
    pub underlying_mint: Pubkey,
    pub total_underlying: u64,
    pub total_shares: u64,
    /// Simulated APY in basis points (e.g., 500 = 5%).
    pub simulated_apy_bps: u16,
    pub last_yield_sync_ts: i64,
    /// Placeholder until a live Maple Solana program exists (`Pubkey::default()`).
    pub protocol_program_id: Pubkey,
    /// Cumulative underlying attested as routed to the protocol layer.
    pub protocol_routed_underlying: u64,
    pub is_active: bool,
    pub bump: u8,
}

pub const VAULT_STATE_SEED: &[u8] = b"maple_vault_state";
pub const VAULT_AUTHORITY_SEED: &[u8] = b"maple_vault_authority";
