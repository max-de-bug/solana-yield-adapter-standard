use anchor_lang::prelude::*;
use yield_adapter_trait::VaultStatus;

yield_adapter_trait::define_adapter_position!();

/// Drift Insurance Fund vault state.
#[account]
#[derive(Debug, InitSpace)]
pub struct DriftVaultState {
    pub authority: Pubkey,
    pub underlying_mint: Pubkey,
    pub total_underlying: u64,
    pub total_shares: u64,
    /// Target protocol program (Drift Protocol v2 on mainnet).
    pub protocol_program_id: Pubkey,
    /// Cumulative underlying attested as routed to the protocol layer.
    pub protocol_routed_underlying: u64,
    pub last_yield_sync_ts: i64,
    pub status: VaultStatus,
    /// Unstaking cooldown in seconds (default: 13 days). Set to 0 for instant settlement.
    pub unstake_cooldown_seconds: i64,
    pub bump: u8,
}

/// Per-user withdrawal ticket for the two-phase unstake flow.
///
/// Phase 1 (`withdraw`): creates this ticket, locks the shares.
/// Phase 2 (`settle_withdrawal`): after `unlock_ts`, executes the CPI and returns underlying.
#[account]
#[derive(Debug, Default)]
pub struct DriftWithdrawalTicket {
    /// The AdapterPosition this ticket belongs to.
    pub position: Pubkey,
    /// Shares being withdrawn (locked from the position).
    pub shares: u64,
    /// Minimum acceptable underlying out (slippage protection).
    pub min_amount_out: u64,
    /// Unix timestamp when the cooldown expires and settlement is allowed.
    pub unlock_ts: i64,
    /// Whether this ticket has been settled.
    pub is_settled: bool,
    /// Unix timestamp when the ticket was created.
    pub created_ts: i64,
    /// PDA bump.
    pub bump: u8,
}

pub const VAULT_STATE_SEED: &[u8] = b"drift_vault_state";
pub const VAULT_AUTHORITY_SEED: &[u8] = b"drift_vault_authority";
pub const TICKET_SEED: &[u8] = b"drift_ticket";
