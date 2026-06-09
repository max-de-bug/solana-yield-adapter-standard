use anchor_lang::prelude::*;
use yield_adapter_trait::VaultStatus;

/// Creates the standard `AdapterPosition` account struct (owner, adapter_program_id,
/// deposited_amount, withdrawn_amount, receipt_token_balance, last_updated, bump).
yield_adapter_trait::define_adapter_position!();

/// Per-vault state account for this adapter.
///
/// Each vault instance stores:
/// - Authority and mint metadata
/// - Total underlying tokens and shares in the vault
/// - Protocol tracking for CPI routing
/// - Operational status (Active / Paused / Deprecated)
///
/// ### Customizing for your protocol
/// Add protocol-specific fields here, for example:
/// - `pool_id: Pubkey` — which pool/lending-market this vault targets
/// - `strategy_id: u64` — which strategy variant to use
/// - `reserve_index: u16` — which reserve in a multi-reserve protocol
///
/// Fields you may remove if not needed:
/// - `protocol_program_id` — if your adapter has no external CPI (like Maple w/ syrupUSDC)
/// - `last_yield_sync_ts` — if your protocol doesn't need periodic yield sync
#[account]
#[derive(Debug, InitSpace)]
pub struct TemplateVaultState {
    pub authority: Pubkey,
    pub underlying_mint: Pubkey,
    pub total_underlying: u64,
    pub total_shares: u64,
    pub protocol_program_id: Pubkey,
    pub protocol_routed_underlying: u64,
    pub last_yield_sync_ts: i64,
    pub status: VaultStatus,
    pub bump: u8,
}

/// PDA seed for the vault state account.
/// Change this to match your protocol, e.g. b"my_protocol_vault_state".
pub const VAULT_STATE_SEED: &[u8] = b"template_vault_state";

/// PDA seed for the vault authority.
/// Change this to match your protocol, e.g. b"my_protocol_vault_authority".
pub const VAULT_AUTHORITY_SEED: &[u8] = b"template_vault_authority";
