import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";

import {
  assertProtocolProgramLoaded,
  addSlippageTests,
  runAdapterDepositWithdrawFlow,
  runAdapterZeroDepositRejection,
  runAdapterZeroWithdrawRejection,
  runAdapterFullWithdrawFlow,
  runAdapterProtocolCpiVerification,
  runAdapterCurrentValueAccuracy,
  runAdapterMultipleUsers,
  runAdapterEmptyStateTests,
  runAdapterVaultStatusLifecycle,
} from "../helpers/adapter";
import { isMainnetFork, MAINNET_USDC_MINT, ADAPTER_VAULT_SEEDS, ADAPTER_VAULT_AUTHORITY_SEEDS } from "../helpers/constants";
import { findPda, createTestMint } from "../helpers";
import { runConformance } from "../helpers/conformance";

/*
 * ─── TEMPLATE ADAPTER TEST ─────────────────────────────────────────────────────
 *
 * This test follows the same pattern as all other adapter tests (kamino, marginfi,
 * jupiter). It verifies the full deposit → current_value → withdraw lifecycle on
 * both localnet and mainnet fork, plus fork-only protocol CPI verification.
 *
 * When copying this adapter to create a real adapter:
 *   1. Rename this file to match your program name (e.g., adapter-mysolana.test.ts)
 *   2. Change `workspace.AdapterTemplate` to your program's workspace name
 *   3. Update vaultStateSeed and vaultAuthoritySeed to match your protocol
 *   4. Set MY_PROTOCOL_ID to your mainnet protocol program ID
 *   5. Update protocolProgramForAdapter in helpers/adapter.ts
 *   6. For adapters with a non-standard initialize() (like Maple's extra accounts),
 *      write custom versions of the fork-only shared tests instead.
 */

const MY_PROTOCOL_ID = anchor.web3.PublicKey.default; // TODO: replace with real mainnet ID

describe("adapter-template", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AdapterTemplate as Program;
  const authority = provider.wallet as anchor.Wallet;
  const payer = (provider.wallet as anchor.Wallet).payer as Keypair;

  const vaultStateSeed = "template_vault_state";
  const vaultAuthoritySeed = "template_vault_authority";
  const vaultStateAccountName = "templateVaultState";

  if (isMainnetFork()) {
    it("loads protocol program from mainnet fork", async () => {
      await assertProtocolProgramLoaded(
        provider.connection,
        MY_PROTOCOL_ID,
        "My Protocol"
      );
    });

    it("protocol CPI executed on deposit", async () => {
      await runAdapterProtocolCpiVerification(provider, authority, payer, {
        program,
        vaultStateSeed,
        vaultAuthoritySeed,
        vaultStateAccountName,
      });
    });

    it("current_value matches deposit amount (protocol-exact share math)", async () => {
      await runAdapterCurrentValueAccuracy(provider, authority, payer, {
        program,
        vaultStateSeed,
        vaultAuthoritySeed,
        vaultStateAccountName,
      });
    });

    it("multiple users maintain independent positions", async () => {
      await runAdapterMultipleUsers(provider, authority, payer, {
        program,
        vaultStateSeed,
        vaultAuthoritySeed,
        vaultStateAccountName,
      });
    });

    it("empty state: current_value no-op, withdraw from empty rejected, reuse after full withdraw", async () => {
      await runAdapterEmptyStateTests(provider, authority, payer, {
        program,
        vaultStateSeed,
        vaultAuthoritySeed,
        vaultStateAccountName,
      });
    });

    it("vault status lifecycle: toggle DepositsPaused → Paused → Active", async () => {
      await runAdapterVaultStatusLifecycle(provider, authority, payer, {
        program,
        vaultStateSeed,
        vaultAuthoritySeed,
        vaultStateAccountName,
      });
    });
  }

  it("deposit → current_value → withdraw", async () => {
    await runAdapterDepositWithdrawFlow(provider, authority, payer, {
      program,
      vaultStateSeed,
      vaultAuthoritySeed,
    });
  });

  addSlippageTests({
    program,
    vaultStateSeed,
    vaultAuthoritySeed,
  });

  it("rejects zero amount deposit", async () => {
    await runAdapterZeroDepositRejection(provider, authority, payer, {
      program,
      vaultStateSeed,
      vaultAuthoritySeed,
    });
  });

  it("rejects zero amount withdraw", async () => {
    await runAdapterZeroWithdrawRejection(provider, authority, payer, {
      program,
      vaultStateSeed,
      vaultAuthoritySeed,
    });
  });

  it("deposits and fully withdraws all shares", async () => {
    await runAdapterFullWithdrawFlow(provider, authority, payer, {
      program,
      vaultStateSeed,
      vaultAuthoritySeed,
    });
  });

  describe("conformance", () => {
    let vaultStatePda: PublicKey;
    let vaultAuthorityPda: PublicKey;
    let vaultTokenAccount: PublicKey;
    let underlyingMint: PublicKey;

    before(async function () {
      this.timeout(120000);
      vaultStatePda = findPda([ADAPTER_VAULT_SEEDS.template], program.programId)[0];
      vaultAuthorityPda = findPda([ADAPTER_VAULT_AUTHORITY_SEEDS.template], program.programId)[0];
      underlyingMint = isMainnetFork() ? MAINNET_USDC_MINT : await createTestMint(provider, payer, 6);
      try {
        await program.methods.initialize(underlyingMint)
          .accounts({ authority: authority.publicKey, vaultState: vaultStatePda, systemProgram: SystemProgram.programId })
          .rpc();
      } catch { /* already initialized */ }
      vaultTokenAccount = (await getOrCreateAssociatedTokenAccount(
        provider.connection, payer, underlyingMint, vaultAuthorityPda, true
      )).address;
    });

    runConformance(() => ({
      label: "template",
      program,
      provider,
      authority,
      payer,
      vaultStatePda,
      vaultAuthorityPda,
      vaultTokenAccount,
      underlyingMint,
      vaultStateAccountName: "templateVaultState",
      vaultStateSeed: "template_vault_state",
      vaultAuthoritySeed: "template_vault_authority",
      isInstant: true,
    }));
  });
});
