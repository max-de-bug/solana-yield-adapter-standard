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
import { isMainnetFork, SYRUP_USDC_MINT } from "../helpers/constants";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
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
  let underlyingMint: anchor.web3.PublicKey;
  let vaultTokenAccount: anchor.web3.PublicKey;

  before(async () => {
    [vaultStatePda] = findPda(
      [Buffer.from(vaultStateSeed)],
      program.programId
    );
    [vaultAuthorityPda] = findPda(
      [Buffer.from(vaultAuthoritySeed)],
      program.programId
    );

    underlyingMint = isMainnetFork()
      ? SYRUP_USDC_MINT
      : await createTestMint(provider, payer, 6);

    await initializeAdapterVault(program, authority, vaultStatePda, underlyingMint);
    vaultTokenAccount = await createVaultTokenAccount(
      provider, payer, underlyingMint, vaultAuthorityPda
    );
  });

  it("deposit → current_value → withdraw (syrupUSDC model)", async () => {
    await runAdapterDepositWithdrawFlow(provider, authority, payer, {
      program,
      vaultStateSeed,
      vaultAuthoritySeed,
      underlyingMint,
    });
  });

  it("rejects zero amount deposit", async () => {
    const userTokenAccount = isMainnetFork()
      ? await getOrCreateAssociatedTokenAccount(
          provider.connection, payer, underlyingMint, authority.publicKey
        ).then(a => a.address)
      : await createTestTokenAccount(provider, underlyingMint, authority.publicKey, payer);

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
