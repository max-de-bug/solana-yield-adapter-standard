//! # Solana Yield Adapter Standard — Core Trait Definitions
//!
//! This crate defines the canonical interface that every yield adapter MUST implement.
//! It provides shared types, error codes, event definitions, and account validation
//! helpers used across the dispatcher, registry, and all adapter programs.
//!
//! ## The Three Required Instructions
//!
//! Every compliant adapter program must expose exactly three instructions:
//!
//! 1. **`deposit`** — Transfer underlying tokens into the yield source, receive receipt tokens.
//! 2. **`withdraw`** — Burn receipt tokens, receive underlying tokens back.
//! 3. **`current_value`** — Query the current value (in underlying units) of a position.
//!
//! ## Design Principles
//!
//! - **Minimal surface area**: Only three instructions keeps the standard easy to implement.
//! - **Composable**: Adapters are standalone programs that can be called directly or via the dispatcher.
//! - **Auditable**: Shared error codes and events make monitoring uniform across all adapters.

use anchor_lang::prelude::*;

// ---------------------------------------------------------------------------
// Vault Status — replaces bool active with explicit states
// ---------------------------------------------------------------------------

/// Operational status of an adapter vault.
///
/// - `Active` — deposits and withdrawals are allowed.
/// - `Paused` — deposits and withdrawals are blocked; config remains intact.
/// - `Deprecated` — vault is permanently retired; no operations allowed.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum VaultStatus {
    Active,
    Paused,
    Deprecated,
}

impl VaultStatus {
    /// Returns `true` if deposits and withdrawals should be allowed.
    pub fn is_operational(&self) -> bool {
        matches!(self, Self::Active)
    }
}

// ---------------------------------------------------------------------------
// Seeds & Constants
// ---------------------------------------------------------------------------

/// PDA seed for adapter position accounts.
pub const ADAPTER_POSITION_SEED: &[u8] = b"adapter_position";

/// PDA seed for adapter vault authority.
pub const VAULT_AUTHORITY_SEED: &[u8] = b"vault_authority";

/// PDA seed for adapter metadata.
pub const ADAPTER_METADATA_SEED: &[u8] = b"adapter_metadata";

/// Maximum length of an adapter name (UTF-8 bytes).
pub const MAX_ADAPTER_NAME_LEN: usize = 32;

/// Maximum length of a metadata URI.
pub const MAX_METADATA_URI_LEN: usize = 200;

/// Current version of the adapter standard.
pub const ADAPTER_STANDARD_VERSION: u8 = 1;

// ---------------------------------------------------------------------------
// Adapter Metadata — stored on-chain by each adapter
// ---------------------------------------------------------------------------

/// On-chain metadata that every adapter program publishes via a PDA.
/// This allows the registry and dispatcher to introspect adapter capabilities.
#[account("yield_adapter")]
#[derive(Debug, InitSpace)]
pub struct AdapterMetadata {
    /// Human-readable adapter name (e.g., "Kamino USDC").
    #[max_len(MAX_ADAPTER_NAME_LEN)]
    pub name: String,

    /// Semantic version of this adapter implementation.
    pub version: u8,

    /// The version of the adapter standard this adapter conforms to.
    pub standard_version: u8,

    /// Mint address of the underlying token (e.g., USDC).
    pub underlying_mint: Pubkey,

    /// Program ID of the target protocol (e.g., Kamino's program).
    pub protocol_program_id: Pubkey,

    /// The adapter program's own ID (for self-referential validation).
    pub adapter_program_id: Pubkey,

    /// Vault status: Active, Paused, or Deprecated.
    pub status: VaultStatus,

    /// Authority that can update this metadata.
    pub authority: Pubkey,

    /// Bump seed for the PDA.
    pub bump: u8,
}

// ---------------------------------------------------------------------------
// User Position — tracks per-user, per-adapter state
// ---------------------------------------------------------------------------

/// Emit the canonical per-user position account in the calling adapter program.
#[macro_export]
macro_rules! define_adapter_position {
    () => {
        /// Tracks a user's position within this adapter.
        #[account]
        #[derive(Debug, InitSpace)]
        pub struct AdapterPosition {
            pub owner: Pubkey,
            pub adapter_program_id: Pubkey,
            pub deposited_amount: u64,
            pub withdrawn_amount: u64,
            pub receipt_token_balance: u64,
            pub last_updated: i64,
            pub last_withdraw_request: i64,
            pub bump: u8,
        }
    };
}

// ---------------------------------------------------------------------------
// Events — emitted by all compliant adapters
// ---------------------------------------------------------------------------

/// Emitted when a deposit is executed through an adapter.
#[event]
pub struct DepositEvent {
    /// The user who deposited.
    pub user: Pubkey,
    /// The adapter program that handled the deposit.
    pub adapter: Pubkey,
    /// Amount of underlying tokens deposited.
    pub amount: u64,
    /// Amount of receipt tokens received.
    pub receipt_amount: u64,
    /// Unix timestamp of the deposit.
    pub timestamp: i64,
}

/// Emitted when a withdrawal is executed through an adapter.
#[event]
pub struct WithdrawEvent {
    /// The user who withdrew.
    pub user: Pubkey,
    /// The adapter program that handled the withdrawal.
    pub adapter: Pubkey,
    /// Amount of underlying tokens withdrawn.
    pub amount: u64,
    /// Amount of receipt tokens burned.
    pub receipt_burned: u64,
    /// Unix timestamp of the withdrawal.
    pub timestamp: i64,
}

/// Emitted when a current value query is executed.
#[event]
pub struct CurrentValueEvent {
    /// The user whose position was queried.
    pub user: Pubkey,
    /// The adapter program queried.
    pub adapter: Pubkey,
    /// Current value in underlying token units.
    pub value: u64,
    /// Unix timestamp of the query.
    pub timestamp: i64,
}

// ---------------------------------------------------------------------------
// Errors — shared across all adapters
// ---------------------------------------------------------------------------

/// Error codes shared across all yield adapter programs.
/// Individual adapters may define additional protocol-specific errors
/// starting from error code 7000+.
#[error_code]
pub enum YieldAdapterError {
    /// `deposit` was called with `amount == 0`. The standard requires a positive underlying transfer.
    #[msg("Deposit amount must be greater than zero")]
    ZeroDepositAmount = 6000,

    /// `withdraw` was called with zero shares to burn, or the burn amount is otherwise invalid.
    #[msg("Withdrawal amount must be greater than zero")]
    ZeroWithdrawAmount,

    /// The user's `AdapterPosition.receipt_token_balance` is less than the shares requested for burn.
    #[msg("Insufficient receipt token balance for withdrawal")]
    InsufficientReceiptBalance,

    /// Vault status is not `VaultStatus::Active` (paused or deprecated).
    #[msg("Adapter is not active")]
    AdapterNotActive,

    /// Vault status is `VaultStatus::Deprecated` — no operations allowed.
    #[msg("Vault is deprecated")]
    VaultDeprecated,

    /// A token account's mint does not match `vault_state.underlying_mint` (wrong SPL mint passed in).
    #[msg("Underlying mint mismatch")]
    MintMismatch,

    /// A remaining account or constraint expected a specific program id (adapter or protocol) and got another key.
    #[msg("Adapter program ID mismatch")]
    AdapterProgramMismatch,

    /// A `checked_add`, `checked_sub`, `checked_mul`, or `checked_div` failed in share or balance math.
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,

    /// Protocol boundary check failed: missing account, non-executable program, or CPI precondition not met.
    #[msg("Protocol CPI call failed")]
    ProtocolCpiError,

    /// Signer does not own the `AdapterPosition` or lacks authority for the instruction (e.g. wrong user PDA).
    #[msg("Unauthorized")]
    Unauthorized,

    /// `AdapterPosition` was read before init or has default/uninitialized owner fields.
    #[msg("Position not initialized")]
    PositionNotInitialized,

    /// `AdapterMetadata` failed validation (version, mint, program id, or layout does not match expectations).
    #[msg("Invalid adapter metadata")]
    InvalidMetadata,
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/// Calculates the share price given total underlying and total shares.
/// Returns the value in underlying units per share, scaled by 1e9 for precision.
///
/// # Arguments
/// * `total_underlying` — Total underlying tokens in the pool/vault.
/// * `total_shares` — Total receipt/share tokens outstanding.
///
/// # Returns
/// Price per share scaled by 1e9, or 1e9 if no shares exist (1:1 initial ratio).
pub fn calculate_share_price(total_underlying: u64, total_shares: u64) -> Result<u64> {
    if total_shares == 0 {
        return Ok(1_000_000_000); // 1:1 initial ratio
    }

    let price = (total_underlying as u128)
        .checked_mul(1_000_000_000)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?
        .checked_div(total_shares as u128)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?;

    Ok(price as u64)
}

/// Converts an amount of underlying tokens to shares at a given share price.
///
/// # Arguments
/// * `underlying_amount` — Amount of underlying tokens to convert.
/// * `share_price` — Current price per share (scaled by 1e9).
///
/// # Returns
/// Number of shares (receipt tokens) corresponding to the underlying amount.
pub fn underlying_to_shares(underlying_amount: u64, share_price: u64) -> Result<u64> {
    if share_price == 0 {
        return Err(YieldAdapterError::ArithmeticOverflow.into());
    }

    let shares = (underlying_amount as u128)
        .checked_mul(1_000_000_000)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?
        .checked_div(share_price as u128)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?;

    Ok(shares as u64)
}

/// Converts an amount of shares to underlying tokens at a given share price.
///
/// # Arguments
/// * `share_amount` — Number of shares to convert.
/// * `share_price` — Current price per share (scaled by 1e9).
///
/// # Returns
/// Amount of underlying tokens corresponding to the shares.
pub fn shares_to_underlying(share_amount: u64, share_price: u64) -> Result<u64> {
    let underlying = (share_amount as u128)
        .checked_mul(share_price as u128)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?
        .checked_div(1_000_000_000)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?;

    Ok(underlying as u64)
}

/// Minted shares for a new deposit at the current pool ratio.
pub fn shares_for_deposit(
    amount: u64,
    total_underlying: u64,
    total_shares: u64,
) -> Result<u64> {
    if total_shares == 0 {
        return Ok(amount);
    }
    let shares = (amount as u128)
        .checked_mul(total_shares as u128)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?
        .checked_div(total_underlying as u128)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?;
    Ok(shares as u64)
}

/// User position value in underlying token units (not scaled share price).
pub fn user_position_underlying_value(
    receipt_token_balance: u64,
    total_underlying: u64,
    total_shares: u64,
) -> Result<u64> {
    if receipt_token_balance == 0 || total_shares == 0 {
        return Ok(0);
    }
    let value = (receipt_token_balance as u128)
        .checked_mul(total_underlying as u128)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?
        .checked_div(total_shares as u128)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?;
    Ok(value as u64)
}

/// Verifies a remaining account is the expected on-chain protocol program.
pub fn verify_protocol_program_account(
    program: &anchor_lang::prelude::AccountInfo,
    expected: Pubkey,
) -> Result<()> {
    require!(
        program.key() == expected,
        YieldAdapterError::AdapterProgramMismatch
    );
    require!(program.executable, YieldAdapterError::ProtocolCpiError);
    Ok(())
}

/// Records deposit volume attested against the protocol program (CPI boundary).
pub fn record_protocol_routing(
    routed_total: &mut u64,
    amount: u64,
    remaining: &[anchor_lang::prelude::AccountInfo],
    expected: Pubkey,
) -> Result<()> {
    if remaining.is_empty() {
        return Ok(());
    }
    verify_protocol_program_account(&remaining[0], expected)?;
    *routed_total = routed_total
        .checked_add(amount)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?;
    msg!(
        "Protocol routing attested: {} underlying via {}",
        amount,
        expected
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Account reads — shared layout across reference adapters (Borsh, not byte offsets)
// ---------------------------------------------------------------------------

/// Common vault header: identical field order on all reference adapter vault PDAs.
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct ReferenceVaultHead {
    pub authority: Pubkey,
    pub underlying_mint: Pubkey,
    pub total_underlying: u64,
    pub total_shares: u64,
}

/// Layout of [`AdapterPosition`] for cross-program reads (discriminator skipped).
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct AdapterPositionData {
    pub owner: Pubkey,
    pub adapter_program_id: Pubkey,
    pub deposited_amount: u64,
    pub withdrawn_amount: u64,
    pub receipt_token_balance: u64,
    pub last_updated: i64,
    pub last_withdraw_request: i64,
    pub bump: u8,
}

const VAULT_HEAD_SIZE: usize = 32 + 32 + 8 + 8;
const POSITION_DATA_SIZE: usize = 32 + 32 + 8 + 8 + 8 + 8 + 8 + 1;

/// Read `total_underlying` and `total_shares` from any reference adapter vault account.
pub fn read_reference_vault_totals(account: &AccountInfo) -> Result<(u64, u64)> {
    let data = account.try_borrow_data()?;
    require!(
        data.len() >= 8 + VAULT_HEAD_SIZE,
        YieldAdapterError::InvalidMetadata
    );
    let mut slice: &[u8] = &data[8..];
    let head = ReferenceVaultHead::deserialize(&mut slice)
        .map_err(|_| YieldAdapterError::InvalidMetadata)?;
    Ok((head.total_underlying, head.total_shares))
}

/// Read `receipt_token_balance` from an adapter position account.
pub fn read_adapter_position_receipt(account: &AccountInfo) -> Result<u64> {
    let data = account.try_borrow_data()?;
    require!(
        data.len() >= 8 + POSITION_DATA_SIZE,
        YieldAdapterError::PositionNotInitialized
    );
    let mut slice: &[u8] = &data[8..];
    let position = AdapterPositionData::deserialize(&mut slice)
        .map_err(|_| YieldAdapterError::PositionNotInitialized)?;
    Ok(position.receipt_token_balance)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // calculate_share_price
    // -----------------------------------------------------------------------

    #[test]
    fn test_share_price_initial() {
        assert_eq!(calculate_share_price(0, 0).unwrap(), 1_000_000_000);
    }

    #[test]
    fn test_share_price_after_deposit() {
        assert_eq!(calculate_share_price(1000, 1000).unwrap(), 1_000_000_000);
    }

    #[test]
    fn test_share_price_with_yield() {
        // 1000 underlying, 500 shares → share_price = 1000 * 1e9 / 500 = 2_000_000_000
        assert_eq!(calculate_share_price(1000, 500).unwrap(), 2_000_000_000);
    }

    #[test]
    fn test_share_price_with_loss() {
        // 500 underlying, 1000 shares → share_price = 500 * 1e9 / 1000 = 500_000_000
        assert_eq!(calculate_share_price(500, 1000).unwrap(), 500_000_000);
    }

    #[test]
    fn test_share_price_large_values_no_panic() {
        // Large values should not overflow during u128 intermediates.
        let price = calculate_share_price(1_000_000_000_000_000u64, 3_000_000u64).unwrap();
        assert!(price > 0);
    }

    // -----------------------------------------------------------------------
    // underlying_to_shares
    // -----------------------------------------------------------------------

    #[test]
    fn test_underlying_to_shares_at_par() {
        assert_eq!(underlying_to_shares(1000, 1_000_000_000).unwrap(), 1000);
    }

    #[test]
    fn test_underlying_to_shares_half_price() {
        // share_price = 0.5 (500_000_000) → shares = 1000 * 1e9 / 500_000_000 = 2000
        assert_eq!(underlying_to_shares(1000, 500_000_000).unwrap(), 2000);
    }

    #[test]
    fn test_underlying_to_shares_zero_price() {
        assert!(underlying_to_shares(1000, 0).is_err());
    }

    // -----------------------------------------------------------------------
    // shares_to_underlying
    // -----------------------------------------------------------------------

    #[test]
    fn test_shares_to_underlying_at_par() {
        assert_eq!(shares_to_underlying(1000, 1_000_000_000).unwrap(), 1000);
    }

    #[test]
    fn test_shares_to_underlying_double_price() {
        // share_price = 2.0 → underlying = 1000 * 2e9 / 1e9 = 2000
        assert_eq!(shares_to_underlying(1000, 2_000_000_000).unwrap(), 2000);
    }

    // -----------------------------------------------------------------------
    // shares_for_deposit
    // -----------------------------------------------------------------------

    #[test]
    fn test_first_deposit_onetoone() {
        assert_eq!(shares_for_deposit(1000, 0, 0).unwrap(), 1000);
    }

    #[test]
    fn test_second_deposit_proportional() {
        // 1000 total, 1000 shares → share_price = 1.0, deposit 500 → 500 shares
        assert_eq!(shares_for_deposit(500, 1000, 1000).unwrap(), 500);
    }

    #[test]
    fn test_deposit_when_pool_has_yield() {
        // 2000 underlying, 1000 shares → share_price = 2.0, deposit 1000 → 500 shares
        assert_eq!(shares_for_deposit(1000, 2000, 1000).unwrap(), 500);
    }

    #[test]
    fn test_deposit_rounds_down() {
        // 1000 underlying, 3 shares → share_price = 333_333_333, deposit 1000 → 1000 * 3 / 1000 = 3
        assert_eq!(shares_for_deposit(1000, 1000, 3).unwrap(), 3);
    }

    // -----------------------------------------------------------------------
    // user_position_underlying_value
    // -----------------------------------------------------------------------

    #[test]
    fn test_zero_balance() {
        assert_eq!(user_position_underlying_value(0, 1000, 1000).unwrap(), 0);
    }

    #[test]
    fn test_zero_shares() {
        assert_eq!(user_position_underlying_value(500, 0, 0).unwrap(), 0);
    }

    #[test]
    fn test_position_value_par() {
        assert_eq!(user_position_underlying_value(500, 1000, 1000).unwrap(), 500);
    }

    #[test]
    fn test_position_value_after_yield() {
        // 500 shares out of 1000 → 50%, 2000 underlying → value = 1000
        assert_eq!(
            user_position_underlying_value(500, 2000, 1000).unwrap(),
            1000
        );
    }

    #[test]
    fn test_position_value_after_loss() {
        // 500 shares out of 1000 → 50%, 500 underlying → value = 250
        assert_eq!(user_position_underlying_value(500, 500, 1000).unwrap(), 250);
    }

    // -----------------------------------------------------------------------
    // Edge cases
    // -----------------------------------------------------------------------

    #[test]
    fn test_large_numbers_no_overflow() {
        let total = 1_000_000_000_000u64;
        let shares = 3_000_000_000u64;
        let price = calculate_share_price(total, shares).unwrap();
        assert!(price > 0);

        let deposit = 500_000_000_000u64;
        let result = shares_for_deposit(deposit, total, shares).unwrap();
        assert!(result > 0);

        let value = user_position_underlying_value(shares / 2, total, shares).unwrap();
        assert!(value > 0);
    }
}
