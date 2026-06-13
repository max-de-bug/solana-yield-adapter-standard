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
} from "./helpers/adapter";
import { isMainnetFork, MAINNET_USDC_MINT } from "./helpers/constants";
import {
  ensureRegistryInitialized,
  setupApprovedKaminoForDispatcher,
  setupApprovedAdapterForDispatcher,
  userPositionPda,
} from "./helpers/dispatcher";

describe("yield-dispatcher", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.YieldDispatcher as Program;
  const registryProgram = anchor.workspace.AdapterRegistry as Program;
  const kaminoProgram = anchor.workspace.AdapterKamino as Program;
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

  before(async () => {
    [dispatcherStatePda] = findPda(
      [Buffer.from("dispatcher_state")],
      program.programId
    );

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
        await program.methods
          .togglePause()
          .accounts({ authority: authority.publicKey, dispatcherState: dispatcherStatePda })
          .rpc();
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
    await program.methods
      .togglePause()
      .accounts({
        authority: authority.publicKey,
        dispatcherState: dispatcherStatePda,
      })
      .rpc();

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

    try {
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
      expect.fail("Should have rejected deposit when paused");
    } catch (err: unknown) {
      expect(String(err)).to.contain("Dispatcher is paused");
    }

    // Wait for new slot before unpausing to avoid blockhash reuse
    await sleep(500);

    // Toggle pause OFF
    await program.methods
      .togglePause()
      .accounts({
        authority: authority.publicKey,
        dispatcherState: dispatcherStatePda,
      })
      .rpc();

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

    await program.methods
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
      .rpc();

    const beforeWithdraw = (
      await program.account.userPosition.fetch(positionPda)
    ).receiptTokenBalance.toNumber();

    await program.methods
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
      .rpc();

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

    await registryProgram.methods
      .proposeAdapter("Fake", "https://example.com/fake.json", "test_vault_state", "vault_authority")
      .accounts({
        proposer: authority.publicKey,
        registryState: registryStatePda,
        adapterEntry: adapterEntryPda,
        adapterProgram: unapprovedAdapter.publicKey,
        underlyingMint: kaminoSetup.vaultMint,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const userTokenAccount = await fundUserForTest(kaminoSetup.vaultMint, 1_000_000);

    const positionPda = userPositionPda(
      program.programId,
      authority.publicKey,
      unapprovedAdapter.publicKey
    );

    try {
      await program.methods
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
        .rpc();

      expect.fail("Should have failed to deposit to unapproved adapter");
    } catch (err: unknown) {
      expect(String(err)).to.contain(
        "Adapter not registered or not approved"
      );
    }
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

    try {
      await program.methods
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
        .rpc();

      expect.fail("Should have rejected zero deposit");
    } catch (err: unknown) {
      expect(String(err)).to.contain("Amount must be greater than zero");
    }
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

    await program.methods
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
      .rpc();

    const beforeWithdraw = (
      await program.account.userPosition.fetch(positionPda)
    ).receiptTokenBalance.toNumber();

    await program.methods
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
      .rpc();

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

    await program.methods
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
      .rpc();

    // Deposit to Jupiter (same user, different adapter)
    const jupiterPositionPda = userPositionPda(
      program.programId,
      authority.publicKey,
      jupiterSetup.adapterProgram
    );

    // Allow Surfpool JIT-fetch to catch up
    await sleep(500);

    await program.methods
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
      .rpc();

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
