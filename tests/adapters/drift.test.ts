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
  expectRejected,
  runAdapterVaultStatusLifecycle,
  closeAccount,
  fundUserAta,
} from "../helpers/adapter";
import {
  adapterUserPositionPda,
  createTestMint,
  createTestTokenAccount,
  findPda,
  getTokenBalance,
  mintTestTokens,
  sendAndConfirm,
  sendInstruction,
  sleep,
} from "../helpers/index";
import {
  DRIFT_PROGRAM_ID,
  isMainnetFork,
  MAINNET_USDC_MINT,
  TOKEN_PROGRAM_ID as TOKEN_PROGRAM,
} from "../helpers/constants";

// The deployed Drift v2 program has all instruction handlers commented out
// (drift-labs/protocol-v2 #2174, 2026-04-01). Any CPI returns AnchorError 101
// (InstructionFallbackNotFound). All CPI-dependent tests skip on mainnet fork.
// Full evidence: Docs/troubleshooting/drift-fork-issues.md
const DRIFT_CPI_SKIP_REASON = "Drift program has all instructions disabled (AnchorError 101 on CPI) — see Docs/troubleshooting/drift-fork-issues.md";
import { getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { runConformance } from "../helpers/conformance";
import { expect } from "chai";

describe("adapter-drift — CPI round-trip SKIPPED on fork (upstream Drift instructions disabled, see Docs/troubleshooting/drift-fork-issues.md)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AdapterDrift;
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

    underlyingMint = isMainnetFork() ? MAINNET_USDC_MINT : await createTestMint(provider, payer, 6);

    underlyingMint = await initializeAdapterVault(program, authority, vaultStatePda, underlyingMint);

    // Set cooldown to 0 so withdrawals can be settled instantly in tests
    const cdIx = await program.methods
      .setUnstakeCooldown(new anchor.BN(0))
      .accounts({ authority: authority.publicKey, vaultState: vaultStatePda })
      .instruction();
    const cdTx = new anchor.web3.Transaction().add(cdIx);
    cdTx.feePayer = authority.publicKey;
    const cdBh = await provider.connection.getLatestBlockhash();
    cdTx.recentBlockhash = cdBh.blockhash;
    cdTx.lastValidBlockHeight = cdBh.lastValidBlockHeight + 400;
    await provider.wallet.signTransaction(cdTx);
    const cdSig = await provider.connection.sendRawTransaction(cdTx.serialize(), { skipPreflight: true });
    await provider.connection.confirmTransaction(cdSig);

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

    // ── All remaining fork-only tests skipped ──────────────────────────────
    // Reason: Drift's deployed program has all instructions commented out
    // (drift-labs/protocol-v2 #2174), so any CPI returns AnchorError 101.
    // These pass on localnet and will pass on fork once Drift re-enables.
    // See Docs/troubleshooting/drift-fork-issues.md

    it.skip(`protocol CPI executed on deposit — ${DRIFT_CPI_SKIP_REASON}`, async () => {
      await runAdapterProtocolCpiVerification(provider, authority, payer, {
        program,
        vaultStateSeed: "drift_vault_state",
        vaultAuthoritySeed: "drift_vault_authority",
        vaultStateAccountName: "driftVaultState",
      });
    });

    it.skip(`current_value matches deposit amount — ${DRIFT_CPI_SKIP_REASON}`, async () => {
      await runAdapterCurrentValueAccuracy(provider, authority, payer, {
        program,
        vaultStateSeed: "drift_vault_state",
        vaultAuthoritySeed: "drift_vault_authority",
        vaultStateAccountName: "driftVaultState",
      });
    });

    it.skip(`multiple users maintain independent positions — ${DRIFT_CPI_SKIP_REASON}`, async () => {
      const [posPda] = await adapterUserPositionPda(program.programId, authority.publicKey);
      await closeAccount(posPda);
      await clearPendingTicket(authority.publicKey);
      await runAdapterMultipleUsers(provider, authority, payer, {
        program,
        vaultStateSeed: "drift_vault_state",
        vaultAuthoritySeed: "drift_vault_authority",
        vaultStateAccountName: "driftVaultState",
      });
    });

    it.skip(`empty state tests — ${DRIFT_CPI_SKIP_REASON}`, async () => {
      await clearPendingTicket(authority.publicKey);
      await runAdapterEmptyStateTests(provider, authority, payer, {
        program,
        vaultStateSeed: "drift_vault_state",
        vaultAuthoritySeed: "drift_vault_authority",
        vaultStateAccountName: "driftVaultState",
      });
    });

    it.skip(`vault status lifecycle — ${DRIFT_CPI_SKIP_REASON}`, async () => {
      await clearPendingTicket(authority.publicKey);
      await runAdapterVaultStatusLifecycle(provider, authority, payer, {
        program,
        vaultStateSeed: "drift_vault_state",
        vaultAuthoritySeed: "drift_vault_authority",
        vaultStateAccountName: "driftVaultState",
      });
    });
  }

  describe("conformance", () => {
    let vaultStatePda: PublicKey;
    let vaultAuthorityPda: PublicKey;
    let vaultTokenAccount: PublicKey;
    let underlyingMint: PublicKey;

    before(async function () {
      this.timeout(120000);
      vaultStatePda = findPda([Buffer.from("drift_vault_state")], program.programId)[0];
      vaultAuthorityPda = findPda([Buffer.from("drift_vault_authority")], program.programId)[0];
      underlyingMint = isMainnetFork() ? MAINNET_USDC_MINT : await createTestMint(provider, payer, 6);
      try {
        await program.methods.initialize(underlyingMint)
          .accounts({ authority: authority.publicKey, vaultState: vaultStatePda, systemProgram: SystemProgram.programId })
          .rpc();
      } catch { /* already initialized */ }
      vaultTokenAccount = (await getOrCreateAssociatedTokenAccount(
        provider.connection, payer, underlyingMint, vaultAuthorityPda, true, undefined, undefined, TOKEN_PROGRAM
      )).address;
    });

    runConformance(() => ({
      label: "drift",
      program,
      provider,
      authority,
      payer,
      vaultStatePda,
      vaultAuthorityPda,
      vaultTokenAccount,
      underlyingMint,
      vaultStateAccountName: "driftVaultState",
      vaultStateSeed: "drift_vault_state",
      vaultAuthoritySeed: "drift_vault_authority",
      isInstant: false,
      skipProtocolTests: isMainnetFork(),
    }));
  });

  it("rejects zero amount deposit", async () => {
    await runAdapterZeroDepositRejection(provider, authority, payer, {
      program,
      vaultStateSeed: "drift_vault_state",
      vaultAuthoritySeed: "drift_vault_authority",
    });
  });

  it("deposit → current_value → withdraw (request) → settle_withdrawal (two-phase cooldown)", async function () {
    if (isMainnetFork()) this.skip();
    await clearPendingTicket(authority.publicKey);

    const depositAmount = 1_000_000;
    const withdrawShares = 500_000;

    const userTokenAccount = await fundUserAta(provider, payer, authority.publicKey, underlyingMint, depositAmount);
    const [userPositionPda] = await adapterUserPositionPda(program.programId, authority.publicKey);

    await sleep(1000);

    // Phase 0: Deposit
    const dIx = await program.methods.deposit(new anchor.BN(depositAmount), new anchor.BN(0))
      .accounts({
        user: authority.publicKey, vaultState: vaultStatePda, userPosition: userPositionPda,
        userTokenAccount, vaultAuthority: vaultAuthorityPda, vaultTokenAccount,
        tokenProgram: TOKEN_PROGRAM, systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(isMainnetFork() ? [{ pubkey: DRIFT_PROGRAM_ID, isSigner: false, isWritable: false }] : [])
      .instruction();
    await sendInstruction(provider, dIx);

    const vaultBalanceAfterDeposit = await getTokenBalance(provider, vaultTokenAccount);
    expect(vaultBalanceAfterDeposit).to.be.at.least(depositAmount);

    await sleep(1000);

    // current_value
    const cvIx = await program.methods.currentValue()
      .accounts({ user: authority.publicKey, vaultState: vaultStatePda, userPosition: userPositionPda })
      .remainingAccounts(isMainnetFork() ? [{ pubkey: DRIFT_PROGRAM_ID, isSigner: false, isWritable: false }] : [])
      .instruction();
    await sendInstruction(provider, cvIx);

    await sleep(1000);

    // Phase 1: Request withdrawal (creates ticket, locks shares)
    const [ticketPda] = await findPda(
      [Buffer.from("drift_ticket"), userPositionPda.toBuffer()], program.programId
    );

    const wIx = await program.methods.withdraw(new anchor.BN(withdrawShares), new anchor.BN(0))
      .accounts({
        user: authority.publicKey, vaultState: vaultStatePda, userPosition: userPositionPda,
        ticket: ticketPda, tokenProgram: TOKEN_PROGRAM, systemProgram: SystemProgram.programId,
      })
      .instruction();
    await sendInstruction(provider, wIx);

    await sleep(1000);

    // Verify ticket exists
    const ticketAccount = await program.account.driftWithdrawalTicket.fetch(ticketPda);
    expect(ticketAccount.shares.toNumber()).to.equal(withdrawShares);
    expect(ticketAccount.isSettled).to.be.false;

    // Phase 2: Settle withdrawal (cooldown is 0, so instant)
    const sIx = await program.methods.settleWithdrawal()
      .accounts({
        user: authority.publicKey, vaultState: vaultStatePda, userPosition: userPositionPda,
        ticket: ticketPda, userTokenAccount, vaultTokenAccount, vaultAuthority: vaultAuthorityPda,
        tokenProgram: TOKEN_PROGRAM,
      })
      .remainingAccounts(isMainnetFork() ? [{ pubkey: DRIFT_PROGRAM_ID, isSigner: false, isWritable: false }] : [])
      .instruction();
    await sendInstruction(provider, sIx);

    // Ticket should be closed (rent returned)
    const ticketInfo = await provider.connection.getAccountInfo(ticketPda);
    expect(ticketInfo).to.be.null;

    // Verify user received underlying
    const userBalance = await getTokenBalance(provider, userTokenAccount);
    expect(userBalance).to.be.greaterThan(0);

    const vaultBalanceAfterWithdraw = await getTokenBalance(provider, vaultTokenAccount);
    expect(vaultBalanceAfterWithdraw).to.be.lessThan(vaultBalanceAfterDeposit);
  });

  it("rejects withdraw request with excessive min_underlying_out (slippage)", async function () {
    if (isMainnetFork()) this.skip();
    await clearPendingTicket(authority.publicKey);
    const cdIx = await program.methods.setUnstakeCooldown(new anchor.BN(0))
      .accounts({ authority: authority.publicKey, vaultState: vaultStatePda })
      .instruction();
    await sendInstruction(provider, cdIx);

    const userTokenAccount = await fundUserAta(provider, payer, authority.publicKey, underlyingMint, 1_000_000);
    const [userPositionPda] = await adapterUserPositionPda(program.programId, authority.publicKey);

    await sleep(1000);

    const dIx = await program.methods.deposit(new anchor.BN(1_000_000), new anchor.BN(0))
      .accounts({
        user: authority.publicKey, vaultState: vaultStatePda, userPosition: userPositionPda,
        userTokenAccount, vaultAuthority: vaultAuthorityPda, vaultTokenAccount,
        tokenProgram: TOKEN_PROGRAM, systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(isMainnetFork() ? [{ pubkey: DRIFT_PROGRAM_ID, isSigner: false, isWritable: false }] : [])
      .instruction();
    await sendInstruction(provider, dIx);

    await sleep(1000);

    const [ticketPda] = await findPda(
      [Buffer.from("drift_ticket"), userPositionPda.toBuffer()], program.programId
    );

    const wIx = await program.methods.withdraw(new anchor.BN(500_000), new anchor.BN(1_000_000))
      .accounts({
        user: authority.publicKey, vaultState: vaultStatePda, userPosition: userPositionPda,
        ticket: ticketPda, tokenProgram: TOKEN_PROGRAM, systemProgram: SystemProgram.programId,
      })
      .instruction();
    const wTx = new anchor.web3.Transaction().add(wIx);
    wTx.feePayer = authority.publicKey;
    const wBh = await provider.connection.getLatestBlockhash();
    wTx.recentBlockhash = wBh.blockhash;
    wTx.lastValidBlockHeight = wBh.lastValidBlockHeight + 400;
    await provider.wallet.signTransaction(wTx);
    const wSig = await provider.connection.sendRawTransaction(wTx.serialize(), { skipPreflight: true });
    const wCr = await provider.connection.confirmTransaction(wSig);
    if (!wCr.value.err) {
      expect.fail("Should have rejected withdraw with excessive min_underlying_out");
    }
    const logs = (await provider.connection.getTransaction(wSig, { commitment: "confirmed" }))
      ?.meta?.logMessages?.join("\n") ?? "";
    expect(logs).to.satisfy((s: string) =>
      s.includes("SlippageExceeded") || s.includes("min_underlying")
    );
  });

  it("rejects settlement before cooldown elapses", async function () {
    if (isMainnetFork()) this.skip();
    await clearPendingTicket(authority.publicKey);

    // Set cooldown to large value
    const cdIx = await program.methods.setUnstakeCooldown(new anchor.BN(999_999_999))
      .accounts({ authority: authority.publicKey, vaultState: vaultStatePda })
      .instruction();
    await sendInstruction(provider, cdIx);

    const userTokenAccount = await fundUserAta(provider, payer, authority.publicKey, underlyingMint, 1_000_000);
    const [userPositionPda] = await adapterUserPositionPda(program.programId, authority.publicKey);

    await sleep(1000);

    const dIx = await program.methods.deposit(new anchor.BN(1_000_000), new anchor.BN(0))
      .accounts({
        user: authority.publicKey, vaultState: vaultStatePda, userPosition: userPositionPda,
        userTokenAccount, vaultAuthority: vaultAuthorityPda, vaultTokenAccount,
        tokenProgram: TOKEN_PROGRAM, systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(isMainnetFork() ? [{ pubkey: DRIFT_PROGRAM_ID, isSigner: false, isWritable: false }] : [])
      .instruction();
    await sendInstruction(provider, dIx);

    await sleep(1000);

    const [ticketPda] = await findPda(
      [Buffer.from("drift_ticket"), userPositionPda.toBuffer()], program.programId
    );

    const wIx = await program.methods.withdraw(new anchor.BN(500_000), new anchor.BN(0))
      .accounts({
        user: authority.publicKey, vaultState: vaultStatePda, userPosition: userPositionPda,
        ticket: ticketPda, tokenProgram: TOKEN_PROGRAM, systemProgram: SystemProgram.programId,
      })
      .instruction();
    await sendInstruction(provider, wIx);

    await sleep(1000);

    await expectRejected(provider, authority,
      () => program.methods.settleWithdrawal()
        .accounts({
          user: authority.publicKey, vaultState: vaultStatePda, userPosition: userPositionPda,
          ticket: ticketPda, userTokenAccount, vaultTokenAccount, vaultAuthority: vaultAuthorityPda,
          tokenProgram: TOKEN_PROGRAM,
        })
        .instruction(),
      ["CooldownNotElapsed", "cooldown"]
    );
  });

  it("rejects zero amount withdraw request", async function () {
    if (isMainnetFork()) this.skip();
    const depositAmount = 1_000_000;

    await clearPendingTicket(authority.publicKey);
    const cdIx = await program.methods.setUnstakeCooldown(new anchor.BN(0))
      .accounts({ authority: authority.publicKey, vaultState: vaultStatePda })
      .instruction();
    await sendInstruction(provider, cdIx);

    const userTokenAccount = await fundUserAta(provider, payer, authority.publicKey, underlyingMint, depositAmount);
    const [userPositionPda] = await adapterUserPositionPda(program.programId, authority.publicKey);

    await sleep(1000);

    const dIx = await program.methods.deposit(new anchor.BN(depositAmount), new anchor.BN(0))
      .accounts({
        user: authority.publicKey, vaultState: vaultStatePda, userPosition: userPositionPda,
        userTokenAccount, vaultAuthority: vaultAuthorityPda, vaultTokenAccount,
        tokenProgram: TOKEN_PROGRAM, systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(isMainnetFork() ? [{ pubkey: DRIFT_PROGRAM_ID, isSigner: false, isWritable: false }] : [])
      .instruction();
    await sendInstruction(provider, dIx);

    await sleep(1000);

    const [ticketPda] = await findPda(
      [Buffer.from("drift_ticket"), userPositionPda.toBuffer()], program.programId
    );

    const wIx = await program.methods.withdraw(new anchor.BN(0), new anchor.BN(0))
      .accounts({
        user: authority.publicKey, vaultState: vaultStatePda, userPosition: userPositionPda,
        ticket: ticketPda, tokenProgram: TOKEN_PROGRAM, systemProgram: SystemProgram.programId,
      })
      .instruction();
    const wTx = new anchor.web3.Transaction().add(wIx);
    wTx.feePayer = authority.publicKey;
    const wBh = await provider.connection.getLatestBlockhash();
    wTx.recentBlockhash = wBh.blockhash;
    wTx.lastValidBlockHeight = wBh.lastValidBlockHeight + 400;
    await provider.wallet.signTransaction(wTx);
    const wSig = await provider.connection.sendRawTransaction(wTx.serialize(), { skipPreflight: true });
    const wCr = await provider.connection.confirmTransaction(wSig);
    if (!wCr.value.err) {
      expect.fail("Should have rejected zero withdraw");
    }
    const logs = (await provider.connection.getTransaction(wSig, { commitment: "confirmed" }))
      ?.meta?.logMessages?.join("\n") ?? "";
    expect(logs).to.satisfy((s: string) =>
      s.includes("greater than zero") || s.includes("Withdrawal amount")
    );
  });

  it("cancel unstake returns shares to position", async function () {
    if (isMainnetFork()) this.skip();
    await clearPendingTicket(authority.publicKey);
    const cdIx = await program.methods.setUnstakeCooldown(new anchor.BN(0))
      .accounts({ authority: authority.publicKey, vaultState: vaultStatePda })
      .instruction();
    await sendInstruction(provider, cdIx);

    await sleep(1000);
    const depositAmount = 1_000_000;
    const withdrawShares = 500_000;

    const userTokenAccount = await fundUserAta(provider, payer, authority.publicKey, underlyingMint, depositAmount);
    const [userPositionPda] = await adapterUserPositionPda(program.programId, authority.publicKey);

    await sleep(1000);

    // Deposit
    const dIx = await program.methods.deposit(new anchor.BN(depositAmount), new anchor.BN(0))
      .accounts({
        user: authority.publicKey, vaultState: vaultStatePda, userPosition: userPositionPda,
        userTokenAccount, vaultAuthority: vaultAuthorityPda, vaultTokenAccount,
        tokenProgram: TOKEN_PROGRAM, systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(isMainnetFork() ? [{ pubkey: DRIFT_PROGRAM_ID, isSigner: false, isWritable: false }] : [])
      .instruction();
    await sendInstruction(provider, dIx);

    await sleep(1000);

    // Request withdrawal (creates ticket)
    const [ticketPda] = await findPda(
      [Buffer.from("drift_ticket"), userPositionPda.toBuffer()], program.programId
    );

    const wIx = await program.methods.withdraw(new anchor.BN(withdrawShares), new anchor.BN(0))
      .accounts({
        user: authority.publicKey, vaultState: vaultStatePda, userPosition: userPositionPda,
        ticket: ticketPda, tokenProgram: TOKEN_PROGRAM, systemProgram: SystemProgram.programId,
      })
      .instruction();
    await sendInstruction(provider, wIx);

    await sleep(1000);

    // Verify ticket exists and shares are locked
    let ticketAccount = await program.account.driftWithdrawalTicket.fetch(ticketPda);
    expect(ticketAccount.shares.toNumber()).to.equal(withdrawShares);
    expect(ticketAccount.isSettled).to.be.false;

    // Cancel the unstake
    const cIx = await program.methods.cancelUnstake()
      .accounts({ user: authority.publicKey, userPosition: userPositionPda, ticket: ticketPda })
      .instruction();
    await sendInstruction(provider, cIx);

    await sleep(1000);

    // Ticket should be closed
    const ticketInfo = await provider.connection.getAccountInfo(ticketPda);
    expect(ticketInfo).to.be.null;

    // Shares should be returned to position
    const position = await program.account.adapterPosition.fetch(userPositionPda);
    expect(position.receiptTokenBalance.toNumber()).to.be.at.least(depositAmount);

    await sleep(1000);

    // Should be able to withdraw normally now (re-creates ticket at same PDA)
    const w2Ix = await program.methods.withdraw(new anchor.BN(position.receiptTokenBalance.toNumber()), new anchor.BN(0))
      .accounts({
        user: authority.publicKey, vaultState: vaultStatePda, userPosition: userPositionPda,
        ticket: ticketPda, tokenProgram: TOKEN_PROGRAM, systemProgram: SystemProgram.programId,
      })
      .instruction();
    await sendInstruction(provider, w2Ix);
  });

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
      // Ticket exists — cancel it with raw tx
      const cIx = await program.methods.cancelUnstake()
        .accounts({ user: authority.publicKey, userPosition: positionPda, ticket: ticketPda })
        .instruction();
      const cTx = new anchor.web3.Transaction().add(cIx);
      cTx.feePayer = authority.publicKey;
      const cBh = await provider.connection.getLatestBlockhash();
      cTx.recentBlockhash = cBh.blockhash;
      cTx.lastValidBlockHeight = cBh.lastValidBlockHeight + 400;
      await provider.wallet.signTransaction(cTx);
      const cSig = await provider.connection.sendRawTransaction(cTx.serialize(), { skipPreflight: true });
      await provider.connection.confirmTransaction(cSig);
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
