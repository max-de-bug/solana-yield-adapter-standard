# Solana Yield Adapter Standard — Specification v1.0

## 1. Abstract

This document defines a standard interface for yield-bearing protocol adapters on Solana. The standard specifies three mandatory instructions, shared account structures, event definitions, and error codes that enable composable, auditable interaction with any yield source.

## 2. Motivation

Solana's DeFi ecosystem includes dozens of yield-bearing protocols, each with unique interfaces. This fragmentation creates:

- **Integration overhead**: Every aggregator must write bespoke code per protocol
- **User confusion**: No consistent way to view yield positions across protocols
- **Security risk**: Each custom integration is a potential attack surface

The Yield Adapter Standard solves this by defining a **minimal, universal interface** that any yield protocol can implement.

## 3. Specification

### 3.1 Required Instructions

Every compliant adapter program MUST implement exactly three instructions:

#### `deposit`

```
Instruction: deposit
Args:
  amount (u64)        — amount of underlying tokens to deposit
  min_shares_out (u64) — minimum receipt tokens to accept (slippage protection; 0 = no minimum)
```

**Behavior**:
1. MUST validate `amount > 0`
2. MUST calculate receipt tokens proportional to the current share price
3. MUST validate `shares >= min_shares_out` (revert with `SlippageExceeded` if below minimum)
4. MUST transfer `amount` of underlying tokens from the user to the adapter vault
5. MUST update internal vault state (total_underlying, total_shares)
6. MUST emit a `DepositEvent`

#### `withdraw`

```
Instruction: withdraw
Args:
  amount (u64)          — amount of receipt/share tokens to burn
  min_underlying_out (u64) — minimum underlying tokens to receive (slippage protection; 0 = no minimum)
```

**Behavior**:
1. MUST validate `amount > 0`
2. MUST validate the user has sufficient receipt token balance
3. MUST calculate underlying tokens proportional to the current share price
4. MUST validate `underlying_amount >= min_underlying_out` (revert with `SlippageExceeded` if below minimum)
5. MUST transfer calculated underlying tokens from vault to user
6. MUST update internal vault state
7. MUST emit a `WithdrawEvent`

#### `current_value`

```
Instruction: current_value
Args: none
```

**Behavior**:
1. MUST resolve the calling user's position (receipt/share balance)
2. MUST compute `value = receipt_balance * total_underlying / total_shares` in underlying token units
3. MUST emit a `CurrentValueEvent` with that per-user `value`
4. MUST NOT reduce user receipt balances (read-only; optional yield accrual may update global vault NAV)

### 3.2 Share Price Calculation

The standard uses a **share-based vault model** where:

```
share_price = total_underlying * 1e9 / total_shares
shares_out  = deposit_amount * 1e9 / share_price
underlying_out = shares_burned * share_price / 1e9
```

The scaling factor of `1e9` provides sufficient precision for most token decimals.

**Initial deposit**: When `total_shares == 0`, the ratio is `1:1` (share_price = 1e9).

### 3.3 Required Accounts

#### Vault State

Each adapter MUST maintain a vault state PDA containing at minimum:

| Field | Type | Description |
|---|---|---|
| `authority` | `Pubkey` | Admin authority |
| `underlying_mint` | `Pubkey` | Mint of the underlying token |
| `total_underlying` | `u64` | Total underlying in vault |
| `total_shares` | `u64` | Total receipt tokens outstanding |
| `status` | `VaultStatus` | `Active`, `Paused`, `Deprecated`, or `DepositsPaused` (defined in `yield-adapter-trait`) |
| `bump` | `u8` | PDA bump seed |

#### Vault Authority

Each adapter MUST use a **PDA-derived authority** for vault token transfers. This ensures funds cannot be moved without program authorization.

### 3.4 Required Events

#### DepositEvent

```rust
#[event]
pub struct DepositEvent {
    pub user: Pubkey,        // Depositor
    pub adapter: Pubkey,     // Adapter program ID
    pub amount: u64,         // Underlying tokens deposited
    pub receipt_amount: u64, // Receipt tokens received
    pub timestamp: i64,      // Unix timestamp
}
```

#### WithdrawEvent

```rust
#[event]
pub struct WithdrawEvent {
    pub user: Pubkey,
    pub adapter: Pubkey,
    pub amount: u64,         // Underlying tokens withdrawn
    pub receipt_burned: u64, // Receipt tokens burned
    pub timestamp: i64,
}
```

#### CurrentValueEvent

```rust
#[event]
pub struct CurrentValueEvent {
    pub user: Pubkey,
    pub adapter: Pubkey,
    pub value: u64,          // User position value in underlying token units
    pub timestamp: i64,
}
```

### 3.5 Required Error Codes

Compliant adapters MUST use the following error code ranges:

| Range | Purpose |
|---|---|
| `6000–6099` | Standard adapter errors (defined in `yield-adapter-trait`) |
| `6100–6199` | Dispatcher errors |
| `6200–6299` | Registry errors |
| `7000+` | Protocol-specific adapter errors |

### 3.6 Slippage Protection

Every `deposit` and `withdraw` instruction accepts a **minimum output amount** as its second argument:

| Instruction | Parameter | Check | Protects against |
|---|---|---|---|
| `deposit` | `min_shares_out` | `shares >= min_shares_out` | Share price dilution before deposit lands |
| `withdraw` | `min_underlying_out` | `underlying_amount >= min_underlying_out` | Pool manipulation before withdrawal lands |

The check is performed **after** the share/underlying calculation but **before** any token transfer or state mutation, so a reverted transaction leaves all accounts untouched. Passing `0` disables the check.

The corresponding error code is `SlippageExceeded` (6012).

### 3.7 Vault Status

Every adapter vault state includes a `status: VaultStatus` field, defined as the `VaultStatus` enum in `yield-adapter-trait`:

| Value | Variant | Meaning |
|---|---|---|
| `0` | `Active` | Deposits and withdrawals allowed |
| `1` | `Paused` | Operations blocked, config intact |
| `2` | `Deprecated` | Vault permanently retired |
| `3` | `DepositsPaused` | Deposits blocked, withdrawals still allowed |

Adapters SHOULD also implement a `toggle_status` instruction (admin-only) that cycles `Active → DepositsPaused → Paused → Active`. The `Deprecated` status is a terminal state — it can only be set via governance, never by toggling.

### 3.8 Adapter Metadata

Each adapter SHOULD publish an `AdapterMetadata` PDA containing:

| Field | Type | Description |
|---|---|---|
| `name` | `String[32]` | Human-readable name |
| `version` | `u8` | Adapter implementation version |
| `standard_version` | `u8` | Standard version (currently 1) |
| `underlying_mint` | `Pubkey` | Underlying token mint |
| `protocol_program_id` | `Pubkey` | Target protocol's program ID |
| `adapter_program_id` | `Pubkey` | This adapter's program ID |

## 4. Registry

Adapters are registered through the on-chain **Adapter Registry**:

1. **Propose** — Anyone can propose an adapter
2. **Approve** — Governance authority approves
3. **Revoke** — Governance authority revokes

The registry stores `AdapterEntry` PDAs indexed by adapter program ID.

## 5. Versioning

The standard version is tracked by the `standard_version` field in `AdapterMetadata`. Breaking changes to the interface require a new version number.

## 6. Security Requirements

- All arithmetic MUST use `checked_*` operations
- Vault authority MUST be a PDA (no external signers)
- All state-modifying instructions MUST emit events
- Adapter MUST validate token mint matches expected underlying
- Adapter MUST validate `status.can_deposit()` on deposits and `status.can_withdraw()` on withdrawals (`is_operational()` is the logical OR of the two)
- Adapter MUST validate `shares >= min_shares_out` on deposit and `underlying_amount >= min_underlying_out` on withdraw

## 7. Conformance

An adapter is **conformant** if it:

1. Implements all three required instructions (`deposit`, `withdraw`, `current_value`)
2. Emits all required events
3. Uses the standard error code ranges
4. Follows the share-based vault model
5. Uses PDA authority for vault transfers
6. Passes the conformance test suite
