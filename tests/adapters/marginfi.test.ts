import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Keypair } from "@solana/web3.js";

import {
  assertProtocolProgramLoaded,
  addSlippageTests,
  runAdapterDepositWithdrawFlow,
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
});
