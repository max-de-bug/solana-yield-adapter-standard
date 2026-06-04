import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Keypair } from "@solana/web3.js";

import { runAdapterDepositWithdrawFlow } from "../helpers/adapter";

describe("adapter-maple", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AdapterMaple as Program;
  const authority = provider.wallet as anchor.Wallet;
  const payer = (provider.wallet as anchor.Wallet).payer as Keypair;

  it("deposit → current_value → withdraw (syrupUSDC model)", async () => {
    await runAdapterDepositWithdrawFlow(provider, authority, payer, {
      program,
      vaultStateSeed: "maple_vault_state",
      vaultAuthoritySeed: "maple_vault_authority",
    });
  });
});
