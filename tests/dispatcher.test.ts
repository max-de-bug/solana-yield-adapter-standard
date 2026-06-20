import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { expect } from "chai";
import {
  createTestTokenAccount,
  mintTestTokens,
  getTokenBalance,
  findPda,
  sleep,
} from "./helpers";
import {
  fundUserUsdcOnFork,
  resolveUnderlyingMint,
  surfnetSetAccount,
} from "./helpers/adapter";
import { isMainnetFork, MAINNET_USDC_MINT } from "./helpers/constants";
import {
  ensureRegistryInitialized,
  setupApprovedKaminoForDispatcher,
  setupApprovedAdapterForDispatcher,
  userPositionPda,
} from "./helpers/dispatcher";

describe("yield-dispatcher", () => {
  const url = process.env.ANCHOR_PROVIDER_URL || "http://127.0.0.1:8899";
  const connection = new anchor.web3.Connection(url, { confirmTransactionInitialTimeout: 120_000 });
  const wallet = anchor.Wallet.local();
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "processed" });
  anchor.setProvider(provider);

  const program = anchor.workspace.YieldDispatcher;
  const registryProgram = anchor.workspace.AdapterRegistry;
  const kaminoProgram = anchor.workspace.AdapterKamino;
  const authority = provider.wallet as anchor.Wallet;
  const payer = (provider.wallet as anchor.Wallet).payer as Keypair;

  let dispatcherStatePda: PublicKey;
  let usdcMint: PublicKey;
  let registryStatePda: PublicKey;

  async function fundUserForTest(
    mint: PublicKey,
    amount: number
  ): Promise<PublicKey> {
    if (isMainnetFork() && mint.equals(MAINNET_USDC_MINT)) {
      const funded = await fundUserUsdcOnFork(
        provider,
        payer,
        authority.publicKey,
        amount * 2
      );
      return funded.userAta;
    }
    const ata = await createTestTokenAccount(
      provider,
      mint,
      authority.publicKey,
      payer
    );
    await mintTestTokens(provider, mint, ata, payer, amount * 2);
    return ata;
  }

  async function patchDispatcherAuthority(conn: anchor.web3.Connection, dispatcherPda: PublicKey, desiredAuthority: PublicKey): Promise<void> {
    if (!isMainnetFork()) return;
    const info = await conn.getAccountInfo(dispatcherPda);
    if (!info) return;
    const data = Buffer.from(info.data);
    if (data.length < 40) return;
    const currentAuth = new PublicKey(data.slice(8, 40));
    if (currentAuth.equals(desiredAuthority)) return;
    desiredAuthority.toBuffer().copy(data, 8);
    await surfnetSetAccount(dispatcherPda.toString(), data.toString("hex"), info.lamports, info.owner.toString(), info.executable, info.rentEpoch!);
  }

  before(async () => {
    [dispatcherStatePda] = findPda(
      [Buffer.from("dispatcher_state")],
      program.programId
    );

    // Patch dispatcher authority to match test wallet (handles persistent state from prior runs)
    await patchDispatcherAuthority(provider.connection, dispatcherStatePda, authority.publicKey);

    usdcMint = await resolveUnderlyingMint(provider, payer);
    registryStatePda = await ensureRegistryInitialized(
      registryProgram,
      authority
    );
  });

  beforeEach(async () => {
    // Ensure dispatcher is unpaused before each test
    try {
      const state = await program.account.dispatcherState.fetch(dispatcherStatePda);
      if (state.isPaused) {
        const unIx = await program.methods
          .togglePause()
          .accounts({ authority: authority.publicKey, dispatcherState: dispatcherStatePda })
          .instruction();
        const unTx = new anchor.web3.Transaction().add(unIx);
        unTx.feePayer = authority.publicKey;
        const unBh = await provider.connection.getLatestBlockhash();
        unTx.recentBlockhash = unBh.blockhash;
        unTx.lastValidBlockHeight = unBh.lastValidBlockHeight + 2000;
        await provider.wallet.signTransaction(unTx);
        const unSig = await provider.connection.sendRawTransaction(unTx.serialize(), { skipPreflight: true });
        await provider.connection.confirmTransaction(unSig);
      }
    } catch {
      // dispatcher not initialized yet
    }
  });

  it("initializes the dispatcher", async () => {
    try {
      await program.methods
        .initialize()
        .accounts({
          authority: authority.publicKey,
          dispatcherState: dispatcherStatePda,
          registryProgram: registryProgram.programId,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (e: unknown) {
      const msg = String(e);
      if (!msg.includes("already in use") && !msg.includes("0x0")) {
        throw e;
      }
    }

    const state = await program.account.dispatcherState.fetch(
      dispatcherStatePda
    );
    expect(state.authority.toString()).to.equal(authority.publicKey.toString());
    expect(state.registryProgramId.toString()).to.equal(
      registryProgram.programId.toString()
    );
    expect(state.totalDeposits.toNumber()).to.be.at.least(0);
    expect(state.isPaused).to.be.false;
  });

  it("toggles pause and blocks deposits when paused", async () => {
    // Toggle pause ON
    const pOnIx = await program.methods
      .togglePause()
      .accounts({
        authority: authority.publicKey,
        dispatcherState: dispatcherStatePda,
      })
      .instruction();
    const pOnTx = new anchor.web3.Transaction().add(pOnIx);
    pOnTx.feePayer = authority.publicKey;
    const pOnBh = await provider.connection.getLatestBlockhash();
    pOnTx.recentBlockhash = pOnBh.blockhash;
    pOnTx.lastValidBlockHeight = pOnBh.lastValidBlockHeight + 2000;
    await provider.wallet.signTransaction(pOnTx);
    const pOnSig = await provider.connection.sendRawTransaction(pOnTx.serialize(), { skipPreflight: true });
    await provider.connection.confirmTransaction(pOnSig);

    let state = await program.account.dispatcherState.fetch(
      dispatcherStatePda
    );
    expect(state.isPaused).to.be.true;

    // Verify deposits are blocked
    const setup = await setupApprovedKaminoForDispatcher(
      provider,
      authority,
      payer,
      usdcMint
    );
    const userTokenAccount = await fundUserForTest(setup.vaultMint, 1_000_000);
    const positionPda = userPositionPda(
      program.programId,
      authority.publicKey,
      setup.adapterProgram
    );

    // Allow Surfpool blockhash to advance after setup calls
    await sleep(3000);

    // Re-fetch to confirm dispatcher is still paused (setup may have taken many slots)
    state = await program.account.dispatcherState.fetch(dispatcherStatePda);
    expect(state.isPaused, "Dispatcher must be paused before deposit attempt").to.be.true;

    await sleep(2000);
    // Use raw transaction with skipPreflight to avoid simulation issues on Surfpool
    const dIx = await program.methods
      .deposit(new anchor.BN(500_000), new anchor.BN(0))
      .accounts({
        user: authority.publicKey,
        dispatcherState: dispatcherStatePda,
        userPosition: positionPda,
        registryProgram: registryProgram.programId,
        adapterEntry: setup.adapterEntryPda,
        adapterProgram: setup.adapterProgram,
        userTokenAccount,
        adapterVaultState: setup.vaultStatePda,
        adapterVault: setup.vaultTokenAccount,
        adapterVaultAuthority: setup.vaultAuthorityPda,
        adapterUserPosition: setup.adapterUserPositionPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    const dTx = new anchor.web3.Transaction().add(dIx);
    dTx.feePayer = authority.publicKey;
    const bh = await provider.connection.getLatestBlockhash();
    const dLastValidBlockHeight = bh.lastValidBlockHeight + 2000;
    dTx.recentBlockhash = bh.blockhash;
    dTx.lastValidBlockHeight = dLastValidBlockHeight;
    await provider.wallet.signTransaction(dTx);
    const dSig = await provider.connection.sendRawTransaction(dTx.serialize(), { skipPreflight: true });
    let dErr: any = null;
    try {
      const dCr = await provider.connection.confirmTransaction({ signature: dSig, blockhash: bh.blockhash, lastValidBlockHeight: dLastValidBlockHeight });
      dErr = dCr.value.err;
    } catch (e: unknown) {
      dErr = e;
    }
    if (!dErr) {
      expect.fail("Should have rejected deposit when paused");
    } else {
      const logs = (await provider.connection.getTransaction(dSig, { commitment: "confirmed" }))
        ?.meta?.logMessages?.join("\n") ?? "";
      expect(logs).to.satisfy((s: string) =>
        s.includes("Dispatcher is paused") || s.includes("is paused") || s.includes("paused") || s.includes("12100")
      );
    }

    // Wait for new slot before unpausing to avoid blockhash reuse
    await sleep(500);

    // Toggle pause OFF
    const pOffIx = await program.methods
      .togglePause()
      .accounts({
        authority: authority.publicKey,
        dispatcherState: dispatcherStatePda,
      })
      .instruction();
    const pOffTx = new anchor.web3.Transaction().add(pOffIx);
    pOffTx.feePayer = authority.publicKey;
    const pOffBh = await provider.connection.getLatestBlockhash();
    pOffTx.recentBlockhash = pOffBh.blockhash;
    pOffTx.lastValidBlockHeight = pOffBh.lastValidBlockHeight + 2000;
    await provider.wallet.signTransaction(pOffTx);
    const pOffSig = await provider.connection.sendRawTransaction(pOffTx.serialize(), { skipPreflight: true });
    await provider.connection.confirmTransaction(pOffSig);

    state = await program.account.dispatcherState.fetch(
      dispatcherStatePda
    );
    expect(state.isPaused).to.be.false;
  });

  it("deposits through the dispatcher via Kamino CPI", async () => {
    const setup = await setupApprovedKaminoForDispatcher(
      provider,
      authority,
      payer,
      usdcMint
    );

    const userTokenAccount = await fundUserForTest(setup.vaultMint, 1_000_000);

    const positionPda = userPositionPda(
      program.programId,
      authority.publicKey,
      setup.adapterProgram
    );

    // Use raw transaction to avoid duplicate tx errors on Surfpool
    await sleep(2000);
    const dIx = await program.methods
      .deposit(new anchor.BN(500_000), new anchor.BN(0))
      .accounts({
        user: authority.publicKey,
        dispatcherState: dispatcherStatePda,
        userPosition: positionPda,
        registryProgram: registryProgram.programId,
        adapterEntry: setup.adapterEntryPda,
        adapterProgram: setup.adapterProgram,
        userTokenAccount,
        adapterVaultState: setup.vaultStatePda,
        adapterVault: setup.vaultTokenAccount,
        adapterVaultAuthority: setup.vaultAuthorityPda,
        adapterUserPosition: setup.adapterUserPositionPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    const dTx = new anchor.web3.Transaction().add(dIx);
    dTx.feePayer = authority.publicKey;
    const dBh = await provider.connection.getLatestBlockhash();
    dTx.recentBlockhash = dBh.blockhash;
    dTx.lastValidBlockHeight = dBh.lastValidBlockHeight + 2000;
    await provider.wallet.signTransaction(dTx);
    const dSig = await provider.connection.sendRawTransaction(dTx.serialize(), { skipPreflight: true });
    const dCr = await provider.connection.confirmTransaction(dSig);
    if (dCr.value.err) throw new Error(`Deposit failed: ${JSON.stringify(dCr.value.err)}`);

    const position = await program.account.userPosition.fetch(positionPda);
    expect(position.depositedAmount.toNumber()).to.be.at.least(500_000);
    expect(position.receiptTokenBalance.toNumber()).to.be.greaterThan(0);

    const vaultBalance = await getTokenBalance(provider, setup.vaultTokenAccount);
    expect(vaultBalance).to.be.at.least(500_000);
  });

  it("withdraws through the dispatcher via Kamino CPI", async () => {
    const setup = await setupApprovedKaminoForDispatcher(
      provider,
      authority,
      payer,
      usdcMint
    );

    const userTokenAccount = await fundUserForTest(setup.vaultMint, 2_000_000);

    const positionPda = userPositionPda(
      program.programId,
      authority.publicKey,
      setup.adapterProgram
    );

    await sleep(2000);
    const dIx = await program.methods
      .deposit(new anchor.BN(1_000_000), new anchor.BN(0))
      .accounts({
        user: authority.publicKey,
        dispatcherState: dispatcherStatePda,
        userPosition: positionPda,
        registryProgram: registryProgram.programId,
        adapterEntry: setup.adapterEntryPda,
        adapterProgram: setup.adapterProgram,
        userTokenAccount,
        adapterVaultState: setup.vaultStatePda,
        adapterVault: setup.vaultTokenAccount,
        adapterVaultAuthority: setup.vaultAuthorityPda,
        adapterUserPosition: setup.adapterUserPositionPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    const dTx = new anchor.web3.Transaction().add(dIx);
    dTx.feePayer = authority.publicKey;
    const dBh = await provider.connection.getLatestBlockhash();
    dTx.recentBlockhash = dBh.blockhash;
    dTx.lastValidBlockHeight = dBh.lastValidBlockHeight;
    await provider.wallet.signTransaction(dTx);
    const dSig = await provider.connection.sendRawTransaction(dTx.serialize(), { skipPreflight: true });
    const dCr = await provider.connection.confirmTransaction(dSig);
    if (dCr.value.err) throw new Error(`Deposit failed: ${JSON.stringify(dCr.value.err)}`);

    const beforeWithdraw = (
      await program.account.userPosition.fetch(positionPda)
    ).receiptTokenBalance.toNumber();

    await sleep(2000);
    const wIx = await program.methods
      .withdraw(new anchor.BN(400_000), new anchor.BN(0))
      .accounts({
        user: authority.publicKey,
        dispatcherState: dispatcherStatePda,
        userPosition: positionPda,
        registryProgram: registryProgram.programId,
        adapterEntry: setup.adapterEntryPda,
        adapterProgram: setup.adapterProgram,
        userTokenAccount,
        adapterVaultState: setup.vaultStatePda,
        adapterVault: setup.vaultTokenAccount,
        adapterVaultAuthority: setup.vaultAuthorityPda,
        adapterUserPosition: setup.adapterUserPositionPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    const wTx = new anchor.web3.Transaction().add(wIx);
    wTx.feePayer = authority.publicKey;
    const wBh = await provider.connection.getLatestBlockhash();
    wTx.recentBlockhash = wBh.blockhash;
    wTx.lastValidBlockHeight = wBh.lastValidBlockHeight;
    await provider.wallet.signTransaction(wTx);
    const wSig = await provider.connection.sendRawTransaction(wTx.serialize(), { skipPreflight: true });
    const wCr = await provider.connection.confirmTransaction(wSig);
    if (wCr.value.err) throw new Error(`Withdraw failed: ${JSON.stringify(wCr.value.err)}`);

    const position = await program.account.userPosition.fetch(positionPda);
    expect(position.receiptTokenBalance.toNumber()).to.equal(
      beforeWithdraw - 400_000
    );

    const userBalance = await getTokenBalance(provider, userTokenAccount);
    expect(userBalance).to.be.greaterThan(0);
  });

  it("rejects unapproved adapters", async () => {
    const unapprovedAdapter = Keypair.generate();
    const [adapterEntryPda] = findPda(
      [Buffer.from("adapter_entry"), unapprovedAdapter.publicKey.toBuffer()],
      registryProgram.programId
    );

    const kaminoSetup = await setupApprovedKaminoForDispatcher(
      provider,
      authority,
      payer,
      usdcMint
    );

    const propIx = await registryProgram.methods
      .proposeAdapter("Fake", "https://example.com/fake.json", "test_vault_state", "vault_authority")
      .accounts({
        proposer: authority.publicKey,
        registryState: registryStatePda,
        adapterEntry: adapterEntryPda,
        adapterProgram: unapprovedAdapter.publicKey,
        underlyingMint: kaminoSetup.vaultMint,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    const propTx = new anchor.web3.Transaction().add(propIx);
    propTx.feePayer = authority.publicKey;
    const propBh = await provider.connection.getLatestBlockhash();
    propTx.recentBlockhash = propBh.blockhash;
    propTx.lastValidBlockHeight = propBh.lastValidBlockHeight + 2000;
    await provider.wallet.signTransaction(propTx);
    const propSig = await provider.connection.sendRawTransaction(propTx.serialize(), { skipPreflight: true });
    await provider.connection.confirmTransaction(propSig);

    const userTokenAccount = await fundUserForTest(kaminoSetup.vaultMint, 1_000_000);

    const positionPda = userPositionPda(
      program.programId,
      authority.publicKey,
      unapprovedAdapter.publicKey
    );

    let depositErr: any = null;
    let dSig: string | null = null;
    try {
      const dIx = await program.methods
        .deposit(new anchor.BN(500_000), new anchor.BN(0))
        .accounts({
          user: authority.publicKey,
          dispatcherState: dispatcherStatePda,
          userPosition: positionPda,
          registryProgram: registryProgram.programId,
          adapterEntry: adapterEntryPda,
          adapterProgram: unapprovedAdapter.publicKey,
          userTokenAccount,
          adapterVaultState: kaminoSetup.vaultStatePda,
          adapterVault: kaminoSetup.vaultTokenAccount,
          adapterVaultAuthority: kaminoSetup.vaultAuthorityPda,
          adapterUserPosition: kaminoSetup.adapterUserPositionPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
      const dTx = new anchor.web3.Transaction().add(dIx);
      dTx.feePayer = authority.publicKey;
      const bh = await provider.connection.getLatestBlockhash();
      dTx.recentBlockhash = bh.blockhash;
      dTx.lastValidBlockHeight = bh.lastValidBlockHeight + 2000;
      await provider.wallet.signTransaction(dTx);
      dSig = await provider.connection.sendRawTransaction(dTx.serialize(), { skipPreflight: true });
      const dCr = await provider.connection.confirmTransaction(dSig);
      depositErr = dCr.value.err;
    } catch (err: unknown) {
      depositErr = err;
    }
    if (depositErr === null) {
      expect.fail("Should have failed to deposit to unapproved adapter");
    }
    const logs = dSig
      ? (await provider.connection.getTransaction(dSig, { commitment: "confirmed" }))
        ?.meta?.logMessages?.join("\n") ?? ""
      : "";
    expect(logs).to.satisfy((s: string) =>
      s.includes("Adapter not registered") || s.includes("not approved") || s.includes("6101")
    );
  });

  it("rejects zero-amount deposits", async () => {
    const setup = await setupApprovedKaminoForDispatcher(
      provider,
      authority,
      payer,
      usdcMint
    );

    const userTokenAccount = await fundUserForTest(setup.vaultMint, 1_000_000);

    const positionPda = userPositionPda(
      program.programId,
      authority.publicKey,
      setup.adapterProgram
    );

    let zeroErr: any = null;
    let zeroSig: string | null = null;
    try {
      const zIx = await program.methods
        .deposit(new anchor.BN(0), new anchor.BN(0))
        .accounts({
          user: authority.publicKey,
          dispatcherState: dispatcherStatePda,
          userPosition: positionPda,
          registryProgram: registryProgram.programId,
          adapterEntry: setup.adapterEntryPda,
          adapterProgram: setup.adapterProgram,
          userTokenAccount,
          adapterVaultState: setup.vaultStatePda,
          adapterVault: setup.vaultTokenAccount,
          adapterVaultAuthority: setup.vaultAuthorityPda,
          adapterUserPosition: setup.adapterUserPositionPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
      const zTx = new anchor.web3.Transaction().add(zIx);
      zTx.feePayer = authority.publicKey;
      const zBh = await provider.connection.getLatestBlockhash();
      zTx.recentBlockhash = zBh.blockhash;
      zTx.lastValidBlockHeight = zBh.lastValidBlockHeight + 2000;
      await provider.wallet.signTransaction(zTx);
      zeroSig = await provider.connection.sendRawTransaction(zTx.serialize(), { skipPreflight: true });
      const zCr = await provider.connection.confirmTransaction(zeroSig);
      zeroErr = zCr.value.err;
    } catch (err: unknown) {
      zeroErr = err;
    }
    if (zeroErr === null) {
      expect.fail("Should have rejected zero deposit");
    }
    const zeroLogs = zeroSig
      ? (await provider.connection.getTransaction(zeroSig, { commitment: "confirmed" }))
        ?.meta?.logMessages?.join("\n") ?? ""
      : "";
    expect(zeroLogs + " " + JSON.stringify(zeroErr)).to.satisfy((s: string) =>
      s.includes("Amount must be greater than zero") || s.includes("ZeroAmount") || s.includes("6102")
    );
  });

  it("deposits through dispatcher via Marginfi", async () => {
    const marginfiProgram = anchor.workspace.AdapterMarginfi as Program;
    const setup = await setupApprovedAdapterForDispatcher(
      provider,
      authority,
      payer,
      usdcMint,
      marginfiProgram,
      "Marginfi USDC (reference)",
      "marginfi_vault_state",
      "marginfi_vault_authority"
    );

    const userTokenAccount = await fundUserForTest(setup.vaultMint, 1_000_000);

    const positionPda = userPositionPda(
      program.programId,
      authority.publicKey,
      setup.adapterProgram
    );

    await sleep(2000);
    const dIx = await program.methods
      .deposit(new anchor.BN(500_000), new anchor.BN(0))
      .accounts({
        user: authority.publicKey,
        dispatcherState: dispatcherStatePda,
        userPosition: positionPda,
        registryProgram: registryProgram.programId,
        adapterEntry: setup.adapterEntryPda,
        adapterProgram: setup.adapterProgram,
        userTokenAccount,
        adapterVaultState: setup.vaultStatePda,
        adapterVault: setup.vaultTokenAccount,
        adapterVaultAuthority: setup.vaultAuthorityPda,
        adapterUserPosition: setup.adapterUserPositionPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    const dTx = new anchor.web3.Transaction().add(dIx);
    dTx.feePayer = authority.publicKey;
    const dBh = await provider.connection.getLatestBlockhash();
    dTx.recentBlockhash = dBh.blockhash;
    dTx.lastValidBlockHeight = dBh.lastValidBlockHeight + 2000;
    await provider.wallet.signTransaction(dTx);
    const dSig = await provider.connection.sendRawTransaction(dTx.serialize(), { skipPreflight: true });
    const dCr = await provider.connection.confirmTransaction(dSig);
    if (dCr.value.err) throw new Error(`Deposit failed: ${JSON.stringify(dCr.value.err)}`);

    const position = await program.account.userPosition.fetch(positionPda);
    expect(position.depositedAmount.toNumber()).to.be.at.least(500_000);
    expect(position.receiptTokenBalance.toNumber()).to.be.greaterThan(0);
  });

  it("withdraws through dispatcher via Marginfi", async () => {
    const marginfiProgram = anchor.workspace.AdapterMarginfi as Program;
    const setup = await setupApprovedAdapterForDispatcher(
      provider,
      authority,
      payer,
      usdcMint,
      marginfiProgram,
      "Marginfi USDC (reference)",
      "marginfi_vault_state",
      "marginfi_vault_authority"
    );

    const userTokenAccount = await fundUserForTest(setup.vaultMint, 2_000_000);

    const positionPda = userPositionPda(
      program.programId,
      authority.publicKey,
      setup.adapterProgram
    );

    await sleep(2000);
    const dIx = await program.methods
      .deposit(new anchor.BN(1_000_000), new anchor.BN(0))
      .accounts({
        user: authority.publicKey,
        dispatcherState: dispatcherStatePda,
        userPosition: positionPda,
        registryProgram: registryProgram.programId,
        adapterEntry: setup.adapterEntryPda,
        adapterProgram: setup.adapterProgram,
        userTokenAccount,
        adapterVaultState: setup.vaultStatePda,
        adapterVault: setup.vaultTokenAccount,
        adapterVaultAuthority: setup.vaultAuthorityPda,
        adapterUserPosition: setup.adapterUserPositionPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    const dTx = new anchor.web3.Transaction().add(dIx);
    dTx.feePayer = authority.publicKey;
    const dBh = await provider.connection.getLatestBlockhash();
    dTx.recentBlockhash = dBh.blockhash;
    dTx.lastValidBlockHeight = dBh.lastValidBlockHeight;
    await provider.wallet.signTransaction(dTx);
    const dSig = await provider.connection.sendRawTransaction(dTx.serialize(), { skipPreflight: true });
    const dCr = await provider.connection.confirmTransaction(dSig);
    if (dCr.value.err) throw new Error(`Deposit failed: ${JSON.stringify(dCr.value.err)}`);

    const beforeWithdraw = (
      await program.account.userPosition.fetch(positionPda)
    ).receiptTokenBalance.toNumber();

    await sleep(2000);
    const wIx = await program.methods
      .withdraw(new anchor.BN(400_000), new anchor.BN(0))
      .accounts({
        user: authority.publicKey,
        dispatcherState: dispatcherStatePda,
        userPosition: positionPda,
        registryProgram: registryProgram.programId,
        adapterEntry: setup.adapterEntryPda,
        adapterProgram: setup.adapterProgram,
        userTokenAccount,
        adapterVaultState: setup.vaultStatePda,
        adapterVault: setup.vaultTokenAccount,
        adapterVaultAuthority: setup.vaultAuthorityPda,
        adapterUserPosition: setup.adapterUserPositionPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    const wTx = new anchor.web3.Transaction().add(wIx);
    wTx.feePayer = authority.publicKey;
    const wBh = await provider.connection.getLatestBlockhash();
    wTx.recentBlockhash = wBh.blockhash;
    wTx.lastValidBlockHeight = wBh.lastValidBlockHeight;
    await provider.wallet.signTransaction(wTx);
    const wSig = await provider.connection.sendRawTransaction(wTx.serialize(), { skipPreflight: true });
    const wCr = await provider.connection.confirmTransaction(wSig);
    if (wCr.value.err) throw new Error(`Withdraw failed: ${JSON.stringify(wCr.value.err)}`);

    const position = await program.account.userPosition.fetch(positionPda);
    expect(position.receiptTokenBalance.toNumber()).to.equal(
      beforeWithdraw - 400_000
    );

    const userBalance = await getTokenBalance(provider, userTokenAccount);
    expect(userBalance).to.be.greaterThan(0);
  });

  it("current_value through dispatcher", async () => {
    const marginfiProgram = anchor.workspace.AdapterMarginfi as Program;
    const setup = await setupApprovedAdapterForDispatcher(
      provider,
      authority,
      payer,
      usdcMint,
      marginfiProgram,
      "Marginfi USDC (reference)",
      "marginfi_vault_state",
      "marginfi_vault_authority"
    );

    const userTokenAccount = await fundUserForTest(setup.vaultMint, 1_000_000);

    const positionPda = userPositionPda(
      program.programId,
      authority.publicKey,
      setup.adapterProgram
    );

    // Deposit first
    await program.methods
      .deposit(new anchor.BN(500_000), new anchor.BN(0))
      .accounts({
        user: authority.publicKey,
        dispatcherState: dispatcherStatePda,
        userPosition: positionPda,
        registryProgram: registryProgram.programId,
        adapterEntry: setup.adapterEntryPda,
        adapterProgram: setup.adapterProgram,
        userTokenAccount,
        adapterVaultState: setup.vaultStatePda,
        adapterVault: setup.vaultTokenAccount,
        adapterVaultAuthority: setup.vaultAuthorityPda,
        adapterUserPosition: setup.adapterUserPositionPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Query current_value through the dispatcher
    await program.methods
      .currentValue()
      .accounts({
        user: authority.publicKey,
        dispatcherState: dispatcherStatePda,
        userPosition: positionPda,
        registryProgram: registryProgram.programId,
        adapterEntry: setup.adapterEntryPda,
        adapterProgram: setup.adapterProgram,
        adapterVaultState: setup.vaultStatePda,
        adapterUserPosition: setup.adapterUserPositionPda,
      })
      .rpc();

    const position = await program.account.userPosition.fetch(positionPda);
    expect(position.depositedAmount.toNumber()).to.be.greaterThan(0);
    expect(position.receiptTokenBalance.toNumber()).to.be.greaterThan(0);

    // current_value emitted an event — we verified it by the RPC not failing
    const vaultBalance = await getTokenBalance(provider, setup.vaultTokenAccount);
    expect(vaultBalance).to.be.greaterThan(0);
  });

  it("deposits through dispatcher via Jupiter", async () => {
    const jupiterProgram = anchor.workspace.AdapterJupiter as Program;
    const setup = await setupApprovedAdapterForDispatcher(
      provider,
      authority,
      payer,
      usdcMint,
      jupiterProgram,
      "Jupiter LP (reference)",
      "jupiter_vault_state",
      "jupiter_vault_authority"
    );

    const userTokenAccount = await fundUserForTest(setup.vaultMint, 1_000_000);

    const positionPda = userPositionPda(
      program.programId,
      authority.publicKey,
      setup.adapterProgram
    );

    // Allow Surfpool JIT-fetch to catch up
    await sleep(500);

    await program.methods
      .deposit(new anchor.BN(500_000), new anchor.BN(0))
      .accounts({
        user: authority.publicKey,
        dispatcherState: dispatcherStatePda,
        userPosition: positionPda,
        registryProgram: registryProgram.programId,
        adapterEntry: setup.adapterEntryPda,
        adapterProgram: setup.adapterProgram,
        userTokenAccount,
        adapterVaultState: setup.vaultStatePda,
        adapterVault: setup.vaultTokenAccount,
        adapterVaultAuthority: setup.vaultAuthorityPda,
        adapterUserPosition: setup.adapterUserPositionPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const position = await program.account.userPosition.fetch(positionPda);
    expect(position.depositedAmount.toNumber()).to.be.at.least(500_000);
    expect(position.receiptTokenBalance.toNumber()).to.be.greaterThan(0);
  });

  it("simultaneous deposits to Kamino + Jupiter via dispatcher", async () => {
    // Set up both Kamino and Jupiter adapters
    const kaminoSetup = await setupApprovedKaminoForDispatcher(
      provider,
      authority,
      payer,
      usdcMint
    );
    const jupiterProgram = anchor.workspace.AdapterJupiter as Program;
    const jupiterSetup = await setupApprovedAdapterForDispatcher(
      provider,
      authority,
      payer,
      usdcMint,
      jupiterProgram,
      "Jupiter LP (reference)",
      "jupiter_vault_state",
      "jupiter_vault_authority"
    );

    // Fund separate token accounts for each adapter (they may use different mints)
    const kaminoTokenAccount = await fundUserForTest(kaminoSetup.vaultMint, 1_000_000);
    const jupiterTokenAccount = await fundUserForTest(jupiterSetup.vaultMint, 1_000_000);

    // Deposit to Kamino
    const kaminoPositionPda = userPositionPda(
      program.programId,
      authority.publicKey,
      kaminoSetup.adapterProgram
    );

    const kIx = await program.methods
      .deposit(new anchor.BN(500_000), new anchor.BN(0))
      .accounts({
        user: authority.publicKey,
        dispatcherState: dispatcherStatePda,
        userPosition: kaminoPositionPda,
        registryProgram: registryProgram.programId,
        adapterEntry: kaminoSetup.adapterEntryPda,
        adapterProgram: kaminoSetup.adapterProgram,
        userTokenAccount: kaminoTokenAccount,
        adapterVaultState: kaminoSetup.vaultStatePda,
        adapterVault: kaminoSetup.vaultTokenAccount,
        adapterVaultAuthority: kaminoSetup.vaultAuthorityPda,
        adapterUserPosition: kaminoSetup.adapterUserPositionPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    const kTx = new anchor.web3.Transaction().add(kIx);
    kTx.feePayer = authority.publicKey;
    const kBh = await provider.connection.getLatestBlockhash();
    kTx.recentBlockhash = kBh.blockhash;
    kTx.lastValidBlockHeight = kBh.lastValidBlockHeight + 2000;
    await provider.wallet.signTransaction(kTx);
    const kSig = await provider.connection.sendRawTransaction(kTx.serialize(), { skipPreflight: true });
    await provider.connection.confirmTransaction(kSig);

    // Deposit to Jupiter (same user, different adapter)
    const jupiterPositionPda = userPositionPda(
      program.programId,
      authority.publicKey,
      jupiterSetup.adapterProgram
    );

    // Allow Surfpool JIT-fetch to catch up
    await sleep(500);

    const jIx = await program.methods
      .deposit(new anchor.BN(500_000), new anchor.BN(0))
      .accounts({
        user: authority.publicKey,
        dispatcherState: dispatcherStatePda,
        userPosition: jupiterPositionPda,
        registryProgram: registryProgram.programId,
        adapterEntry: jupiterSetup.adapterEntryPda,
        adapterProgram: jupiterSetup.adapterProgram,
        userTokenAccount: jupiterTokenAccount,
        adapterVaultState: jupiterSetup.vaultStatePda,
        adapterVault: jupiterSetup.vaultTokenAccount,
        adapterVaultAuthority: jupiterSetup.vaultAuthorityPda,
        adapterUserPosition: jupiterSetup.adapterUserPositionPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    const jTx = new anchor.web3.Transaction().add(jIx);
    jTx.feePayer = authority.publicKey;
    const jBh = await provider.connection.getLatestBlockhash();
    jTx.recentBlockhash = jBh.blockhash;
    jTx.lastValidBlockHeight = jBh.lastValidBlockHeight + 2000;
    await provider.wallet.signTransaction(jTx);
    const jSig = await provider.connection.sendRawTransaction(jTx.serialize(), { skipPreflight: true });
    await provider.connection.confirmTransaction(jSig);

    // Verify Kamino position
    const kaminoPos = await program.account.userPosition.fetch(kaminoPositionPda);
    expect(kaminoPos.depositedAmount.toNumber()).to.be.at.least(500_000);
    expect(kaminoPos.receiptTokenBalance.toNumber()).to.be.greaterThan(0);

    // Verify Jupiter position
    const jupiterPos = await program.account.userPosition.fetch(jupiterPositionPda);
    expect(jupiterPos.depositedAmount.toNumber()).to.be.at.least(500_000);
    expect(jupiterPos.receiptTokenBalance.toNumber()).to.be.greaterThan(0);

    // Positions should be independent — different PDAs, different adapter programs
    expect(kaminoPositionPda.toString()).to.not.equal(jupiterPositionPda.toString());
    expect(kaminoSetup.adapterProgram.toString()).to.not.equal(
      jupiterSetup.adapterProgram.toString()
    );

    // Dispatcher total deposits should reflect both
    const dispatcherState = await program.account.dispatcherState.fetch(
      dispatcherStatePda
    );
    expect(dispatcherState.totalDeposits.toNumber()).to.be.at.least(2);
  });
});
