import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Keypair } from "@solana/web3.js";
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
} from "../helpers/adapter";
import { isMainnetFork, JUPITER_PERPS_PROGRAM_ID } from "../helpers/constants";

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

    it("protocol CPI executed on deposit", async () => {
      await runAdapterProtocolCpiVerification(provider, authority, payer, {
        program,
        vaultStateSeed: "jupiter_vault_state",
        vaultAuthoritySeed: "jupiter_vault_authority",
        vaultStateAccountName: "jupiterVaultState",
      });
    });

    it("current_value matches deposit amount (protocol-exact share math)", async () => {
      await runAdapterCurrentValueAccuracy(provider, authority, payer, {
        program,
        vaultStateSeed: "jupiter_vault_state",
        vaultAuthoritySeed: "jupiter_vault_authority",
        vaultStateAccountName: "jupiterVaultState",
      });
    });

    it("multiple users maintain independent positions", async () => {
      await runAdapterMultipleUsers(provider, authority, payer, {
        program,
        vaultStateSeed: "jupiter_vault_state",
        vaultAuthoritySeed: "jupiter_vault_authority",
        vaultStateAccountName: "jupiterVaultState",
      });
    });

    it("empty state: current_value no-op, withdraw from empty rejected, reuse after full withdraw", async () => {
      await runAdapterEmptyStateTests(provider, authority, payer, {
        program,
        vaultStateSeed: "jupiter_vault_state",
        vaultAuthoritySeed: "jupiter_vault_authority",
        vaultStateAccountName: "jupiterVaultState",
      });
    });

    it("vault status lifecycle: toggle DepositsPaused → Paused → Active", async () => {
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
});
