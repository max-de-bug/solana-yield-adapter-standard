import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import {
  getAssociatedTokenAddressSync,
  transfer,
  getOrCreateAssociatedTokenAccount,
  getAccount,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { expect } from "chai";

import {
  adapterUserPositionPda,
  createTestMint,
  createTestTokenAccount,
  findPda,
  getTokenBalance,
  mintTestTokens,
} from "./index";
import {
  isMainnetFork,
  KAMINO_PROGRAM_ID,
  MARGINFI_PROGRAM_ID,
  DRIFT_PROGRAM_ID,
  JUPITER_PERPS_PROGRAM_ID,
  MAINNET_USDC_MINT,
  SYRUP_USDC_MINT,
  TOKEN_PROGRAM_ID as TOKEN_PROGRAM,
} from "./constants";
import * as fs from "fs";
import * as path from "path";

export interface AdapterTestContext {
  program: Program;
  vaultStatePda: PublicKey;
  vaultAuthorityPda: PublicKey;
  vaultTokenAccount: PublicKey;
  underlyingMint: PublicKey;
  vaultStateSeed: string;
  vaultAuthoritySeed: string;
}

export interface AdapterFlowOptions {
  program: Program;
  vaultStateSeed: string;
  vaultAuthoritySeed: string;
  depositAmount?: number;
  withdrawShares?: number;
  underlyingMint?: PublicKey;
}

/** Mainnet protocol program id for fork routing tests. */
function protocolProgramForAdapter(programId: PublicKey): PublicKey | null {
  const id = programId.toBase58();
  const kamino = anchor.workspace.AdapterKamino?.programId?.toBase58();
  const marginfi = anchor.workspace.AdapterMarginfi?.programId?.toBase58();
  const jupiter = anchor.workspace.AdapterJupiter?.programId?.toBase58();
  const drift = anchor.workspace.AdapterDrift?.programId?.toBase58();
  if (kamino && id === kamino) return KAMINO_PROGRAM_ID;
  if (marginfi && id === marginfi) return MARGINFI_PROGRAM_ID;
  if (jupiter && id === jupiter) return JUPITER_PERPS_PROGRAM_ID;
  if (drift && id === drift) return DRIFT_PROGRAM_ID;
  return null;
}

/**
 * Resolves the underlying mint: mainnet USDC on fork, test mint on localnet.
 */
export async function resolveUnderlyingMint(
  provider: anchor.AnchorProvider,
  payer: Keypair
): Promise<PublicKey> {
  if (isMainnetFork()) {
    return MAINNET_USDC_MINT;
  }
  return createTestMint(provider, payer, 6);
}

/** Fund a user token ATA on fork.
 *  Returns the user ATA address and the mint used (surfpool path creates a local test mint). */
export async function fundUserUsdcOnFork(
  provider: anchor.AnchorProvider,
  payer: Keypair,
  user: PublicKey,
  amount: number
): Promise<{ userAta: PublicKey; mint: PublicKey }> {
  const fixtureWalletPath = path.join(
    __dirname,
    "../fixtures/fork-wallet.json"
  );

  if (fs.existsSync(fixtureWalletPath)) {
    const fixtureSecret = Uint8Array.from(
      JSON.parse(fs.readFileSync(fixtureWalletPath, "utf8"))
    );
    const fixtureWallet = Keypair.fromSecretKey(fixtureSecret);

    const airdropSig = await provider.connection.requestAirdrop(
      fixtureWallet.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    const latest = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction({
      signature: airdropSig,
      ...latest,
    });

    const fixtureAta = getAssociatedTokenAddressSync(
      MAINNET_USDC_MINT,
      fixtureWallet.publicKey
    );

    const fixtureInfo = await provider.connection.getAccountInfo(fixtureAta);
    if (fixtureInfo) {
      const userAta = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        MAINNET_USDC_MINT,
        user,
        false,
        undefined,
        undefined,
        TOKEN_PROGRAM
      );

      await getAccount(provider.connection, fixtureAta, undefined, TOKEN_PROGRAM);
      await getAccount(provider.connection, userAta.address, undefined, TOKEN_PROGRAM);

      await transfer(
        provider.connection,
        payer,
        fixtureAta,
        userAta.address,
        fixtureWallet,
        amount,
        [],
        undefined,
        TOKEN_PROGRAM
      );

      return { userAta: userAta.address, mint: MAINNET_USDC_MINT };
    }
  }

  // Surfpool path or missing fixture ATA: create a test mint and mint tokens
  const mint = await createTestMint(provider, payer, 6);
  const userAta = await createTestTokenAccount(provider, mint, user, payer);
  await mintTestTokens(provider, mint, userAta, payer, amount);
  return { userAta, mint };
}

/** Fund a user token ATA from a fork fixture for any mint.
 *  Falls back to creating a local mint when no fixture exists (Surfpool path). */
async function fundUserTokenOnFork(
  provider: anchor.AnchorProvider,
  payer: Keypair,
  user: PublicKey,
  mint: PublicKey,
  fixtureFileName: string,
  setupScriptName: string,
  amount: number
): Promise<{ userAta: PublicKey; mint: PublicKey }> {
  const fixtureWalletPath = path.join(
    __dirname,
    "../fixtures/fork-wallet.json"
  );

  if (fs.existsSync(fixtureWalletPath)) {
    const fixtureSecret = Uint8Array.from(
      JSON.parse(fs.readFileSync(fixtureWalletPath, "utf8"))
    );
    const fixtureWallet = Keypair.fromSecretKey(fixtureSecret);

    const airdropSig = await provider.connection.requestAirdrop(
      fixtureWallet.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    const latest = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction({
      signature: airdropSig,
      ...latest,
    });

    const fixtureAta = getAssociatedTokenAddressSync(
      mint,
      fixtureWallet.publicKey
    );

    const fixtureInfo = await provider.connection.getAccountInfo(fixtureAta);
    if (fixtureInfo) {
      const userAta = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        mint,
        user,
        false,
        undefined,
        undefined,
        TOKEN_PROGRAM
      );

      await getAccount(provider.connection, fixtureAta, undefined, TOKEN_PROGRAM);
      await getAccount(provider.connection, userAta.address, undefined, TOKEN_PROGRAM);

      await transfer(
        provider.connection,
        payer,
        fixtureAta,
        userAta.address,
        fixtureWallet,
        amount,
        [],
        undefined,
        TOKEN_PROGRAM
      );

      return { userAta: userAta.address, mint };
    }
  }

  // Surfpool path or missing fixture ATA: create a local mint and mint tokens
  const localMint = await createTestMint(provider, payer, 6);
  const userAta = await createTestTokenAccount(provider, localMint, user, payer);
  await mintTestTokens(provider, localMint, userAta, payer, amount);
  return { userAta, mint: localMint };
}

/** Fund a user syrupUSDC ATA from the fork fixture (mainnet-fork only). */
export async function fundUserSyrupUsdcOnFork(
  provider: anchor.AnchorProvider,
  payer: Keypair,
  user: PublicKey,
  amount: number
): Promise<{ userAta: PublicKey; mint: PublicKey }> {
  return fundUserTokenOnFork(
    provider, payer, user,
    SYRUP_USDC_MINT,
    "fork-syrup-usdc-ata.json",
    "setup-fork-syrup-usdc-fixture.sh",
    amount
  );
}

/** Assert a mainnet protocol program is present on the forked validator. */
export async function assertProtocolProgramLoaded(
  connection: anchor.web3.Connection,
  programId: PublicKey,
  label: string
): Promise<void> {
  const info = await connection.getAccountInfo(programId);
  expect(info, `${label} program should exist on fork`).to.not.be.null;
  expect(info!.executable, `${label} should be executable`).to.be.true;
}

/** Initialize adapter vault state PDA. */
/** Initialize a vault state account. Silently succeeds if already deployed. */
export async function initializeAdapterVault(
  program: Program,
  authority: anchor.Wallet,
  vaultStatePda: PublicKey,
  underlyingMint: PublicKey
): Promise<PublicKey> {
  try {
    await program.methods
      .initialize(underlyingMint)
      .accounts({
        authority: authority.publicKey,
        vaultState: vaultStatePda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  } catch (e: unknown) {
    const msg = String(e);
    if (!msg.includes("already in use") && !msg.includes("0x0")) {
      throw e;
    }
  }
  return underlyingMint;
}

/** Create vault token ATA owned by vault authority PDA. */
export async function createVaultTokenAccount(
  provider: anchor.AnchorProvider,
  payer: Keypair,
  underlyingMint: PublicKey,
  vaultAuthorityPda: PublicKey
): Promise<PublicKey> {
  const account = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    underlyingMint,
    vaultAuthorityPda,
    true
  );
  return account.address;
}

/**
 * Full deposit → current_value → withdraw lifecycle for a share-based adapter.
 */
export async function runAdapterDepositWithdrawFlow(
  provider: anchor.AnchorProvider,
  authority: anchor.Wallet,
  payer: Keypair,
  options: AdapterFlowOptions
): Promise<void> {
  const {
    program,
    vaultStateSeed,
    vaultAuthoritySeed,
    depositAmount = 1_000_000,
    withdrawShares = 500_000,
    underlyingMint: explicitMint,
  } = options;

  const [vaultStatePda] = findPda(
    [Buffer.from(vaultStateSeed)],
    program.programId
  );
  const [vaultAuthorityPda] = findPda(
    [Buffer.from(vaultAuthoritySeed)],
    program.programId
  );

  // Determine what mint the vault should use
  const proposedMint: PublicKey = explicitMint ?? (isMainnetFork()
    ? MAINNET_USDC_MINT
    : await resolveUnderlyingMint(provider, payer)
  );

  // Initialize vault (first-call wins; returns effective underlying mint if already deployed)
  let underlyingMint = await initializeAdapterVault(program, authority, vaultStatePda, proposedMint);

  const vaultTokenAccount = await createVaultTokenAccount(
    provider,
    payer,
    underlyingMint,
    vaultAuthorityPda
  );

  // Fund user ATA for the vault's underlying mint
  let userTokenAccount: PublicKey = await createTestTokenAccount(provider, underlyingMint, authority.publicKey, payer);

  if (isMainnetFork()) {
    // Try to fund from fixture wallet first (works for MAINNET_USDC_MINT on fork)
    let funded = false;
    const fixtureWalletPath = path.join(__dirname, "../fixtures/fork-wallet.json");
    if (fs.existsSync(fixtureWalletPath)) {
      const fixtureSecret = Uint8Array.from(JSON.parse(fs.readFileSync(fixtureWalletPath, "utf8")));
      const fixtureWallet = Keypair.fromSecretKey(fixtureSecret);
      const fixtureAta = getAssociatedTokenAddressSync(underlyingMint, fixtureWallet.publicKey);
      const fixtureInfo = await provider.connection.getAccountInfo(fixtureAta);
      if (fixtureInfo) {
        const sig = await provider.connection.requestAirdrop(fixtureWallet.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
        const bh = await provider.connection.getLatestBlockhash();
        await provider.connection.confirmTransaction({ signature: sig, ...bh });
        const ata = await getOrCreateAssociatedTokenAccount(provider.connection, payer, underlyingMint, authority.publicKey);
        await transfer(provider.connection, payer, fixtureAta, ata.address, fixtureWallet, depositAmount * 2);
        userTokenAccount = ata.address;
        funded = true;
      }
    }
    if (!funded) {
      try {
        await mintTestTokens(provider, underlyingMint, userTokenAccount, payer, depositAmount * 2);
      } catch {
        // Don't own mint authority (e.g. real USDC mint) — user has 0 balance
      }
    }
  } else {
    userTokenAccount = await createTestTokenAccount(provider, underlyingMint, authority.publicKey, payer);
    await mintTestTokens(provider, underlyingMint, userTokenAccount, payer, depositAmount * 2);
  }

  const [userPositionPda] = adapterUserPositionPda(
    program.programId,
    authority.publicKey
  );

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
    const protocolId = protocolProgramForAdapter(program.programId);
    if (protocolId) {
      depositBuilder.remainingAccounts([
        { pubkey: protocolId, isSigner: false, isWritable: false },
      ]);
    }
  }

  await depositBuilder.rpc();

  const vaultBalanceAfterDeposit = await getTokenBalance(
    provider,
    vaultTokenAccount
  );
  expect(vaultBalanceAfterDeposit).to.equal(depositAmount);

  const currentValueBuilder = program.methods.currentValue().accounts({
    user: authority.publicKey,
    vaultState: vaultStatePda,
    userPosition: userPositionPda,
  });
  if (isMainnetFork()) {
    const protocolId = protocolProgramForAdapter(program.programId);
    if (protocolId) {
      currentValueBuilder.remainingAccounts([
        { pubkey: protocolId, isSigner: false, isWritable: false },
      ]);
    }
  }
  await currentValueBuilder.rpc();

  await program.methods
    .withdraw(new anchor.BN(withdrawShares), new anchor.BN(0))
    .accounts({
      user: authority.publicKey,
      vaultState: vaultStatePda,
      userPosition: userPositionPda,
      userTokenAccount,
      vaultTokenAccount,
      vaultAuthority: vaultAuthorityPda,
      tokenProgram: TOKEN_PROGRAM,
    })
    .rpc();

  const userBalance = await getTokenBalance(provider, userTokenAccount);
  expect(userBalance).to.be.greaterThan(0);

  const vaultBalanceAfterWithdraw = await getTokenBalance(
    provider,
    vaultTokenAccount
  );
  expect(vaultBalanceAfterWithdraw).to.be.lessThan(depositAmount);
}

/**
 * Shared slippage protection tests — can be called from any adapter test file.
 * Exercises both deposit and withdraw slippage rejection paths.
 */
export function addSlippageTests(opts: {
  program: Program;
  vaultStateSeed: string;
  vaultAuthoritySeed: string;
  underlyingMint?: PublicKey;
}): void {
  const { program, vaultStateSeed, vaultAuthoritySeed } = opts;
  const provider = anchor.AnchorProvider.env();
  const authority = provider.wallet as anchor.Wallet;
  const payer = (provider.wallet as anchor.Wallet).payer as Keypair;

  it("rejects deposit with excessive min_shares_out (slippage)", async () => {
    const depositAmount = 1_000_000;

    const [vaultStatePda] = findPda([Buffer.from(vaultStateSeed)], program.programId);
    const [vaultAuthorityPda] = findPda([Buffer.from(vaultAuthoritySeed)], program.programId);

    let underlyingMint: PublicKey;
    let userTokenAccount: PublicKey;

    if (isMainnetFork()) {
      const funded = await fundUserUsdcOnFork(provider, payer, authority.publicKey, depositAmount * 2);
      userTokenAccount = funded.userAta;
      underlyingMint = funded.mint;
    } else {
      underlyingMint = opts.underlyingMint ?? await resolveUnderlyingMint(provider, payer);
      userTokenAccount = await createTestTokenAccount(provider, underlyingMint, authority.publicKey, payer);
      await mintTestTokens(provider, underlyingMint, userTokenAccount, payer, depositAmount * 2);
    }

    await initializeAdapterVault(program, authority, vaultStatePda, underlyingMint);
    const vaultTokenAccount = await createVaultTokenAccount(provider, payer, underlyingMint, vaultAuthorityPda);

    const [userPositionPda] = adapterUserPositionPda(program.programId, authority.publicKey);

    try {
      await program.methods
        .deposit(new anchor.BN(depositAmount), new anchor.BN(depositAmount * 2))
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
      expect.fail("Should have rejected deposit with excessive min_shares_out");
    } catch (err: unknown) {
      expect(String(err)).to.contain("SlippageExceeded");
    }
  });

  it("rejects withdraw with excessive min_underlying_out (slippage)", async () => {
    const depositAmount = 1_000_000;

    const [vaultStatePda] = findPda([Buffer.from(vaultStateSeed)], program.programId);
    const [vaultAuthorityPda] = findPda([Buffer.from(vaultAuthoritySeed)], program.programId);

    let underlyingMint: PublicKey;
    let userTokenAccount: PublicKey;

    if (isMainnetFork()) {
      const funded = await fundUserUsdcOnFork(provider, payer, authority.publicKey, depositAmount * 2);
      userTokenAccount = funded.userAta;
      underlyingMint = funded.mint;
    } else {
      underlyingMint = opts.underlyingMint ?? await resolveUnderlyingMint(provider, payer);
      userTokenAccount = await createTestTokenAccount(provider, underlyingMint, authority.publicKey, payer);
      await mintTestTokens(provider, underlyingMint, userTokenAccount, payer, depositAmount * 2);
    }

    await initializeAdapterVault(program, authority, vaultStatePda, underlyingMint);
    const vaultTokenAccount = await createVaultTokenAccount(provider, payer, underlyingMint, vaultAuthorityPda);

    const [userPositionPda] = adapterUserPositionPda(program.programId, authority.publicKey);

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

    try {
      await program.methods
        .withdraw(new anchor.BN(depositAmount / 2), new anchor.BN(depositAmount))
        .accounts({
          user: authority.publicKey,
          vaultState: vaultStatePda,
          userPosition: userPositionPda,
          userTokenAccount,
          vaultTokenAccount,
          vaultAuthority: vaultAuthorityPda,
          tokenProgram: TOKEN_PROGRAM,
        })
        .rpc();
      expect.fail("Should have rejected withdraw with excessive min_underlying_out");
    } catch (err: unknown) {
      expect(String(err)).to.contain("SlippageExceeded");
    }
  });
}
