import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

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
  skipIfNoUsdcOnFork,
} from "../helpers/adapter";
import { isMainnetFork, MARGINFI_PROGRAM_ID, MAINNET_USDC_MINT, ADAPTER_VAULT_SEEDS, ADAPTER_VAULT_AUTHORITY_SEEDS } from "../helpers/constants";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { findPda, createTestMint } from "../helpers";
import { runConformance } from "../helpers/conformance";

describe("adapter-marginfi", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AdapterMarginfi as Program;
  const authority = provider.wallet as anchor.Wallet;
  const payer = (provider.wallet as anchor.Wallet).payer as Keypair;

  if (isMainnetFork()) {
    it("loads MarginFi v2 program from mainnet fork", async () => {
      await assertProtocolProgramLoaded(
        provider.connection,
        MARGINFI_PROGRAM_ID,
        "MarginFi v2"
      );
    });

    it("protocol CPI executed on deposit", async function () {
      await skipIfNoUsdcOnFork(provider, this);
      await runAdapterProtocolCpiVerification(provider, authority, payer, {
        program,
        vaultStateSeed: "marginfi_vault_state",
        vaultAuthoritySeed: "marginfi_vault_authority",
        vaultStateAccountName: "marginfiVaultState",
      });
    });

    it("current_value matches deposit amount (internal share math)", async function () {
      await skipIfNoUsdcOnFork(provider, this);
      await runAdapterCurrentValueAccuracy(provider, authority, payer, {
        program,
        vaultStateSeed: "marginfi_vault_state",
        vaultAuthoritySeed: "marginfi_vault_authority",
        vaultStateAccountName: "marginfiVaultState",
      });
    });

    it("multiple users maintain independent positions", async function () {
      await skipIfNoUsdcOnFork(provider, this);
      await runAdapterMultipleUsers(provider, authority, payer, {
        program,
        vaultStateSeed: "marginfi_vault_state",
        vaultAuthoritySeed: "marginfi_vault_authority",
        vaultStateAccountName: "marginfiVaultState",
      });
    });

    it("empty state: current_value no-op, withdraw from empty rejected, reuse after full withdraw", async function () {
      await skipIfNoUsdcOnFork(provider, this);
      await runAdapterEmptyStateTests(provider, authority, payer, {
        program,
        vaultStateSeed: "marginfi_vault_state",
        vaultAuthoritySeed: "marginfi_vault_authority",
        vaultStateAccountName: "marginfiVaultState",
      });
    });

    it("vault status lifecycle: toggle DepositsPaused → Paused → Active", async function () {
      await skipIfNoUsdcOnFork(provider, this);
      await runAdapterVaultStatusLifecycle(provider, authority, payer, {
        program,
        vaultStateSeed: "marginfi_vault_state",
        vaultAuthoritySeed: "marginfi_vault_authority",
        vaultStateAccountName: "marginfiVaultState",
      });
    });
  }

  it("deposit → current_value → withdraw", async () => {
    await runAdapterDepositWithdrawFlow(provider, authority, payer, {
      program,
      vaultStateSeed: "marginfi_vault_state",
      vaultAuthoritySeed: "marginfi_vault_authority",
    });
  });

  addSlippageTests({
    program,
    vaultStateSeed: "marginfi_vault_state",
    vaultAuthoritySeed: "marginfi_vault_authority",
  });

  it("rejects zero amount deposit", async () => {
    await runAdapterZeroDepositRejection(provider, authority, payer, {
      program,
      vaultStateSeed: "marginfi_vault_state",
      vaultAuthoritySeed: "marginfi_vault_authority",
    });
  });

  it("rejects zero amount withdraw", async () => {
    await runAdapterZeroWithdrawRejection(provider, authority, payer, {
      program,
      vaultStateSeed: "marginfi_vault_state",
      vaultAuthoritySeed: "marginfi_vault_authority",
    });
  });

  it("deposits and fully withdraws all shares", async () => {
    await runAdapterFullWithdrawFlow(provider, authority, payer, {
      program,
      vaultStateSeed: "marginfi_vault_state",
      vaultAuthoritySeed: "marginfi_vault_authority",
    });
  });

  describe("conformance", () => {
    let vaultStatePda: PublicKey;
    let vaultAuthorityPda: PublicKey;
    let vaultTokenAccount: PublicKey;
    let underlyingMint: PublicKey;

    before(async function () {
      this.timeout(120000);
      vaultStatePda = findPda([ADAPTER_VAULT_SEEDS.marginfi], program.programId)[0];
      vaultAuthorityPda = findPda([ADAPTER_VAULT_AUTHORITY_SEEDS.marginfi], program.programId)[0];
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
      label: "marginfi",
      program,
      provider,
      authority,
      payer,
      vaultStatePda,
      vaultAuthorityPda,
      vaultTokenAccount,
      underlyingMint,
      vaultStateAccountName: "marginfiVaultState",
      vaultStateSeed: "marginfi_vault_state",
      vaultAuthoritySeed: "marginfi_vault_authority",
      isInstant: true,
      depositRemainingAccounts: isMainnetFork()
        ? [{ pubkey: MARGINFI_PROGRAM_ID, isSigner: false, isWritable: false }]
        : undefined,
      valueRemainingAccounts: isMainnetFork()
        ? [{ pubkey: MARGINFI_PROGRAM_ID, isSigner: false, isWritable: false }]
        : undefined,
    }));
  });
});
