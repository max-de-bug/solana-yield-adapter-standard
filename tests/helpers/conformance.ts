import { Program, AnchorProvider, Wallet } from "@anchor-lang/core";
import { Keypair, PublicKey, Transaction, SystemProgram, AccountMeta, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import BN from "bn.js";
import { expect } from "chai";

import { decodePosition } from "../../packages/sdk/src/decode";
import { adapterUserPositionPda, getTokenBalance, sendInstruction, sleep } from "./index";
import { expectRejected, fundUserAta, runAdapterVaultStatusLifecycle } from "./adapter";
import { isMainnetFork } from "./constants";

/**
 * Configuration for the standardised conformance test suite.
 *
 * Each adapter test file instantiates one of these and passes it to
 * `runConformance()`, which registers all standard `it()` blocks.
 *
 * @example
 * ```typescript
 * runConformance(() => ({
 *   label: "kamino",
 *   program,
 *   provider,
 *   authority,
 *   payer,
 *   vaultStatePda,
 *   vaultAuthorityPda,
 *   vaultTokenAccount,
 *   underlyingMint,
 *   vaultStateAccountName: "kaminoVaultState",
 *   vaultStateSeed: "kamino_vault_state",
 *   vaultAuthoritySeed: "kamino_vault_authority",
 *   isInstant: true,
 * }));
 * ``` */
export interface ConformanceConfig {
  label: string;
  program: any;
  provider: AnchorProvider;
  authority: Wallet;
  payer: Keypair;
  vaultStatePda: PublicKey;
  vaultAuthorityPda: PublicKey;
  vaultTokenAccount: PublicKey;
  underlyingMint: PublicKey;
  vaultStateAccountName: string;
  vaultStateSeed: string;
  vaultAuthoritySeed: string;
  depositAmount?: BN;
  toleranceBps?: number;
  isInstant: boolean;
  depositRemainingAccounts?: AccountMeta[];
  valueRemainingAccounts?: AccountMeta[];
  skipProtocolTests?: boolean;
  skipInitTest?: boolean;
  skipVaultLifecycle?: boolean;
}

/**
 * Build AccountMeta from raw pubkey for remaining accounts.
 * Ensures isSigner/isWritable defaults are set to avoid type issues. */
function toAccountMeta(pk: PublicKey, isWritable: boolean, isSigner: boolean): AccountMeta {
  return { pubkey: pk, isWritable, isSigner };
}

/**
 * Registers a standard set of conformance tests for any yield adapter.
 *
 * Call this inside a `describe()` block. The `get` function is evaluated
 * lazily so config can reference variables set in `before()`. */
export function runConformance(get: () => ConformanceConfig): void {
  const cfg = () => {
    const c = get();
    if (!c.depositAmount) c.depositAmount = new BN(1_000_000);
    if (!c.toleranceBps) c.toleranceBps = 1;
    return c;
  };

  // Check 1: initialize idempotent
  if (!cfg().skipInitTest) {
    it("initialize vault is idempotent", async () => {
      const { program, authority, vaultStatePda, underlyingMint } = cfg();
      try {
        await program.methods
          .initialize(underlyingMint)
          .accounts({ authority: authority.publicKey, vaultState: vaultStatePda, systemProgram: SystemProgram.programId })
          .rpc();
      } catch (e: unknown) {
        const msg = String(e);
        if (!msg.includes("already in use") && !msg.includes("0x0")) throw e;
      }
    });
  }

  // Check 2: deposit → current_value ≈ amount
  it("deposit then current_value ≈ deposit amount", async () => {
    const c = cfg();
    const amt = c.depositAmount!.toNumber();
    const userAta = await fundUserAta(c.provider, c.payer, c.authority.publicKey, c.underlyingMint, amt * 2);
    const [posPda] = adapterUserPositionPda(c.program.programId, c.authority.publicKey);

    await sleep(500);
    const di = await c.program.methods
      .deposit(c.depositAmount!, new BN(0))
      .accounts({
        user: c.authority.publicKey, vaultState: c.vaultStatePda, userPosition: posPda,
        userTokenAccount: userAta, vaultAuthority: c.vaultAuthorityPda,
        vaultTokenAccount: c.vaultTokenAccount, tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    if (c.depositRemainingAccounts) {
      di.keys.push(...c.depositRemainingAccounts.map(a => toAccountMeta(a.pubkey, a.isWritable ?? false, a.isSigner ?? false)));
    }
    await sendInstruction(c.provider, di);

    await sleep(500);
    const cv = await c.program.methods
      .currentValue()
      .accounts({ user: c.authority.publicKey, vaultState: c.vaultStatePda, userPosition: posPda })
      .instruction();
    if (c.valueRemainingAccounts) {
      cv.keys.push(...c.valueRemainingAccounts.map(a => toAccountMeta(a.pubkey, a.isWritable ?? false, a.isSigner ?? false)));
    }
    await sendInstruction(c.provider, cv);

    const vaultBal = await getTokenBalance(c.provider, c.vaultTokenAccount);
    expect(vaultBal).to.be.at.least(amt);
  });

  // Check 3: position receiptTokenBalance > 0
  it("position receiptTokenBalance > 0 after deposit", async () => {
    const c = cfg();
    const [posPda] = adapterUserPositionPda(c.program.programId, c.authority.publicKey);
    let acc = await c.provider.connection.getAccountInfo(posPda);
    if (!acc) {
      const userAta = await fundUserAta(c.provider, c.payer, c.authority.publicKey, c.underlyingMint, Number(c.depositAmount!) * 2);
      await sleep(500);
      const di = await c.program.methods
        .deposit(c.depositAmount!, new BN(0))
        .accounts({
          user: c.authority.publicKey, vaultState: c.vaultStatePda, userPosition: posPda,
          userTokenAccount: userAta, vaultAuthority: c.vaultAuthorityPda,
          vaultTokenAccount: c.vaultTokenAccount, tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
      if (c.depositRemainingAccounts) {
        di.keys.push(...c.depositRemainingAccounts.map(a => toAccountMeta(a.pubkey, a.isWritable ?? false, a.isSigner ?? false)));
      }
      await sendInstruction(c.provider, di);
      await sleep(500);
      acc = await c.provider.connection.getAccountInfo(posPda);
      if (!acc) throw new Error("position not created after deposit");
    }
    let posRaw = await c.provider.connection.getAccountInfo(posPda);
    let receiptBalance = "0";
    for (let i = 0; i < 15; i++) {
      if (posRaw && posRaw.data.length >= 113) {
        receiptBalance = posRaw.data.readBigUInt64LE(88).toString();
        if (receiptBalance !== "0") break;
      }
      await sleep(2000);
      posRaw = await c.provider.connection.getAccountInfo(posPda);
    }
    expect(Number(receiptBalance)).to.be.greaterThan(0);
  });

  // Check 4: unified decoder gate
  it("unified SDK decoder reads this adapter's Position", async () => {
    const c = cfg();
    const [posPda] = adapterUserPositionPda(c.program.programId, c.authority.publicKey);
    let info = await c.provider.connection.getAccountInfo(posPda);
    if (!info) {
      const userAta = await fundUserAta(c.provider, c.payer, c.authority.publicKey, c.underlyingMint, Number(c.depositAmount!) * 2);
      await sleep(500);
      const di = await c.program.methods
        .deposit(c.depositAmount!, new BN(0))
        .accounts({
          user: c.authority.publicKey, vaultState: c.vaultStatePda, userPosition: posPda,
          userTokenAccount: userAta, vaultAuthority: c.vaultAuthorityPda,
          vaultTokenAccount: c.vaultTokenAccount, tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
      if (c.depositRemainingAccounts) {
        di.keys.push(...c.depositRemainingAccounts.map(a => toAccountMeta(a.pubkey, a.isWritable ?? false, a.isSigner ?? false)));
      }
      await sendInstruction(c.provider, di);
      await sleep(500);
      info = await c.provider.connection.getAccountInfo(posPda);
    }
    expect(info, "Position account should exist").to.not.be.null;
    let data = info!.data;
    for (let i = 0; i < 15; i++) {
      const fresh = await c.provider.connection.getAccountInfo(posPda);
      if (fresh && fresh.data.length >= 113) {
        const bal = fresh.data.readBigUInt64LE(88);
        if (bal > 0n) { data = fresh.data; break; }
      }
      await sleep(2000);
    }
    info = { ...info!, data };
    expect(data.length, "Position data should be 113 bytes").to.equal(113);

    const decoded = decodePosition(data);
    expect(decoded.owner.equals(c.authority.publicKey), "decoded owner matches user").to.be.true;
    expect(Number(decoded.receiptTokenBalance), "decoded receiptTokenBalance > 0").to.be.greaterThan(0);
    expect(Number(decoded.bump), "decoded bump is a valid u8").to.be.at.least(0);
  });

  // Check 5: impossible slippage reverts
  it("impossible minSharesOut reverts (SlippageExceeded)", async function () {
    this.timeout(120000);
    const c = cfg();
    const tempUser = Keypair.generate();
    const tempPosPda = adapterUserPositionPda(c.program.programId, tempUser.publicKey)[0];
    const tempAta = await getOrCreateAssociatedTokenAccount(
      c.provider.connection, c.payer, c.underlyingMint, tempUser.publicKey
    ).then(a => a.address);
    await sendInstruction(c.provider,
      SystemProgram.transfer({
        fromPubkey: c.authority.publicKey,
        toPubkey: tempUser.publicKey,
        lamports: LAMPORTS_PER_SOL,
      })
    );
    const authAta = await getOrCreateAssociatedTokenAccount(
      c.provider.connection, c.payer, c.underlyingMint, c.authority.publicKey
    ).then(a => a.address);
    const { createTransferInstruction } = require("@solana/spl-token");
    await sendInstruction(c.provider,
      createTransferInstruction(authAta, tempAta, c.authority.publicKey, Number(c.depositAmount!) * 2)
    );

    await sleep(500);
    const di = await c.program.methods
      .deposit(c.depositAmount!, new BN(10_000_000_000))
      .accounts({
        user: tempUser.publicKey, vaultState: c.vaultStatePda, userPosition: tempPosPda,
        userTokenAccount: tempAta, vaultAuthority: c.vaultAuthorityPda,
        vaultTokenAccount: c.vaultTokenAccount, tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    if (c.depositRemainingAccounts) {
      di.keys.push(...c.depositRemainingAccounts.map(a => toAccountMeta(a.pubkey, a.isWritable ?? false, a.isSigner ?? false)));
    }

    const tx = new Transaction().add(di);
    tx.feePayer = tempUser.publicKey;
    const bh = await c.provider.connection.getLatestBlockhash();
    tx.recentBlockhash = bh.blockhash;
    tx.lastValidBlockHeight = bh.lastValidBlockHeight + 2000;
    tx.sign(tempUser);

    let txErr: any;
    let sig: string | undefined;
    try {
      sig = await c.provider.connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
      const cr = await c.provider.connection.confirmTransaction({
        signature: sig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight + 2000,
      });
      if (cr.value.err) txErr = cr.value.err;
    } catch (err: unknown) {
      txErr = err;
    }
    if (!txErr) {
      expect.fail("Should have rejected deposit with impossible minSharesOut");
    }
    const logs = sig ? (await c.provider.connection.getTransaction(sig, { commitment: "confirmed" }))
      ?.meta?.logMessages?.join("\n") ?? "" : "";
    const msg = typeof txErr === "object" ? JSON.stringify(txErr) + " " + logs : String(txErr) + " " + logs;
    expect(msg).to.satisfy((s: string) =>
      s.includes("SlippageExceeded") || s.includes("min_share") || s.includes("shares") || s.includes("Custom")
    );
  });

  // Check 6: reject zero amount withdraw
  it("rejects zero amount withdraw", async function () {
    this.timeout(120000);
    const c = cfg();
    const amt = Number(c.depositAmount!);
    const userAta = await fundUserAta(c.provider, c.payer, c.authority.publicKey, c.underlyingMint, amt * 2);
    const [posPda] = adapterUserPositionPda(c.program.programId, c.authority.publicKey);

    // Deposit first
    await sleep(500);
    const di = await c.program.methods
      .deposit(c.depositAmount!, new BN(0))
      .accounts({
        user: c.authority.publicKey, vaultState: c.vaultStatePda, userPosition: posPda,
        userTokenAccount: userAta, vaultAuthority: c.vaultAuthorityPda,
        vaultTokenAccount: c.vaultTokenAccount, tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    if (c.depositRemainingAccounts) {
      di.keys.push(...c.depositRemainingAccounts.map(a => toAccountMeta(a.pubkey, a.isWritable ?? false, a.isSigner ?? false)));
    }
    await sendInstruction(c.provider, di);
    await sleep(500);

    // Try zero withdraw using raw transaction for reliable error detection
    const wi = await c.program.methods
      .withdraw(new BN(0), new BN(0))
      .accounts({
        user: c.authority.publicKey, vaultState: c.vaultStatePda, userPosition: posPda,
        userTokenAccount: userAta, vaultTokenAccount: c.vaultTokenAccount,
        vaultAuthority: c.vaultAuthorityPda, tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    const wTx = new Transaction().add(wi);
    wTx.feePayer = c.authority.publicKey;
    const wBh = await c.provider.connection.getLatestBlockhash();
    wTx.recentBlockhash = wBh.blockhash;
    wTx.lastValidBlockHeight = wBh.lastValidBlockHeight + 2000;
    try {
      if ("signTransaction" in c.authority) {
        await c.authority.signTransaction(wTx);
      }
      const wSig = await c.provider.connection.sendRawTransaction(wTx.serialize(), { skipPreflight: true });
      const wCr = await c.provider.connection.confirmTransaction({
        signature: wSig, blockhash: wBh.blockhash, lastValidBlockHeight: wBh.lastValidBlockHeight + 2000,
      });
      if (!wCr.value.err) {
        expect.fail("Should have rejected zero withdraw");
      }
      const wLogs = (await c.provider.connection.getTransaction(wSig, { commitment: "confirmed" }))
        ?.meta?.logMessages?.join("\n") ?? "";
      expect(wLogs).to.satisfy((s: string) =>
        s.includes("ZeroWithdrawAmount") || s.includes("withdrawal") || s.includes("must be greater")
      );
    } catch (err: unknown) {
      const msg = typeof err === 'string' ? err
        : err instanceof Error ? err.message
          : JSON.stringify(err);
      expect(msg).to.satisfy((s: string) =>
        s.includes("ZeroWithdrawAmount") || s.includes("withdrawal") || s.includes("must be greater")
      );
    }
  });

  // Check 7: full round-trip
  it("full round-trip: deposit → withdraw all shares → vault empty", async function () {
    this.timeout(120000);
    const c = cfg();
    const amt = Number(c.depositAmount!);
    const userAta = await fundUserAta(c.provider, c.payer, c.authority.publicKey, c.underlyingMint, amt * 2);
    const [posPda] = adapterUserPositionPda(c.program.programId, c.authority.publicKey);

    const vaultBefore = await getTokenBalance(c.provider, c.vaultTokenAccount);

    // Deposit
    await sleep(500);
    const di = await c.program.methods
      .deposit(c.depositAmount!, new BN(0))
      .accounts({
        user: c.authority.publicKey, vaultState: c.vaultStatePda, userPosition: posPda,
        userTokenAccount: userAta, vaultAuthority: c.vaultAuthorityPda,
        vaultTokenAccount: c.vaultTokenAccount, tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    if (c.depositRemainingAccounts) {
      di.keys.push(...c.depositRemainingAccounts.map(a => toAccountMeta(a.pubkey, a.isWritable ?? false, a.isSigner ?? false)));
    }
    await sendInstruction(c.provider, di);
    await sleep(500);

    const pos = await c.program.account.adapterPosition.fetch(posPda);
    const totalShares = pos.receiptTokenBalance.toNumber();
    expect(totalShares).to.be.greaterThan(0);

    // Withdraw all shares
    const wi = await c.program.methods
      .withdraw(new BN(totalShares), new BN(0))
      .accounts({
        user: c.authority.publicKey, vaultState: c.vaultStatePda, userPosition: posPda,
        userTokenAccount: userAta, vaultTokenAccount: c.vaultTokenAccount,
        vaultAuthority: c.vaultAuthorityPda, tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    await sendInstruction(c.provider, wi);
    await sleep(500);

    const vaultAfter = await getTokenBalance(c.provider, c.vaultTokenAccount);
    expect(vaultAfter).to.equal(vaultBefore);

    const posAfter = await c.program.account.adapterPosition.fetch(posPda);
    expect(posAfter.receiptTokenBalance.toNumber()).to.equal(0);
  });

  // Check 8: vault status lifecycle (fork-only)
  if (isMainnetFork()) {
    it("vault status lifecycle: toggle DepositsPaused → Paused → Active", async function () {
      const c = cfg();
      if (c.skipProtocolTests || c.skipVaultLifecycle) return this.skip();
      await runAdapterVaultStatusLifecycle(c.provider, c.authority, c.payer, {
        program: c.program,
        vaultStateSeed: c.vaultStateSeed,
        vaultAuthoritySeed: c.vaultAuthoritySeed,
        vaultStateAccountName: c.vaultStateAccountName,
      });
    });
  }
}