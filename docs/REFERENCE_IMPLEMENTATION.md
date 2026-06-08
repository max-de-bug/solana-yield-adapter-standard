# Reference Implementation Scope

This repository is a **reference implementation** of the Solana Yield Adapter Standard that includes **real protocol CPI** for four of the five listed protocols (Kamino, MarginFi, Jupiter Perps, Drift), verified end-to-end against cloned mainnet programs.

## Test results

| Suite | Count | Status |
|-------|-------|--------|
| Unit tests (`cargo test`) | 27 | ✅ All pass |
| Localnet integration (`anchor test`) | 17 | ✅ All pass |
| Mainnet-fork integration (`MAINNET_FORK=1 anchor test`) | 21 | ✅ All pass |

## Conditional CPI pattern

All four CPI-capable adapters use a **conditional CPI** pattern so that the same compiled `.so` works on both localnet and mainnet fork without branching:

```rust
// In each protocol.rs — no-op when remaining accounts are empty (localnet),
// executes real invoke_signed when accounts are present (fork).
pub fn on_deposit(ctx: &Context<Deposit>, amount: u64) -> Result<()> {
    if ctx.remaining_accounts.len() >= REQUIRED_ACCOUNTS {
        let remaining = &ctx.remaining_accounts;
        // real CPI via invoke_signed with vault authority PDA seeds
    }
    // Always update protocol_routed_underlying bookkeeping
    Ok(())
}
```

This keeps handler code uniform — no `if mainnet` guards in Rust.

## Protocol CPI per adapter

| Adapter | CPI target | Discriminator(s) | Accounts | Status |
|---------|-----------|-------------------|----------|--------|
| **Kamino K-Lend** | `deposit_reserve_liquidity` / `withdraw_reserve_liquidity` | `a9c91e7e06cd6644` / `00174d97e0646770` | 9 | ✅ Fork-verified |
| **MarginFi v2** | `lending_account_deposit` / `lending_account_withdraw` | `ab5eeb675240d48c` / `24484a13d2d2c0c0` | 9 | ✅ Fork-verified |
| **Jupiter Perps JLP** | `add_liquidity` / `remove_liquidity` | `b59d59438fb63448` / `5055d14818ceb16c` | 8 | ✅ Fork-verified |
| **Drift IF v2** | `spot_deposit` / `spot_withdraw` | `99ffd56e5d773d16` / `9c0a7f2e396b1c8c` | 8 | ✅ Fork-verified (non-Anchor discriminators) |
| **Maple syrupUSDC** | No CPI needed | — | — | Holds yield-bearing SPL token; `on_withdraw` is no-op |

### Drift discriminator note

Drift does **not** use standard Anchor discriminators (`SHA256("global:<instruction_name>")[:8]`). The byte values above were empirically verified against the cloned on-chain program during fork tests.

## Dispatcher CPI fix

The `yield-dispatcher` program's `adapter_cpi.rs` had `vault_token_account` and `vault_authority` swapped at account indices 4 and 5 in `cpi_deposit`. Fixed to match the target adapter's `#[derive(Accounts)]` field order (Anchor matches accounts by position, not by name). This was the root cause of `AccountNotInitialized` errors on dispatcher deposit/withdraw tests.

## Fork test setup

```bash
# First-time setup: clone protocol programs and generate USDC fixture
./scripts/setup-fork-usdc-fixture.sh

# Run fork tests
MAINNET_FORK=1 anchor test --skip-build
# or: npm run test:fork

# Fork scripts clone from mainnet:
# - Kamino K-Lend: 6LNeTYZqt4TiCFx3dgfyELBKG8ZGPNwdkGrs1oxJQx8X
# - MarginFi v2: 2pv2VfTur3kCLEdYLzXT23E5Fha2EQNdKk5S2Yyda7uB
# - Jupiter Perps: PERPHjGBqRHArX4DySjwM1qd5E3LxN6dPnuPWePkYwR
# - Drift v2: dRiftyHA39MWEi3m9aunc5iHF6CqokD2a1W6KZzK7UQ
```

## Production adapters

Teams shipping production adapters should:

1. Use this reference implementation as a template for the standard interface.
2. Replace the local vault and conditional CPI with **unconditional real CPI** after audit.
3. Register via the on-chain registry.

See the [Build Your Own Adapter](./BUILD_YOUR_OWN_ADAPTER.md) guide for step-by-step instructions.
