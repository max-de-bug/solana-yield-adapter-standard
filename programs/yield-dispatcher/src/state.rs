use anchor_lang::prelude::*;

/// Global dispatcher configuration.
/// There is exactly one instance of this account per deployment.
#[account]
#[derive(Debug, InitSpace)]
pub struct DispatcherState {
    /// The governance authority who can update dispatcher configuration.
    pub authority: Pubkey,

    /// The adapter registry program ID that this dispatcher trusts.
    pub registry_program_id: Pubkey,

    /// Total number of deposits routed through this dispatcher.
    pub total_deposits: u64,

    /// Total number of withdrawals routed through this dispatcher.
    pub total_withdrawals: u64,

    /// Whether the dispatcher is paused (emergency stop).
    pub is_paused: bool,

    /// Bump seed for the PDA.
    pub bump: u8,
}

/// Seed for the dispatcher state PDA.
pub const DISPATCHER_STATE_SEED: &[u8] = b"dispatcher_state";

/// Tracks a user's position within a specific adapter, managed by the dispatcher.
#[account]
#[derive(Debug, InitSpace)]
pub struct UserPosition {
    /// The user who owns this position.
    pub owner: Pubkey,

    /// The adapter program this position is associated with.
    pub adapter_program_id: Pubkey,

    /// Total underlying tokens deposited through the dispatcher.
    pub deposited_amount: u64,

    /// Total underlying tokens withdrawn through the dispatcher.
    pub withdrawn_amount: u64,

    /// Current receipt/share token balance.
    pub receipt_token_balance: u64,

    /// Timestamp of the last interaction.
    pub last_updated: i64,

    /// Bump seed for the PDA.
    pub bump: u8,
}

/// Seed for user position PDAs.
pub const USER_POSITION_SEED: &[u8] = b"user_position";
