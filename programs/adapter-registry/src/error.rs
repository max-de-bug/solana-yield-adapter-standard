use anchor_lang::prelude::*;

#[error_code]
pub enum RegistryError {
    /// Only the governance authority can perform this action.
    #[msg("Unauthorized: not the governance authority")]
    Unauthorized = 6200,

    /// Adapter name exceeds the maximum allowed length.
    #[msg("Adapter name too long")]
    NameTooLong,

    /// Metadata URI exceeds the maximum allowed length.
    #[msg("Metadata URI too long")]
    UriTooLong,

    /// The adapter is not in the expected status for this operation.
    #[msg("Invalid adapter status for this operation")]
    InvalidStatus,

    /// An adapter with this program ID already exists in the registry.
    #[msg("Adapter already registered")]
    AlreadyRegistered,

    /// No pending governance transfer exists.
    #[msg("No pending governance transfer")]
    NoPendingTransfer,

    /// The signer is not the pending authority.
    #[msg("Not the pending governance authority")]
    NotPendingAuthority,
}
