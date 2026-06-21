import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { expect } from "chai";

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
import { isMainnetFork, JUPITER_PERPS_PROGRAM_ID, MAINNET_USDC_MINT, ADAPTER_VAULT_SEEDS, ADAPTER_VAULT_AUTHORITY_SEEDS } from "../helpers/constants";
import { findPda, createTestMint } from "../helpers";
import { runConformance } from "../helpers/conformance";

describe("adapter-jupiter", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AdapterJupiter as Program;
  const authority = provider.wallet as anchor.Wallet;
  const payer = (provider.wallet as anchor.Wallet).payer as Keypair;

  if (isMainnetFork()) {
    it("loads Jupiter Perpetuals program from mainnet fork", async () => {
      await assertProtocolProgramLoaded(
        provider.connection,
        JUPITER_PERPS_PROGRAM_ID,
        "Jupiter Perpetuals"
      );
    });

    it("protocol CPI executed on deposit", async function () {
      await skipIfNoUsdcOnFork(provider, this);
      await runAdapterProtocolCpiVerification(provider, authority, payer, {
        program,
        vaultStateSeed: "jupiter_vault_state",
        vaultAuthoritySeed: "jupiter_vault_authority",
        vaultStateAccountName: "jupiterVaultState",
      });
    });

    it("current_value matches deposit amount (internal share math)", async function () {
      await skipIfNoUsdcOnFork(provider, this);
      await runAdapterCurrentValueAccuracy(provider, authority, payer, {
        program,
        vaultStateSeed: "jupiter_vault_state",
        vaultAuthoritySeed: "jupiter_vault_authority",
        vaultStateAccountName: "jupiterVaultState",
      });
    });

    it("multiple users maintain independent positions", async function () {
      await skipIfNoUsdcOnFork(provider, this);
      await runAdapterMultipleUsers(provider, authority, payer, {
        program,
        vaultStateSeed: "jupiter_vault_state",
        vaultAuthoritySeed: "jupiter_vault_authority",
        vaultStateAccountName: "jupiterVaultState",
      });
    });

    it("empty state: current_value no-op, withdraw from empty rejected, reuse after full withdraw", async function () {
      await skipIfNoUsdcOnFork(provider, this);
      await runAdapterEmptyStateTests(provider, authority, payer, {
        program,
        vaultStateSeed: "jupiter_vault_state",
        vaultAuthoritySeed: "jupiter_vault_authority",
        vaultStateAccountName: "jupiterVaultState",
      });
    });

    it("vault status lifecycle: toggle DepositsPaused → Paused → Active", async function () {
      await skipIfNoUsdcOnFork(provider, this);
      await runAdapterVaultStatusLifecycle(provider, authority, payer, {
        program,
        vaultStateSeed: "jupiter_vault_state",
        vaultAuthoritySeed: "jupiter_vault_authority",
        vaultStateAccountName: "jupiterVaultState",
      });
    });
  }

  it("deposit → current_value → withdraw", async () => {
    await runAdapterDepositWithdrawFlow(provider, authority, payer, {
      program,
      vaultStateSeed: "jupiter_vault_state",
      vaultAuthoritySeed: "jupiter_vault_authority",
    });
  });

  addSlippageTests({
    program,
    vaultStateSeed: "jupiter_vault_state",
    vaultAuthoritySeed: "jupiter_vault_authority",
  });

  it("rejects zero amount deposit", async () => {
    await runAdapterZeroDepositRejection(provider, authority, payer, {
      program,
      vaultStateSeed: "jupiter_vault_state",
      vaultAuthoritySeed: "jupiter_vault_authority",
    });
  });

  it("rejects zero amount withdraw", async () => {
    await runAdapterZeroWithdrawRejection(provider, authority, payer, {
      program,
      vaultStateSeed: "jupiter_vault_state",
      vaultAuthoritySeed: "jupiter_vault_authority",
    });
  });

  it("deposits and fully withdraws all shares", async () => {
    await runAdapterFullWithdrawFlow(provider, authority, payer, {
      program,
      vaultStateSeed: "jupiter_vault_state",
      vaultAuthoritySeed: "jupiter_vault_authority",
    });
  });

  describe("conformance", () => {
    let vaultStatePda: PublicKey;
    let vaultAuthorityPda: PublicKey;
    let vaultTokenAccount: PublicKey;
    let underlyingMint: PublicKey;

    before(async function () {
      this.timeout(120000);
      vaultStatePda = findPda([ADAPTER_VAULT_SEEDS.jupiter], program.programId)[0];
      vaultAuthorityPda = findPda([ADAPTER_VAULT_AUTHORITY_SEEDS.jupiter], program.programId)[0];
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
      label: "jupiter",
      program,
      provider,
      authority,
      payer,
      vaultStatePda,
      vaultAuthorityPda,
      vaultTokenAccount,
      underlyingMint,
      vaultStateAccountName: "jupiterVaultState",
      vaultStateSeed: "jupiter_vault_state",
      vaultAuthoritySeed: "jupiter_vault_authority",
      isInstant: true,
      depositRemainingAccounts: isMainnetFork()
        ? [{ pubkey: JUPITER_PERPS_PROGRAM_ID, isSigner: false, isWritable: false }]
        : undefined,
      valueRemainingAccounts: isMainnetFork()
        ? [{ pubkey: JUPITER_PERPS_PROGRAM_ID, isSigner: false, isWritable: false }]
        : undefined,
    }));
  });
});
