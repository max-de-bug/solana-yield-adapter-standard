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
import { isMainnetFork, KAMINO_PROGRAM_ID } from "../helpers/constants";

describe("adapter-kamino", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AdapterKamino as Program;
  const authority = provider.wallet as anchor.Wallet;
  const payer = (provider.wallet as anchor.Wallet).payer as Keypair;

  if (isMainnetFork()) {
    it("loads Kamino K-Lend program from mainnet fork", async () => {
      await assertProtocolProgramLoaded(
        provider.connection,
        KAMINO_PROGRAM_ID,
        "Kamino K-Lend"
      );
    });

    it("protocol CPI executed on deposit", async () => {
      await runAdapterProtocolCpiVerification(provider, authority, payer, {
        program,
        vaultStateSeed: "kamino_vault_state",
        vaultAuthoritySeed: "kamino_vault_authority",
        vaultStateAccountName: "kaminoVaultState",
      });
    });

    it("current_value matches deposit amount (protocol-exact share math)", async () => {
      await runAdapterCurrentValueAccuracy(provider, authority, payer, {
        program,
        vaultStateSeed: "kamino_vault_state",
        vaultAuthoritySeed: "kamino_vault_authority",
        vaultStateAccountName: "kaminoVaultState",
      });
    });

    it("multiple users maintain independent positions", async () => {
      await runAdapterMultipleUsers(provider, authority, payer, {
        program,
        vaultStateSeed: "kamino_vault_state",
        vaultAuthoritySeed: "kamino_vault_authority",
        vaultStateAccountName: "kaminoVaultState",
      });
    });

    it("empty state: current_value no-op, withdraw from empty rejected, reuse after full withdraw", async () => {
      await runAdapterEmptyStateTests(provider, authority, payer, {
        program,
        vaultStateSeed: "kamino_vault_state",
        vaultAuthoritySeed: "kamino_vault_authority",
        vaultStateAccountName: "kaminoVaultState",
      });
    });

    it("vault status lifecycle: toggle DepositsPaused → Paused → Active", async () => {
      await runAdapterVaultStatusLifecycle(provider, authority, payer, {
        program,
        vaultStateSeed: "kamino_vault_state",
        vaultAuthoritySeed: "kamino_vault_authority",
        vaultStateAccountName: "kaminoVaultState",
      });
    });
  }

  it("deposit → current_value → withdraw", async () => {
    await runAdapterDepositWithdrawFlow(provider, authority, payer, {
      program,
      vaultStateSeed: "kamino_vault_state",
      vaultAuthoritySeed: "kamino_vault_authority",
    });
  });

  addSlippageTests({
    program,
    vaultStateSeed: "kamino_vault_state",
    vaultAuthoritySeed: "kamino_vault_authority",
  });

  it("rejects zero amount deposit", async () => {
    await runAdapterZeroDepositRejection(provider, authority, payer, {
      program,
      vaultStateSeed: "kamino_vault_state",
      vaultAuthoritySeed: "kamino_vault_authority",
    });
  });

  it("rejects zero amount withdraw", async () => {
    await runAdapterZeroWithdrawRejection(provider, authority, payer, {
      program,
      vaultStateSeed: "kamino_vault_state",
      vaultAuthoritySeed: "kamino_vault_authority",
    });
  });

  it("deposits and fully withdraws all shares", async () => {
    await runAdapterFullWithdrawFlow(provider, authority, payer, {
      program,
      vaultStateSeed: "kamino_vault_state",
      vaultAuthoritySeed: "kamino_vault_authority",
    });
  });
});
