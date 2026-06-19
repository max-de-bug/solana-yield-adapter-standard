# @solana-yield-adapter/sdk

TypeScript SDK for the Solana Yield Adapter Standard — interact with yield adapter programs, the on-chain registry, and the yield dispatcher.

## Installation

```bash
npm install @solana-yield-adapter/sdk
```

Requires `@solana/web3.js ^1.95.8`, `@solana/spl-token ^0.4.13`, `@anchor-lang/core ^1.0.1`, and `bn.js ^5.2.1`.

## Quick Start

```typescript
import { AdapterClient, RegistryClient, DispatcherClient } from "@solana-yield-adapter/sdk";
import { Program } from "@anchor-lang/core";
import { AnchorProvider } from "@anchor-lang/core";

const provider = AnchorProvider.env();
const program = anchor.workspace.AdapterKamino as Program;

// Adapter client — vault initialization and PDA derivation
const adapter = new AdapterClient(program, provider, "kamino");
const [vaultState] = adapter.vaultStatePda();
await adapter.initializeVault(authority.publicKey, underlyingMint);

// Registry client — propose and approve adapters
const registry = new RegistryClient(registryProgram, provider);
await registry.proposeAndApprove(authority.publicKey, program.programId,
  underlyingMint, "kamino", "https://uri", "kamino_vault_state");

// Dispatcher client — deposit through the router
const dispatcher = new DispatcherClient(dispatcherProgram, provider);
await dispatcher.deposit(user, amount, minSharesOut, registryProgramId,
  program.programId, adapterEntryPda, { ...accounts });
```

## Modules

### `constants`
Canonical mainnet program IDs (Kamino, Marginfi, Drift, Jupiter, Orca), token mints (USDC, syrupUSDC), PDA seeds, and adapter name definitions.

```typescript
import { MAINNET_USDC_MINT, KAMINO_PROGRAM_ID, AdapterName, isMainnetFork } from "@solana-yield-adapter/sdk";
```

### `pda`
PDA derivation functions for all system accounts — registry, dispatcher, adapter vaults, and user positions.

```typescript
import { registryStatePda, adapterEntryPda, dispatcherStatePda, adapterVaultStatePda } from "@solana-yield-adapter/sdk";
```

### `accounts`
On-chain account interfaces and fetch helpers for vault state, adapter positions, dispatcher state, registry state, and adapter entries.

```typescript
import { VaultStateAccount, AdapterPositionAccount, fetchVaultState, getTokenBalance } from "@solana-yield-adapter/sdk";
```

### `token`
SPL token helpers for localnet testing: airdrop, create mint, create token account, mint, and transfer.

```typescript
import { airdrop, createTestMint, createTokenAccount } from "@solana-yield-adapter/sdk";
```

### `RegistryClient`
High-level client for the on-chain adapter registry. Supports propose → approve → revoke lifecycle and two-step governance transfer.

| Method | Description |
|--------|-------------|
| `ensureInitialized(authority)` | Idempotent registry initialization |
| `proposeAdapter(...)` | Propose a new adapter for approval |
| `approveAdapter(authority, adapterProgramId)` | Approve a proposed adapter |
| `proposeAndApprove(...)` | Convenience: propose + approve in one call |
| `revokeAdapter(authority, adapterProgramId)` | Revoke an approved adapter |
| `nominateGovernance(authority, newAuthority)` | Start two-step governance transfer |
| `acceptGovernance(signer)` | Complete governance transfer |

### `DispatcherClient`
High-level client for the yield-dispatcher router. Routes deposits/withdrawals/current-value queries through registered adapters via CPI.

| Method | Description |
|--------|-------------|
| `ensureInitialized(authority, registryProgramId)` | Idempotent dispatcher initialization |
| `deposit(user, amount, minSharesOut, ...)` | Deposit through dispatcher into an adapter |
| `withdraw(user, shares, minUnderlyingOut, ...)` | Withdraw from an adapter through dispatcher |
| `currentValue(user, adapterProgramId)` | Query position value through dispatcher |

### `AdapterClient`
Per-adapter client for vault initialization, PDA derivation, and token account setup.

| Method | Description |
|--------|-------------|
| `vaultStatePda()` / `vaultAuthorityPda()` | Derive vault PDAs for this adapter |
| `userPositionPda(user)` | Derive user position PDA |
| `initializeVault(authority, underlyingMint)` | Idempotent vault initialization |
| `createVaultTokenAccount(connection, payer, mint)` | Create vault's token account |
| `resolveUnderlyingMint(connection, payer)` | Get USDC (fork) or test mint (localnet) |

### `flow`
`runAdapterDepositWithdrawFlow()` — full deposit → current_value → withdraw lifecycle for integration testing.

### `fork`
Programmatic fork testing helpers: `startValidator()`, `deployPrograms()`, `runTests()`, `cleanupValidator()`, `prepareFixtures()`, `buildPrograms()`.

## Building

```bash
cd packages/sdk
npm run build    # compiles TypeScript → dist/
npm run clean    # removes dist/
```

## Publishing

```bash
npm publish      # rebuilds via prepublishOnly hook
```

## License

Apache-2.0
