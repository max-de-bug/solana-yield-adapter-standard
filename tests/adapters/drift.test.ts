import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Keypair, SystemProgram, PublicKey } from "@solana/web3.js";

import {
  assertProtocolProgramLoaded,
  initializeAdapterVault,
  runAdapterZeroDepositRejection,
  runAdapterProtocolCpiVerification,
  runAdapterCurrentValueAccuracy,
  runAdapterMultipleUsers,
  runAdapterEmptyStateTests,
  runAdapterVaultStatusLifecycle,
} from "../helpers/adapter";
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

    // Clear any stale withdrawal ticket from a previous Surfpool run
    await clearPendingTicket(authority.publicKey);

    underlyingMint = await createTestMint(provider, payer, 6);

    underlyingMint = await initializeAdapterVault(program, authority, vaultStatePda, underlyingMint);

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

    it("protocol CPI executed on deposit", async () => {
      await runAdapterProtocolCpiVerification(provider, authority, payer, {
        program,
        vaultStateSeed: "drift_vault_state",
        vaultAuthoritySeed: "drift_vault_authority",
        vaultStateAccountName: "driftVaultState",
      });
    });

    it("current_value matches deposit amount (protocol-exact share math)", async () => {
      await runAdapterCurrentValueAccuracy(provider, authority, payer, {
        program,
        vaultStateSeed: "drift_vault_state",
        vaultAuthoritySeed: "drift_vault_authority",
        vaultStateAccountName: "driftVaultState",
      });
    });

    it("multiple users maintain independent positions", async () => {
      await runAdapterMultipleUsers(provider, authority, payer, {
        program,
        vaultStateSeed: "drift_vault_state",
        vaultAuthoritySeed: "drift_vault_authority",
        vaultStateAccountName: "driftVaultState",
      });
    });

    it("empty state: current_value no-op, withdraw from empty rejected, reuse after full withdraw", async () => {
      await runAdapterEmptyStateTests(provider, authority, payer, {
        program,
        vaultStateSeed: "drift_vault_state",
        vaultAuthoritySeed: "drift_vault_authority",
        vaultStateAccountName: "driftVaultState",
      });
    });

    it("vault status lifecycle: toggle DepositsPaused → Paused → Active", async () => {
      await runAdapterVaultStatusLifecycle(provider, authority, payer, {
        program,
        vaultStateSeed: "drift_vault_state",
        vaultAuthoritySeed: "drift_vault_authority",
        vaultStateAccountName: "driftVaultState",
      });
    });
  }

  it("rejects zero amount deposit", async () => {
    await runAdapterZeroDepositRejection(provider, authority, payer, {
      program,
      vaultStateSeed: "drift_vault_state",
      vaultAuthoritySeed: "drift_vault_authority",
    });
  });

  it("deposit → current_value → withdraw (request) → settle_withdrawal (two-phase cooldown)", async () => {
    // Clear any stale ticket from previous Surfpool runs
    await clearPendingTicket(authority.publicKey);

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
    expect(vaultBalanceAfterDeposit).to.be.at.least(depositAmount);

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
    expect(vaultBalanceAfterWithdraw).to.be.lessThan(vaultBalanceAfterDeposit);
  });

  it("rejects withdraw request with excessive min_underlying_out (slippage)", async () => {
    // Clear any stale ticket from previous tests/Surfpool runs
    await clearPendingTicket(authority.publicKey);
    await program.methods
      .setUnstakeCooldown(new anchor.BN(0))
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
    // Clear any stale ticket from previous tests/Surfpool runs
    await clearPendingTicket(authority.publicKey);

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

  it("rejects zero amount withdraw request", async () => {
    const depositAmount = 1_000_000;

    // Clear any stale ticket and reset cooldown from previous tests
    await clearPendingTicket(authority.publicKey);
    await program.methods
      .setUnstakeCooldown(new anchor.BN(0))
      .accounts({ authority: authority.publicKey, vaultState: vaultStatePda })
      .rpc();

    const userTokenAccount = await fundUserAta(depositAmount);
    const [userPositionPda] = await adapterUserPositionPda(
      program.programId, authority.publicKey
    );

    await program.methods
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
      })
      .rpc();

    const [ticketPda] = await findPda(
      [Buffer.from("drift_ticket"), userPositionPda.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .withdraw(new anchor.BN(0), new anchor.BN(0))
        .accounts({
          user: authority.publicKey,
          vaultState: vaultStatePda,
          userPosition: userPositionPda,
          ticket: ticketPda,
          tokenProgram: TOKEN_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      expect.fail("Should have rejected zero withdraw");
    } catch (err: unknown) {
      expect(String(err)).to.contain("Withdrawal amount must be greater than zero");
    }
  });

  it("cancel unstake returns shares to position", async () => {
    // Clear stale ticket from previous tests and reset cooldown
    await clearPendingTicket(authority.publicKey);
    await program.methods
      .setUnstakeCooldown(new anchor.BN(0))
      .accounts({ authority: authority.publicKey, vaultState: vaultStatePda })
      .rpc();
    // Wait for new slot to avoid blockhash reuse
    await new Promise(r => setTimeout(r, 500));
    const depositAmount = 1_000_000;
    const withdrawShares = 500_000;

    const userTokenAccount = await fundUserAta(depositAmount);
    await new Promise(r => setTimeout(r, 500));
    const [userPositionPda] = await adapterUserPositionPda(
      program.programId, authority.publicKey
    );

    // Deposit
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

    // Request withdrawal (creates ticket)
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

    // Verify ticket exists and shares are locked
    let ticketAccount = await program.account.driftWithdrawalTicket.fetch(ticketPda);
    expect(ticketAccount.shares.toNumber()).to.equal(withdrawShares);
    expect(ticketAccount.isSettled).to.be.false;

    // Cancel the unstake
    await program.methods
      .cancelUnstake()
      .accounts({
        user: authority.publicKey,
        userPosition: userPositionPda,
        ticket: ticketPda,
      })
      .rpc();

    // Ticket should be closed
    const ticketInfo = await provider.connection.getAccountInfo(ticketPda);
    expect(ticketInfo).to.be.null;

    // Shares should be returned to position (at minimum the deposit amount,
    // may be more due to leftover shares from previous tests)
    const position = await program.account.adapterPosition.fetch(userPositionPda);
    expect(position.receiptTokenBalance.toNumber()).to.be.at.least(depositAmount);

    // Should be able to withdraw normally now
    await program.methods
      .withdraw(new anchor.BN(depositAmount), new anchor.BN(0))
      .accounts({
        user: authority.publicKey,
        vaultState: vaultStatePda,
        userPosition: userPositionPda,
        ticket: ticketPda,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  });

  /** Fund a user token account with the shared underlying mint. */
  async function fundUserAta(amount: number): Promise<PublicKey> {
    const ata = await getOrCreateAssociatedTokenAccount(
      provider.connection, payer, underlyingMint, authority.publicKey, false, undefined, undefined, TOKEN_PROGRAM
    );
    await mintTestTokens(provider, underlyingMint, ata.address, payer, amount);
    return ata.address;
  }

  /** Cancel any pending withdrawal ticket for the given user.
   *  Required to clean up stale tickets from previous tests that failed
   *  or were intentionally skipped, since Drift's `Withdraw` uses `init`
   *  for the ticket PDA and will error if the account already exists. */
  async function clearPendingTicket(user: PublicKey): Promise<void> {
    const [positionPda] = await adapterUserPositionPda(program.programId, user);
    const [ticketPda] = await findPda(
      [Buffer.from("drift_ticket"), positionPda.toBuffer()],
      program.programId
    );
    try {
      await program.account.driftWithdrawalTicket.fetch(ticketPda);
      // Ticket exists — cancel it
      await program.methods
        .cancelUnstake()
        .accounts({
          user: authority.publicKey,
          userPosition: positionPda,
          ticket: ticketPda,
        })
        .rpc();
    } catch {
      // No ticket to clean up
    }
  }
});

async function createVaultTokenAccount(
  provider: anchor.AnchorProvider,
  payer: Keypair,
  underlyingMint: PublicKey,
  vaultAuthorityPda: PublicKey
): Promise<PublicKey> {
  const account = await getOrCreateAssociatedTokenAccount(
    provider.connection, payer, underlyingMint, vaultAuthorityPda, true, undefined, undefined, TOKEN_PROGRAM
  );
  return account.address;
}
