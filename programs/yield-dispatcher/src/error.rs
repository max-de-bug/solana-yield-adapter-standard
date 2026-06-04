use anchor_lang::prelude::*;

/// Dispatcher-specific error codes.
#[error_code]
pub enum DispatcherError {
    /// The dispatcher is currently paused.
    #[msg("Dispatcher is paused")]
    DispatcherPaused = 6100,

    /// The adapter is not registered or not approved in the registry.
    #[msg("Adapter not registered or not approved")]
    AdapterNotApproved,

    /// The deposit amount must be greater than zero.
    #[msg("Amount must be greater than zero")]
    ZeroAmount,

    /// Only the dispatcher authority can perform this action.
    #[msg("Unauthorized: not the dispatcher authority")]
    Unauthorized,

    /// The adapter CPI call returned an error.
    #[msg("Adapter CPI call failed")]
    AdapterCpiError,

    /// The registry program ID does not match the expected value.
    #[msg("Registry program mismatch")]
    RegistryMismatch,
}
