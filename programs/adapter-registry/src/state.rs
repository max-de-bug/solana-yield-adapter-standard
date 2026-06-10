use anchor_lang::prelude::*;
use yield_adapter_trait::{MAX_ADAPTER_NAME_LEN, MAX_METADATA_URI_LEN};

// ---------------------------------------------------------------------------
// Registry State
// ---------------------------------------------------------------------------

/// Global registry configuration. Singleton PDA.
#[account]
#[derive(Debug, InitSpace)]
pub struct RegistryState {
    /// The governance authority who can approve/revoke adapters.
    pub authority: Pubkey,

    /// Pending governance authority for two-step transfer.
    pub pending_authority: Option<Pubkey>,

    /// Total number of adapters ever proposed.
    pub total_proposed: u64,

    /// Total number of currently approved adapters.
    pub total_approved: u64,

    /// Bump seed for the PDA.
    pub bump: u8,
}

pub const REGISTRY_STATE_SEED: &[u8] = b"registry_state";

// ---------------------------------------------------------------------------
// Adapter Entry
// ---------------------------------------------------------------------------

/// The status of an adapter in the registry.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq, InitSpace)]
pub enum AdapterStatus {
    /// Adapter has been proposed but not yet approved.
    Proposed,
    /// Adapter has been approved by governance.
    Approved,
    /// Adapter has been revoked by governance.
    Revoked,
}

/// On-chain record for a registered adapter.
/// PDA seeded by `[ADAPTER_ENTRY_SEED, adapter_program_id]`.
#[account]
#[derive(Debug, InitSpace)]
pub struct AdapterEntry {
    /// The adapter program's ID.
    pub adapter_program_id: Pubkey,

    /// Human-readable adapter name.
    #[max_len(MAX_ADAPTER_NAME_LEN)]
    pub name: String,

    /// Current approval status.
    pub status: AdapterStatus,

    /// Mint of the underlying token this adapter handles.
    pub underlying_mint: Pubkey,

    /// URI pointing to off-chain metadata (JSON).
    #[max_len(MAX_METADATA_URI_LEN)]
    pub metadata_uri: String,

    /// The PDA seed bytes used by this adapter for its vault state account.
    /// Allows the dispatcher to validate vault state PDAs without hardcoding.
    #[max_len(32)]
    pub vault_state_seed: Vec<u8>,

    /// The account that proposed this adapter.
    pub proposer: Pubkey,

    /// Timestamp when the adapter was proposed.
    pub proposed_at: i64,

    /// Timestamp when the adapter was approved (0 if not approved).
    pub approved_at: i64,

    /// Timestamp when the adapter was revoked (0 if not revoked).
    pub revoked_at: i64,

    /// Bump seed for the PDA.
    pub bump: u8,
}

pub const ADAPTER_ENTRY_SEED: &[u8] = b"adapter_entry";
