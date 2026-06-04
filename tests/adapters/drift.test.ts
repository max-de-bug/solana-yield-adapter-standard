import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Keypair } from "@solana/web3.js";

import {
  assertProtocolProgramLoaded,
  runAdapterDepositWithdrawFlow,
} from "../helpers/adapter";
import { DRIFT_PROGRAM_ID, isMainnetFork } from "../helpers/constants";

describe("adapter-drift", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AdapterDrift as Program;
  const authority = provider.wallet as anchor.Wallet;
  const payer = (provider.wallet as anchor.Wallet).payer as Keypair;

  if (isMainnetFork()) {
    it("loads Drift v2 program from mainnet fork", async () => {
      await assertProtocolProgramLoaded(
        provider.connection,
        DRIFT_PROGRAM_ID,
        "Drift v2"
      );
    });
  }

  it("deposit → current_value → withdraw (insurance fund model)", async () => {
    await runAdapterDepositWithdrawFlow(provider, authority, payer, {
      program,
      vaultStateSeed: "drift_vault_state",
      vaultAuthoritySeed: "drift_vault_authority",
      withdrawShares: 500_000,
    });
  });
});
