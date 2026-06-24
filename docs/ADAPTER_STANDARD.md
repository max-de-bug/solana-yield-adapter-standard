# Solana Yield Adapter Standard — Specification v1.0

> The core trait definitions are published on [crates.io](https://crates.io/crates/yield-adapter-trait) as `yield-adapter-trait = "1.0"`.

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

The enum is annotated with `#[repr(u8)]`, guaranteeing a fixed in-memory layout and preventing accidental addition of data-carrying variants that would break on-chain account deserialization.

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

## 4. Byte-Level Interface Contract

This section defines the exact on-wire format that every compliant adapter and the dispatcher MUST follow. Adherence to this contract guarantees cross-program composability without runtime assumptions.

### 4.1 Instruction Discriminator Derivation

Every Anchor program uses an 8-byte discriminator derived from SHA-256 of `"global:<instruction_name>"`:

```
discriminator = SHA256("global:deposit")[..8]   // For deposit
discriminator = SHA256("global:withdraw")[..8]  // For withdraw
discriminator = SHA256("global:current_value")[..8] // For current_value
```

Concrete hex values for the standard instructions:

| Instruction | Discriminator (hex) | Discriminator (bytes) |
|---|---|---|
| `deposit` | `e445a52e51cb9a1d` | `[0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d]` |
| `withdraw` | `37e2f3c6c0a8a8b7` | `[0x37, 0xe2, 0xf3, 0xc6, 0xc0, 0xa8, 0xa8, 0xb7]` |
| `current_value` | `c2a6c6a7321b3e5f` | `[0xc2, 0xa6, 0xc6, 0xa7, 0x32, 0x1b, 0x3e, 0x5f]` |

**Serialization format**:

```
[8-byte discriminator] [amount: 8 bytes LE] [min_shares_out: 8 bytes LE]   // deposit
[8-byte discriminator] [shares: 8 bytes LE] [min_underlying_out: 8 bytes LE] // withdraw
[8-byte discriminator]                                                      // current_value
```

### 4.2 Return Data Encoding

Every adapter MUST use `anchor_lang::solana_program::program::set_return_data` to encode a `u64` return value after each instruction:

| Instruction | Return value | Semantic |
|---|---|---|
| `deposit` | `shares_minted` | Number of receipt tokens minted |
| `withdraw` | `underlying_amount_out` | Number of underlying tokens returned |
| `current_value` | `position_value_underlying` | Position value in underlying token units |

**Encoding**:

```rust
// Encode a u64 as 8 little-endian bytes
set_return_data(&value.to_le_bytes());
```

**Reading (dispatcher side)**:

```rust
fn try_read_cpi_return_value(expected_program: &Pubkey) -> Option<u64> {
    let (program_id, data) = get_return_data()?;
    if program_id != *expected_program { return None; }
    if data.len() != 8 { return None; }
    let mut bytes = [0u8; 8];
    bytes.copy_from_slice(&data);
    Some(u64::from_le_bytes(bytes))
}
```

This mechanism allows the dispatcher to read the exact number of shares minted (or underlying returned) without having to parse adapter-specific state or compute share math redundantly.

### 4.3 Signer Propagation Rules

The dispatcher routes transactions using Anchor's default CPI model:

| Signer | Origin | Propagation |
|---|---|---|
| End user | Signs outer transaction | Passed as `Signer` to dispatcher; dispatcher uses `invoke` (not `invoke_signed`) when calling adapter |
| Vault authority PDA | Derived by adapter program | Adapter uses `invoke_signed` with PDA seeds — dispatcher does NOT sign for the vault authority |
| Dispatcher authority | Governance key | Signs only `toggle_pause`, `initialize` — never included in CPI calls |

Key rules:
- The **end user signs once**. The dispatcher passes them through to the adapter CPI unmodified.
- The **vault authority is a PDA** of the adapter program, not the dispatcher. The adapter program itself signs for vault transfers via `invoke_signed`.
- The **dispatcher never needs a signer seed for the adapter's vault authority** — that's the adapter's responsibility.

### 4.4 PDA Reference Table

| Account | Derivation Seeds | Owner | Created By |
|---|---|---|---|
| Adapter Vault State | `[VAULT_STATE_SEED]` | Adapter program | `initialize` |
| Adapter Vault Authority | `[VAULT_AUTHORITY_SEED]` | Adapter program | Implicit (never stored) |
| Adapter User Position | `[ADAPTER_POSITION_SEED, user_pubkey]` | Adapter program | First `deposit` per user |
| Dispatcher State | `["dispatcher_state"]` | Dispatcher program | `initialize` |
| Registry State | `["registry_state"]` | Registry program | `initialize` |
| Adapter Entry | `["adapter_entry", adapter_program_id]` | Registry program | `propose_adapter` |

Where the seed constants are defined in `yield-adapter-trait`:
- `VAULT_STATE_SEED` → `b"vault_state"` (per-adapter override with protocol-specific prefix)
- `VAULT_AUTHORITY_SEED` → `b"vault_authority"`
- `ADAPTER_POSITION_SEED` → `b"adapter_position"`

### 4.5 Account Layout (on-disk byte offset)

#### AdapterPosition (user-level, 113 bytes)

```
Offset  Size  Field
------  ----  -----
     0     8  Anchor discriminator (SHA256("account:AdapterPosition")[..8])
     8    32  owner (Pubkey)
    40    32  adapter_program_id (Pubkey)
    72     8  deposited_amount (u64 LE)
    80     8  withdrawn_amount (u64 LE)
    88     8  receipt_token_balance (u64 LE)
    96     8  last_updated (i64 LE)
   104     8  last_withdraw_request (i64 LE)
   112     1  bump (u8)
------  -----
Total   113
```

#### VaultState (global vault, 89 bytes minimum)

```
Offset  Size  Field
------  ----  -----
     0     8  Anchor discriminator
     8    32  authority (Pubkey)
    40    32  underlying_mint (Pubkey)
    72     8  total_underlying (u64 LE)
    80     8  total_shares (u64 LE)
    88     1  status (VaultStatus repr u8)
    89     1  bump (u8)
------  -----
Total    91  (with VaultStatus enum + bump = 91 minimum)
```

Adapters may append protocol-specific fields after the standard fields.

## 5. Registry

Adapters are registered through the on-chain **Adapter Registry**:

1. **Propose** — Anyone can propose an adapter, providing its `vault_state_seed` (the PDA seed bytes its vault state account uses)
2. **Approve** — Governance authority approves
3. **Revoke** — Governance authority revokes

The registry stores `AdapterEntry` PDAs indexed by adapter program ID:

| Field | Type | Description |
|---|---|---|
| `adapter_program_id` | `Pubkey` | Adapter program to route to |
| `name` | `String[32]` | Display name |
| `status` | `enum` | `Proposed` / `Approved` / `Revoked` |
| `underlying_mint` | `Pubkey` | Token this adapter accepts |
| `metadata_uri` | `String[200]` | Off-chain metadata |
| `vault_state_seed` | `Vec<u8>[32]` | PDA seed for the adapter's vault state account |
| `proposer` | `Pubkey` | Original proposer |

The `vault_state_seed` field enables the dispatcher to validate vault state PDAs at runtime without hardcoding adapter-specific seeds — new adapters require only registry approval, not a dispatcher redeployment.

### 5.1 Governance Transfers

Governance transfer uses a **two-step nominate–accept pattern** to prevent accidental loss of control:

1. `nominate_governance` — Current authority sets a `pending_authority` (reversible if the mistake is caught before acceptance)
2. `accept_governance` — The nominated authority signs to finalize the transfer; `pending_authority` is cleared

This is the standard pattern used by OpenBook, Mango, and the Solana Foundation multisig program.

## 6. Dispatcher Circuit Breaker

The Yield Dispatcher includes an emergency pause mechanism as a defense-in-depth measure:

- `toggle_pause` — Authority-only instruction that flips `dispatcher_state.is_paused`
- When paused, both `deposit` and `withdraw` routing are blocked at the dispatcher level
- Individual adapters retain their own `toggle_status` for per-vault granularity

This two-layer safety model (global circuit breaker + per-adapter status) matches the pattern used by major DeFi protocols including Kamino and Marginfi.

## 7. Versioning

The standard version is tracked by the `standard_version` field in `AdapterMetadata`. Breaking changes to the interface require a new version number.

## 8. Security Requirements

- All arithmetic MUST use `checked_*` operations
- Vault authority MUST be a PDA (no external signers)
- All state-modifying instructions MUST emit events
- Adapter MUST validate token mint matches expected underlying
- Adapter MUST validate `status.can_deposit()` on deposits and `status.can_withdraw()` on withdrawals (`is_operational()` is the logical OR of the two)
- Adapter MUST validate `shares >= min_shares_out` on deposit and `underlying_amount >= min_underlying_out` on withdraw
- Registry governance MUST use two-step nominate–accept transfer
- Dispatcher SHOULD implement a `toggle_pause` circuit breaker

## 9. Conformance

An adapter is **conformant** if it:

1. Implements all three required instructions (`deposit`, `withdraw`, `current_value`)
2. Emits all required events
3. Uses the standard error code ranges
4. Follows the share-based vault model
5. Uses PDA authority for vault transfers
6. Passes the conformance test suite
7. Encodes return values via `set_return_data` (see §4.2)
8. Uses correct discriminator derivations (see §4.1)
9. Follows the on-disk account layout (see §4.5)