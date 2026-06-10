import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Keypair } from "@solana/web3.js";

import {
  assertProtocolProgramLoaded,
  addSlippageTests,
  runAdapterDepositWithdrawFlow,
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
});
