import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Keypair } from "@solana/web3.js";

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
import { isMainnetFork, MARGINFI_PROGRAM_ID } from "../helpers/constants";

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

    it("protocol CPI executed on deposit", async () => {
      await runAdapterProtocolCpiVerification(provider, authority, payer, {
        program,
        vaultStateSeed: "marginfi_vault_state",
        vaultAuthoritySeed: "marginfi_vault_authority",
        vaultStateAccountName: "marginfiVaultState",
      });
    });

    it("current_value matches deposit amount (protocol-exact share math)", async () => {
      await runAdapterCurrentValueAccuracy(provider, authority, payer, {
        program,
        vaultStateSeed: "marginfi_vault_state",
        vaultAuthoritySeed: "marginfi_vault_authority",
        vaultStateAccountName: "marginfiVaultState",
      });
    });

    it("multiple users maintain independent positions", async () => {
      await runAdapterMultipleUsers(provider, authority, payer, {
        program,
        vaultStateSeed: "marginfi_vault_state",
        vaultAuthoritySeed: "marginfi_vault_authority",
        vaultStateAccountName: "marginfiVaultState",
      });
    });

    it("empty state: current_value no-op, withdraw from empty rejected, reuse after full withdraw", async () => {
      await runAdapterEmptyStateTests(provider, authority, payer, {
        program,
        vaultStateSeed: "marginfi_vault_state",
        vaultAuthoritySeed: "marginfi_vault_authority",
        vaultStateAccountName: "marginfiVaultState",
      });
    });

    it("vault status lifecycle: toggle DepositsPaused → Paused → Active", async () => {
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
});
