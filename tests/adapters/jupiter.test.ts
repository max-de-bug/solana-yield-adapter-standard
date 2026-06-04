import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Keypair } from "@solana/web3.js";
import { expect } from "chai";

import {
  assertProtocolProgramLoaded,
  runAdapterDepositWithdrawFlow,
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
  }

  it("deposit → current_value → withdraw", async () => {
    await runAdapterDepositWithdrawFlow(provider, authority, payer, {
      program,
      vaultStateSeed: "jupiter_vault_state",
      vaultAuthoritySeed: "jupiter_vault_authority",
    });
  });
});
