import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Keypair, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";

import {
  initializeAdapterVault,
  createVaultTokenAccount,
  runAdapterDepositWithdrawFlow,
} from "../helpers/adapter";
import { createTestMint, createTestTokenAccount, findPda, adapterUserPositionPda } from "../helpers";
import { isMainnetFork, MAINNET_USDC_MINT, SYRUP_USDC_MINT } from "../helpers/constants";
import { TOKEN_PROGRAM_ID } from "../helpers/constants";

describe("adapter-maple", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AdapterMaple as Program;
  const authority = provider.wallet as anchor.Wallet;
  const payer = (provider.wallet as anchor.Wallet).payer as Keypair;

  const vaultStateSeed = "maple_vault_state";
  const vaultAuthoritySeed = "maple_vault_authority";

  let vaultStatePda: anchor.web3.PublicKey;
  let vaultAuthorityPda: anchor.web3.PublicKey;
  let testedMint: anchor.web3.PublicKey | undefined;

  before(async () => {
    [vaultStatePda] = findPda(
      [Buffer.from(vaultStateSeed)],
      program.programId
    );
    [vaultAuthorityPda] = findPda(
      [Buffer.from(vaultAuthoritySeed)],
      program.programId
    );
  });

  it("deposit → current_value → withdraw (syrupUSDC model)", async () => {
    // On fork, flow determines the mint (test mint on Surfpool, SYRUP_USDC_MINT via fixture on legacy);
    // on localnet, pass the on-chain local USDC mint.
    const flowMint = isMainnetFork() ? undefined : await createTestMint(provider, payer, 6);
    await runAdapterDepositWithdrawFlow(provider, authority, payer, {
      program,
      vaultStateSeed,
      vaultAuthoritySeed,
      underlyingMint: flowMint,
    });
    // Save the mint used by the flow for subsequent tests
    testedMint = flowMint ?? MAINNET_USDC_MINT;
  });

  it("rejects zero amount deposit", async () => {
    const underlyingMint = testedMint!;
    const vaultTokenAccount = await createVaultTokenAccount(
      provider, payer, underlyingMint, vaultAuthorityPda
    );

    // No need to fund — zero-amount check fires before token transfer
    const userTokenAccount = await createTestTokenAccount(provider, underlyingMint, authority.publicKey, payer);

    const [userPositionPda] = adapterUserPositionPda(program.programId, authority.publicKey);

    try {
      await program.methods
        .deposit(new anchor.BN(0), new anchor.BN(0))
        .accounts({
          user: authority.publicKey,
          vaultState: vaultStatePda,
          userPosition: userPositionPda,
          userTokenAccount,
          vaultAuthority: vaultAuthorityPda,
          vaultTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      expect.fail("Should have rejected zero deposit");
    } catch (err: unknown) {
      expect(String(err)).to.contain("Deposit amount must be greater than zero");
    }
  });
});
