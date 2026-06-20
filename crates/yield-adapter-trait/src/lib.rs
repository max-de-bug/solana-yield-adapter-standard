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
use anchor_lang::solana_program::program::{get_return_data, set_return_data};

// ---------------------------------------------------------------------------
// Vault Status — replaces bool active with explicit states
// ---------------------------------------------------------------------------

/// Operational status of an adapter vault.
///
/// - `Active` — deposits and withdrawals are allowed.
/// - `DepositsPaused` — deposits blocked, withdrawals still allowed.
/// - `Paused` — deposits and withdrawals are blocked; config remains intact.
/// - `Deprecated` — vault is permanently retired; no operations allowed.
///
/// # Serialization order
/// `DepositsPaused` is appended **after** `Deprecated` so that the Borsh
/// discriminants of the original three variants (`Active` = 0, `Paused` = 1,
/// `Deprecated` = 2) remain unchanged — preserving backward compatibility
/// with all existing on-chain vault accounts.
#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug, Default,
)]
#[repr(u8)]
pub enum VaultStatus {
    #[default]
    Active,
    Paused,
    Deprecated,
    DepositsPaused,
}

impl VaultStatus {
    /// Returns `true` if the vault is not deprecated and not fully paused.
    /// Withdrawals are allowed when operational (even during `DepositsPaused`).
    pub fn is_operational(&self) -> bool {
        matches!(self, Self::Active | Self::DepositsPaused)
    }

    /// Returns `true` if deposits are currently allowed.
    pub fn can_deposit(&self) -> bool {
        matches!(self, Self::Active)
    }

    /// Returns `true` if withdrawals are currently allowed.
    pub fn can_withdraw(&self) -> bool {
        matches!(self, Self::Active | Self::DepositsPaused)
    }
}

impl core::fmt::Display for VaultStatus {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::Active => write!(f, "active"),
            Self::Paused => write!(f, "paused"),
            Self::Deprecated => write!(f, "deprecated"),
            Self::DepositsPaused => write!(f, "deposits_paused"),
        }
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

    /// Vault status is not `VaultStatus::Active` (paused, deposits paused, or deprecated).
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

    /// The calculated output amount (shares for deposit, underlying for withdraw) is below the
    /// user-specified minimum. Protects against pool manipulation (sandwich attacks, MEV).
    #[msg("Output amount below minimum slippage tolerance")]
    SlippageExceeded,
}

// ---------------------------------------------------------------------------
// Protocol-exact value math: u256 long-division for Kamino-style big-fraction
// ---------------------------------------------------------------------------

/// Multiply a u64 by a u128, then divide by a u64, using exact u256 arithmetic.
///
/// The computation `a * b / divisor` is performed with a 192-bit intermediate
/// (three 64-bit limbs) to avoid overflow. This is needed for protocol-exact
/// `current_value` computations where the intermediate product exceeds 128 bits
/// (e.g. Kamino's collateral→liquidity conversion which uses U68F60 big-fraction
/// math, or Drift's insurance-fund share calculations).
///
/// Returns `None` if `divisor` is zero or the quotient exceeds u128.
pub fn mul_div_u64(a: u64, b: u128, divisor: u64) -> Option<u128> {
    if divisor == 0 {
        return None;
    }
    // Split b into low and high 64-bit halves.
    let mask = u64::MAX as u128;
    let lo = (a as u128) * (b & mask); // a * b_lo   (≤ u64::MAX * u64::MAX ≈ 3.4e38)
    let hi = (a as u128) * (b >> 64); // a * b_hi   (≥ 0)
                                      // Distribute across three 64-bit limbs [p2, p1, p0] = a * b:
                                      //   p0 = low 64 bits of lo
                                      //   p1 = high 64 bits of lo + low 64 bits of hi
                                      //   p2 = high 64 bits of hi + carry from p1
    let p0 = (lo & mask) as u64;
    let mid = (lo >> 64) + (hi & mask);
    let p1 = (mid & mask) as u64;
    let p2 = ((hi >> 64) + (mid >> 64)) as u64;
    // Schoolbook long-division over the three limb words.
    let d = divisor as u128;
    let mut rem: u128 = 0;
    let mut q = [0u64; 3];
    for (i, &limb) in [p2, p1, p0].iter().enumerate() {
        let acc = (rem << 64) | (limb as u128);
        q[i] = (acc / d) as u64;
        rem = acc % d;
    }
    // If the high limb of the quotient is non-zero, the result overflows u128.
    if q[0] != 0 {
        return None;
    }
    Some(((q[1] as u128) << 64) | (q[2] as u128))
}

/// Multiply two u64 values and divide by a third, using exact u256 arithmetic.
///
/// Equivalent to `a * b / divisor` but computed with a 128-bit intermediate
/// (promoted to u128 within [`mul_div_u64`]) to guarantee no overflow.
///
/// Returns `None` if `divisor` is zero or the quotient exceeds u64.
pub fn mul_div_u64_u64(a: u64, b: u64, divisor: u64) -> Option<u64> {
    let result = mul_div_u64(a, b as u128, divisor)?;
    if result > u64::MAX as u128 {
        return None;
    }
    Some(result as u64)
}

// ---------------------------------------------------------------------------
// Legacy 1e9-scaled helpers — kept for backward compatibility
// ---------------------------------------------------------------------------

/// Calculate share price (scaled by 1e9) using exact u256 arithmetic.
///
/// Returns 1e9 (1:1 ratio) when `total_shares` is zero (empty pool).
pub fn calculate_share_price(total_underlying: u64, total_shares: u64) -> Result<u64> {
    if total_shares == 0 {
        return Ok(1_000_000_000);
    }
    let price = mul_div_u64(total_underlying, 1_000_000_000u128, total_shares)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?;
    if price > u64::MAX as u128 {
        return Err(YieldAdapterError::ArithmeticOverflow.into());
    }
    Ok(price as u64)
}

/// Convert underlying tokens to shares at a given (1e9-scaled) share price.
pub fn underlying_to_shares(underlying_amount: u64, share_price: u64) -> Result<u64> {
    if share_price == 0 {
        return Err(YieldAdapterError::ArithmeticOverflow.into());
    }
    let shares = mul_div_u64(underlying_amount, 1_000_000_000u128, share_price)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?;
    if shares > u64::MAX as u128 {
        return Err(YieldAdapterError::ArithmeticOverflow.into());
    }
    Ok(shares as u64)
}

/// Convert shares to underlying tokens at a given (1e9-scaled) share price.
pub fn shares_to_underlying(share_amount: u64, share_price: u64) -> Result<u64> {
    let underlying = mul_div_u64(share_amount, share_price as u128, 1_000_000_000)
        .ok_or(YieldAdapterError::ArithmeticOverflow)?;
    if underlying > u64::MAX as u128 {
        return Err(YieldAdapterError::ArithmeticOverflow.into());
    }
    Ok(underlying as u64)
}

/// Compute shares minted for a deposit at the current pool ratio (protocol-exact).
///
/// Uses u256 arithmetic so that `amount * total_shares / total_underlying` never
/// overflows even when both `amount` and `total_shares` are near u64::MAX.
///
/// Returns `amount` when `total_shares == 0` (first depositor, 1:1 ratio).
pub fn shares_for_deposit(amount: u64, total_underlying: u64, total_shares: u64) -> Result<u64> {
    if total_shares == 0 {
        return Ok(amount);
    }
    mul_div_u64_u64(amount, total_shares, total_underlying)
        .ok_or(YieldAdapterError::ArithmeticOverflow.into())
}

/// Compute user position value in underlying tokens (protocol-exact).
///
/// Uses u256 arithmetic so that `receipt_token_balance * total_underlying / total_shares`
/// never overflows even when both operands are near u64::MAX.
///
/// Returns 0 when `receipt_token_balance` or `total_shares` is zero.
pub fn user_position_underlying_value(
    receipt_token_balance: u64,
    total_underlying: u64,
    total_shares: u64,
) -> Result<u64> {
    if receipt_token_balance == 0 || total_shares == 0 {
        return Ok(0);
    }
    mul_div_u64_u64(receipt_token_balance, total_underlying, total_shares)
        .ok_or(YieldAdapterError::ArithmeticOverflow.into())
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
// CPI Return Data Protocol
// ---------------------------------------------------------------------------

/// Set a u64 as CPI return data for the calling program (dispatcher) to read.
///
/// Each adapter MUST call this in `deposit`, `withdraw`, and `current_value`
/// after all state mutations and CPIs are complete, so the dispatcher can
/// verify the result without reading account state directly.
///
/// # Values by instruction
/// - `deposit`: `shares_minted` (u64)
/// - `withdraw`: `underlying_amount_out` (u64)
/// - `current_value`: `position_value_underlying` (u64)
pub fn set_cpi_return_value(value: u64) {
    set_return_data(&value.to_le_bytes());
}

/// Read a u64 CPI return value set by the last CPI'd adapter program.
///
/// Returns `None` when:
/// - No return data was set (backward compat with adapters before this protocol)
/// - The data is not exactly 8 bytes
/// - The program that set the data does not match `expected_program`
pub fn try_read_cpi_return_value(expected_program: &Pubkey) -> Option<u64> {
    let (program_id, data) = get_return_data()?;
    if program_id != *expected_program {
        return None;
    }
    if data.len() != 8 {
        return None;
    }
    let mut bytes = [0u8; 8];
    bytes.copy_from_slice(&data);
    Some(u64::from_le_bytes(bytes))
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
        assert_eq!(
            user_position_underlying_value(500, 1000, 1000).unwrap(),
            500
        );
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
