import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Keypair, SystemProgram, PublicKey } from "@solana/web3.js";

import { assertProtocolProgramLoaded, initializeAdapterVault } from "../helpers/adapter";
import {
  adapterUserPositionPda,
  createTestMint,
  createTestTokenAccount,
  findPda,
  getTokenBalance,
  mintTestTokens,
} from "../helpers/index";
import {
  DRIFT_PROGRAM_ID,
  isMainnetFork,
  MAINNET_USDC_MINT,
  TOKEN_PROGRAM_ID as TOKEN_PROGRAM,
} from "../helpers/constants";
import { getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { expect } from "chai";

describe("adapter-drift", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AdapterDrift as Program;
  const authority = provider.wallet as anchor.Wallet;
  const payer = (provider.wallet as anchor.Wallet).payer as Keypair;

  // Shared test fixtures (initialized once)
  let vaultStatePda: PublicKey;
  let vaultAuthorityPda: PublicKey;
  let underlyingMint: PublicKey;
  let vaultTokenAccount: PublicKey;

  before(async () => {
    vaultStatePda = (await findPda([Buffer.from("drift_vault_state")], program.programId))[0];
    vaultAuthorityPda = (await findPda([Buffer.from("drift_vault_authority")], program.programId))[0];

    underlyingMint = isMainnetFork()
      ? MAINNET_USDC_MINT
      : await createTestMint(provider, payer, 6);

    await initializeAdapterVault(program, authority, vaultStatePda, underlyingMint);

    // Set cooldown to 0 so withdrawals can be settled instantly in tests
    await program.methods
      .setUnstakeCooldown(new anchor.BN(0))
      .accounts({ authority: authority.publicKey, vaultState: vaultStatePda })
      .rpc();

    vaultTokenAccount = await createVaultTokenAccount(
      provider, payer, underlyingMint, vaultAuthorityPda
    );
  });

  if (isMainnetFork()) {
    it("loads Drift v2 program from mainnet fork", async () => {
      await assertProtocolProgramLoaded(
        provider.connection,
        DRIFT_PROGRAM_ID,
        "Drift v2"
      );
    });
  }

  it("deposit → current_value → withdraw (request) → settle_withdrawal (two-phase cooldown)", async () => {
    const depositAmount = 1_000_000;
    const withdrawShares = 500_000;

    const userTokenAccount = await fundUserAta(depositAmount);

    const [userPositionPda] = await adapterUserPositionPda(
      program.programId,
      authority.publicKey
    );

    // Phase 0: Deposit
    const depositBuilder = program.methods
      .deposit(new anchor.BN(depositAmount), new anchor.BN(0))
      .accounts({
        user: authority.publicKey,
        vaultState: vaultStatePda,
        userPosition: userPositionPda,
        userTokenAccount,
        vaultAuthority: vaultAuthorityPda,
        vaultTokenAccount,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
      });

    if (isMainnetFork()) {
      depositBuilder.remainingAccounts([
        { pubkey: DRIFT_PROGRAM_ID, isSigner: false, isWritable: false },
      ]);
    }

    await depositBuilder.rpc();

    const vaultBalanceAfterDeposit = await getTokenBalance(provider, vaultTokenAccount);
    expect(vaultBalanceAfterDeposit).to.equal(depositAmount);

    // current_value
    const currentValueBuilder = program.methods.currentValue().accounts({
      user: authority.publicKey,
      vaultState: vaultStatePda,
      userPosition: userPositionPda,
    });

    if (isMainnetFork()) {
      currentValueBuilder.remainingAccounts([
        { pubkey: DRIFT_PROGRAM_ID, isSigner: false, isWritable: false },
      ]);
    }

    await currentValueBuilder.rpc();

    // Phase 1: Request withdrawal (creates ticket, locks shares)
    const [ticketPda] = await findPda(
      [Buffer.from("drift_ticket"), userPositionPda.toBuffer()],
      program.programId
    );

    await program.methods
      .withdraw(new anchor.BN(withdrawShares), new anchor.BN(0))
      .accounts({
        user: authority.publicKey,
        vaultState: vaultStatePda,
        userPosition: userPositionPda,
        ticket: ticketPda,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Verify ticket exists
    const ticketAccount = await program.account.driftWithdrawalTicket.fetch(ticketPda);
    expect(ticketAccount.shares.toNumber()).to.equal(withdrawShares);
    expect(ticketAccount.isSettled).to.be.false;

    // Phase 2: Settle withdrawal (cooldown is 0, so instant)
    const settleBuilder = program.methods
      .settleWithdrawal()
      .accounts({
        user: authority.publicKey,
        vaultState: vaultStatePda,
        userPosition: userPositionPda,
        ticket: ticketPda,
        userTokenAccount,
        vaultTokenAccount,
        vaultAuthority: vaultAuthorityPda,
        tokenProgram: TOKEN_PROGRAM,
      });

    if (isMainnetFork()) {
      settleBuilder.remainingAccounts([
        { pubkey: DRIFT_PROGRAM_ID, isSigner: false, isWritable: false },
      ]);
    }

    await settleBuilder.rpc();

    // Ticket should be closed (rent returned)
    const ticketInfo = await provider.connection.getAccountInfo(ticketPda);
    expect(ticketInfo).to.be.null;

    // Verify user received underlying
    const userBalance = await getTokenBalance(provider, userTokenAccount);
    expect(userBalance).to.be.greaterThan(0);

    const vaultBalanceAfterWithdraw = await getTokenBalance(provider, vaultTokenAccount);
    expect(vaultBalanceAfterWithdraw).to.be.lessThan(depositAmount);
  });

  it("rejects withdraw request with excessive min_underlying_out (slippage)", async () => {
    const userTokenAccount = await fundUserAta(1_000_000);
    const [userPositionPda] = await adapterUserPositionPda(
      program.programId, authority.publicKey
    );

    await program.methods
      .deposit(new anchor.BN(1_000_000), new anchor.BN(0))
      .accounts({
        user: authority.publicKey,
        vaultState: vaultStatePda,
        userPosition: userPositionPda,
        userTokenAccount,
        vaultAuthority: vaultAuthorityPda,
        vaultTokenAccount,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const [ticketPda] = await findPda(
      [Buffer.from("drift_ticket"), userPositionPda.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .withdraw(new anchor.BN(500_000), new anchor.BN(1_000_000))
        .accounts({
          user: authority.publicKey,
          vaultState: vaultStatePda,
          userPosition: userPositionPda,
          ticket: ticketPda,
          tokenProgram: TOKEN_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      expect.fail("Should have rejected withdraw with excessive min_underlying_out");
    } catch (err: unknown) {
      expect(String(err)).to.contain("SlippageExceeded");
    }
  });

  it("rejects settlement before cooldown elapses", async () => {
    // Set cooldown to large value
    await program.methods
      .setUnstakeCooldown(new anchor.BN(999_999_999))
      .accounts({ authority: authority.publicKey, vaultState: vaultStatePda })
      .rpc();

    const userTokenAccount = await fundUserAta(1_000_000);
    const [userPositionPda] = await adapterUserPositionPda(
      program.programId, authority.publicKey
    );

    await program.methods
      .deposit(new anchor.BN(1_000_000), new anchor.BN(0))
      .accounts({
        user: authority.publicKey,
        vaultState: vaultStatePda,
        userPosition: userPositionPda,
        userTokenAccount,
        vaultAuthority: vaultAuthorityPda,
        vaultTokenAccount,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const [ticketPda] = await findPda(
      [Buffer.from("drift_ticket"), userPositionPda.toBuffer()],
      program.programId
    );

    await program.methods
      .withdraw(new anchor.BN(500_000), new anchor.BN(0))
      .accounts({
        user: authority.publicKey,
        vaultState: vaultStatePda,
        userPosition: userPositionPda,
        ticket: ticketPda,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    try {
      await program.methods
        .settleWithdrawal()
        .accounts({
          user: authority.publicKey,
          vaultState: vaultStatePda,
          userPosition: userPositionPda,
          ticket: ticketPda,
          userTokenAccount,
          vaultTokenAccount,
          vaultAuthority: vaultAuthorityPda,
          tokenProgram: TOKEN_PROGRAM,
        })
        .rpc();
      expect.fail("Should have rejected settlement before cooldown elapses");
    } catch (err: unknown) {
      expect(String(err)).to.contain("CooldownNotElapsed");
    }
  });

  /** Fund a user USDC token account with the shared underlying mint. */
  async function fundUserAta(amount: number): Promise<PublicKey> {
    if (isMainnetFork()) {
      const ata = getAssociatedTokenAddressSync(underlyingMint, authority.publicKey);
      try {
        await mintTestTokens(provider, underlyingMint, ata, payer, amount);
      } catch {
        // Mainnet mint — may not have mint authority
      }
      return ata;
    }
    const ata = await createTestTokenAccount(provider, underlyingMint, authority.publicKey, payer);
    await mintTestTokens(provider, underlyingMint, ata, payer, amount);
    return ata;
  }
});

async function createVaultTokenAccount(
  provider: anchor.AnchorProvider,
  payer: Keypair,
  underlyingMint: PublicKey,
  vaultAuthorityPda: PublicKey
): Promise<PublicKey> {
  const account = await getOrCreateAssociatedTokenAccount(
    provider.connection, payer, underlyingMint, vaultAuthorityPda, true
  );
  return account.address;
}
