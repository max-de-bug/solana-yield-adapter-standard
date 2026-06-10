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
} from "./helpers";
import {
  fundUserUsdcOnFork,
  resolveUnderlyingMint,
} from "./helpers/adapter";
import { isMainnetFork, MAINNET_USDC_MINT } from "./helpers/constants";
import {
  ensureRegistryInitialized,
  resolveKaminoVaultMint,
  setupApprovedKaminoForDispatcher,
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
      return fundUserUsdcOnFork(
        provider,
        payer,
        authority.publicKey,
        amount * 2
      );
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

  it("deposits through the dispatcher via Kamino CPI", async () => {
    const setup = await setupApprovedKaminoForDispatcher(
      provider,
      authority,
      payer,
      usdcMint
    );
    const vaultMint = await resolveKaminoVaultMint(kaminoProgram, usdcMint);

    const userTokenAccount = await fundUserForTest(vaultMint, 1_000_000);

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
    expect(position.depositedAmount.toNumber()).to.equal(500_000);
    expect(position.receiptTokenBalance.toNumber()).to.be.greaterThan(0);

    const vaultBalance = await getTokenBalance(provider, setup.vaultTokenAccount);
    expect(vaultBalance).to.be.greaterThan(500_000);
  });

  it("withdraws through the dispatcher via Kamino CPI", async () => {
    const setup = await setupApprovedKaminoForDispatcher(
      provider,
      authority,
      payer,
      usdcMint
    );
    const vaultMint = await resolveKaminoVaultMint(kaminoProgram, usdcMint);

    const userTokenAccount = await fundUserForTest(vaultMint, 2_000_000);

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

    const vaultMint = await resolveKaminoVaultMint(kaminoProgram, usdcMint);

    await registryProgram.methods
      .proposeAdapter("Fake", "https://example.com/fake.json")
      .accounts({
        proposer: authority.publicKey,
        registryState: registryStatePda,
        adapterEntry: adapterEntryPda,
        adapterProgram: unapprovedAdapter.publicKey,
        underlyingMint: vaultMint,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const kaminoSetup = await setupApprovedKaminoForDispatcher(
      provider,
      authority,
      payer,
      usdcMint
    );

    const userTokenAccount = await fundUserForTest(vaultMint, 1_000_000);

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

    const vaultMint = await resolveKaminoVaultMint(kaminoProgram, usdcMint);
    const userTokenAccount = await fundUserForTest(vaultMint, 1_000_000);

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
});
