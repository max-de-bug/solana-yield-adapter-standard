import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Keypair } from "@solana/web3.js";

import {
  assertProtocolProgramLoaded,
  runAdapterDepositWithdrawFlow,
} from "../helpers/adapter";
import { isMainnetFork } from "../helpers/constants";

/*
 * ─── TEMPLATE ADAPTER TEST ─────────────────────────────────────────────────────
 *
 * This test follows the same pattern as all other adapter tests (kamino, marginfi,
 * jupiter, maple, drift). It verifies the full deposit → current_value → withdraw
 * lifecycle on both localnet and mainnet fork.
 *
 * When copying this adapter to create a real adapter:
 *   1. Rename this file to match your program name (e.g., adapter-mysolana.test.ts)
 *   2. Change `workspace.AdapterTemplate` to your program's workspace name
 *   3. Update vaultStateSeed and vaultAuthoritySeed to match your protocol
 *   4. Add a mainnet program ID assertion in the `if (isMainnetFork())` block
 */

describe("adapter-template", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AdapterTemplate as Program;
  const authority = provider.wallet as anchor.Wallet;
  const payer = (provider.wallet as anchor.Wallet).payer as Keypair;

  // In a real adapter, add a fork-verification test like:
  // if (isMainnetFork()) {
  //   it("loads MyProtocol program from mainnet fork", async () => {
  //     await assertProtocolProgramLoaded(
  //       provider.connection,
  //       MY_PROTOCOL_ID,
  //       "My Protocol"
  //     );
  //   });
  // }

  it("deposit → current_value → withdraw", async () => {
    await runAdapterDepositWithdrawFlow(provider, authority, payer, {
      program,
      vaultStateSeed: "template_vault_state",
      vaultAuthoritySeed: "template_vault_authority",
    });
  });
});
