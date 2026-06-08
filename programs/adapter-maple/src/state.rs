use anchor_lang::prelude::*;

yield_adapter_trait::define_adapter_position!();

/// Maple vault holds syrupUSDC (yield-bearing SPL token).
#[account]
#[derive(Debug, InitSpace)]
pub struct MapleVaultState {
    pub authority: Pubkey,
    pub underlying_mint: Pubkey,
    pub total_underlying: u64,
    pub total_shares: u64,
    pub protocol_routed_underlying: u64,
    pub status: u8,
    pub bump: u8,
}

pub const VAULT_STATE_SEED: &[u8] = b"maple_vault_state";
pub const VAULT_AUTHORITY_SEED: &[u8] = b"maple_vault_authority";
