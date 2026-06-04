use anchor_lang::prelude::*;

/// Emitted when the dispatcher routes a deposit to an adapter.
#[event]
pub struct DispatchDepositEvent {
    pub user: Pubkey,
    pub adapter_program_id: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

/// Emitted when the dispatcher routes a withdrawal from an adapter.
#[event]
pub struct DispatchWithdrawEvent {
    pub user: Pubkey,
    pub adapter_program_id: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

/// Emitted when a current value query is dispatched.
#[event]
pub struct DispatchCurrentValueEvent {
    pub user: Pubkey,
    pub adapter_program_id: Pubkey,
    pub value: u64,
    pub timestamp: i64,
}

/// Emitted when the dispatcher is initialized.
#[event]
pub struct DispatcherInitializedEvent {
    pub authority: Pubkey,
    pub registry_program_id: Pubkey,
    pub timestamp: i64,
}
