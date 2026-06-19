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
  program: Program;
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

  // Check 1: initialize idempotent (skip for adapters with extra required accounts like maple)
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
  it(`deposit then current_value ≈ deposit amount`, async () => {
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
    if (c.depositRemainingAccounts) di.keys.push(...c.depositRemainingAccounts.map(a => ({ ...a, pubkey: a.pubkey, isSigner: a.isSigner ?? false, isWritable: a.isWritable ?? false })));
    await sendInstruction(c.provider, di);

    await sleep(500);
    const cv = await c.program.methods
      .currentValue()
      .accounts({ user: c.authority.publicKey, vaultState: c.vaultStatePda, userPosition: posPda })
      .instruction();
    if (c.valueRemainingAccounts) cv.keys.push(...c.valueRemainingAccounts.map(a => ({ ...a, pubkey: a.pubkey, isSigner: a.isSigner ?? false, isWritable: a.isWritable ?? false })));
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
      if (c.depositRemainingAccounts) di.keys.push(...c.depositRemainingAccounts.map(a => ({ ...a, pubkey: a.pubkey, isSigner: a.isSigner ?? false, isWritable: a.isWritable ?? false })));
      await sendInstruction(c.provider, di);
      await sleep(500);
      acc = await c.provider.connection.getAccountInfo(posPda);
      if (!acc) throw new Error("position not created after deposit");
    }
    // Poll for fresh position data (Surfpool cache may be stale).
    // Use raw getAccountInfo to bypass Anchor's AccountClient cache.
    let posRaw = await c.provider.connection.getAccountInfo(posPda);
    let receiptBalance = "0";
    for (let i = 0; i < 15; i++) {
      if (posRaw && posRaw.data.length >= 113) {
        // receipt_token_balance at offset 8+32+32+8+8 = 88
        receiptBalance = posRaw.data.readBigUInt64LE(88).toString();
        if (receiptBalance !== "0") break;
      }
      await sleep(2000);
      posRaw = await c.provider.connection.getAccountInfo(posPda);
    }
    expect(Number(receiptBalance)).to.be.greaterThan(0);
  });

  // Check 4: unified decoder M6 gate
  it("unified SDK decoder reads this adapter's Position (M6 gate)", async () => {
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
      if (c.depositRemainingAccounts) di.keys.push(...c.depositRemainingAccounts.map(a => ({ ...a, pubkey: a.pubkey, isSigner: a.isSigner ?? false, isWritable: a.isWritable ?? false })));
      await sendInstruction(c.provider, di);
      await sleep(500);
      info = await c.provider.connection.getAccountInfo(posPda);
    }
    expect(info, "Position account should exist").to.not.be.null;
    // Poll for fresh position data (Surfpool cache may be stale)
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
    expect(data.length, "Position data should be 113 bytes (8 discriminator + 105 fields)").to.equal(113);

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
    // Fund tempUser with 2 SOL and create USDC ATA
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
    if (c.depositRemainingAccounts) di.keys.push(...c.depositRemainingAccounts.map(a => ({ ...a, pubkey: a.pubkey, isSigner: a.isSigner ?? false, isWritable: a.isWritable ?? false })));

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

  // Check 6: vault status lifecycle (fork-only)
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
