# Reference Implementation Scope

This repository is a **reference implementation** of the Solana Yield Adapter Standard that includes **real protocol CPI** for four of the five listed protocols (Kamino, MarginFi, Jupiter Perps, Drift), verified end-to-end against cloned mainnet programs.

## Test results

| Suite | Count | Status |
|-------|-------|--------|
| Unit tests (`cargo test`) | 28 | ✅ All pass |
| Localnet integration (`anchor test`) | 17 | ✅ All pass |
| Mainnet-fork integration (`MAINNET_FORK=1 anchor test`) | 31 | ✅ All pass |

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

## Dispatcher CPI fixes

### Account ordering

The `yield-dispatcher` program's `adapter_cpi.rs` had `vault_token_account` and `vault_authority` swapped at account indices 4 and 5 in `cpi_deposit`. Fixed to match the target adapter's `#[derive(Accounts)]` field order (Anchor matches accounts by position, not by name). This was the root cause of `AccountNotInitialized` errors on dispatcher deposit/withdraw tests.

### Vault authority seed validation

Each adapter uses a custom `VAULT_AUTHORITY_SEED` (e.g., `b"kamino_vault_authority"`). The dispatcher's `adapter_validation.rs` originally used the hardcoded trait seed `b"vault_authority"`, causing `AdapterCpiError` on dispatcher CPI. Fixed by adding `vault_authority_seed` to `AdapterEntry` state and `propose_adapter` instruction, and updating dispatcher validation to read it from the registry entry at runtime.

## Fork test setup

Tests require cloned mainnet protocol programs and pre-funded fixture ATAs:

```bash
# 1. Start local validator with cloned mainnet accounts
solana-test-validator \
  --reset --ledger test-ledger --url mainnet-beta --quiet \
  --clone KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD \
  --clone MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA \
  --clone PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu \
  --clone dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH \
  --clone EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
  --clone AvZZF1YaZDziPY2RCK4oJrRVrbN3mTD9NL24hPeaZeUj \
  --clone ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL \
  --account 7pyXgHEbAxkPNTZaaAEc21UGyoLKME5a3mMvxpseHeHz tests/fixtures/fork-usdc-ata.json \
  --account GLnPMjfFemGFhhMnKwpDEt9F56pvBgmTqyug3xQPQTHE tests/fixtures/fork-syrup-usdc-ata.json

# 2. Deploy all programs
for kp in target/deploy/*-keypair.json; do
  solana -u http://127.0.0.1:8899 program deploy \
    --program-id $kp \
    --upgrade-authority ~/.config/solana/id.json \
    target/deploy/$(basename $kp -keypair.json).so
done

# 3. Run fork tests
MAINNET_FORK=1 ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=~/.config/solana/id.json \
  npx ts-mocha -p ./tsconfig.json -t 1000000 'tests/**/*.test.ts'
```

## Production adapters

Teams shipping production adapters should:

1. Use this reference implementation as a template for the standard interface.
2. Replace the local vault and conditional CPI with **unconditional real CPI** after audit.
3. Register via the on-chain registry.

See the [Build Your Own Adapter](./BUILD_YOUR_OWN_ADAPTER.md) guide for step-by-step instructions.
