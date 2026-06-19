# Drift Mainnet-Fork Test Issues

## Root Cause

On 2026-04-01, Drift Labs merged [protocol-v2 #2174](https://github.com/drift-labs/protocol-v2/pull/2174) ("comment out all ixs"), which commented out every instruction handler in their deployed program (`programs/drift/src/lib.rs` — ~245 `pub fn` handlers, leaving only a custom oracle entrypoint). The program remains deployed and executable at the same address, but all CPI calls into it return **AnchorError 101** (`InstructionFallbackNotFound`).

## Impact

Any adapter deposit, withdraw, settle, or oracle operation that CPI-calls the Drift v2 program will fail with:

```
Program log: Error: InstructionFallbackNotFound (0x65)
```

This is confirmed live via Helius `simulateTransaction` against the current on-chain program.

## Why This Is Not an Adapter Bug

- The adapter's CPI implementation (remaining accounts + protocol routing) is structurally identical to Kamino, Marginfi, and Jupiter adapters, all of which pass fork CPI verification.
- The sole difference is the target program: Drift's deployed binary rejects all instructions.
- When Drift re-enables its program handlers, the adapter code will work without changes.

## Test Strategy

All Drift CPI-dependent tests are **skipped on mainnet fork** rather than failing. They are replaced with a documented skip referencing this file. The non-CPI tests (e.g., zero-deposit rejection, `assertProtocolProgramLoaded`) continue to run.

## Verification

- `MAINNET_FORK=1 anchor test` — Drift CPI tests show as skipped (pending) rather than failed.
- `cargo test` / `anchor test` (localnet) — unchanged, all 28 unit + 26 localnet tests pass.
- The skip exists solely to prevent false negatives; revert when Drift re-enables its program.

## Resolution

Track https://github.com/drift-labs/protocol-v2. Once Drift uncomments its instruction handlers, revert the skip guards in `tests/adapters/drift.test.ts` and confirm `MAINNET_FORK=1 anchor test` passes all 12 Drift tests.
