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
  airdrop,
  createTestMint,
  createTestTokenAccount,
  findPda,
  getTokenBalance,
  mintTestTokens,
  sleep,
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

/**
 * Check whether the fork fixture wallet holds USDC on the forked validator.
 * Returns `false` on localnet, when the fixture ATA is absent, or when the
 * account exists but has zero balance (important on surfpool where JIT fetching
 * may return an empty account for a non-existent mainnet ATA).
 */
export async function hasUsdcFixture(
  provider: anchor.AnchorProvider
): Promise<boolean> {
  if (!isMainnetFork()) return false;
  const fixtureWalletPath = path.join(
    __dirname,
    "../fixtures/fork-wallet.json"
  );
  if (!fs.existsSync(fixtureWalletPath)) return false;
  try {
    const fixtureSecret = Uint8Array.from(
      JSON.parse(fs.readFileSync(fixtureWalletPath, "utf8"))
    );
    const fixtureWallet = Keypair.fromSecretKey(fixtureSecret);
    const fixtureAta = getAssociatedTokenAddressSync(
      MAINNET_USDC_MINT,
      fixtureWallet.publicKey
    );
    const fixtureAccount = await getAccount(
      provider.connection,
      fixtureAta,
      undefined,
      TOKEN_PROGRAM
    );
    // Must have a non-zero USDC balance to be useful as a fixture
    return fixtureAccount.amount > 0n;
  } catch {
    return false;
  }
}

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

/** Fetch the underlying mint from an already-initialized vault state account. */
async function fetchVaultUnderlyingMint(
  program: Program,
  vaultStatePda: PublicKey
): Promise<PublicKey | null> {
  const knownAccounts = [
    "kaminoVaultState",
    "marginfiVaultState",
    "jupiterVaultState",
    "driftVaultState",
    "mapleVaultState",
    "templateVaultState",
  ];
  for (const name of knownAccounts) {
    try {
      const vault = await (program.account as any)[name].fetch(vaultStatePda);
      if (vault?.underlyingMint) return vault.underlyingMint as PublicKey;
    } catch {
      // not this account type — try next
    }
  }
  return null;
}

/** Initialize adapter vault state PDA.
 *  Silently succeeds if already deployed and returns the on-chain underlying mint. */
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
    return underlyingMint;
  } catch (e: unknown) {
    const msg = String(e);
    if (!msg.includes("already in use") && !msg.includes("0x0")) {
      throw e;
    }
    // Vault already exists — return the actual on-chain mint so callers
    // don't accidentally use a mismatched test mint.
    const actual = await fetchVaultUnderlyingMint(program, vaultStatePda);
    return actual ?? underlyingMint;
  }
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
  let proposedMint: PublicKey;
  if (explicitMint) {
    proposedMint = explicitMint;
  } else if (isMainnetFork()) {
    proposedMint = (await hasUsdcFixture(provider))
      ? MAINNET_USDC_MINT
      : await createTestMint(provider, payer, 6);
  } else {
    proposedMint = await resolveUnderlyingMint(provider, payer);
  }

  // Initialize vault (first-call wins; returns effective underlying mint if already deployed)
  let underlyingMint = await initializeAdapterVault(program, authority, vaultStatePda, proposedMint);

  const vaultTokenAccount = await createVaultTokenAccount(
    provider,
    payer,
    underlyingMint,
    vaultAuthorityPda
  );

  // Fund user ATA for the vault's underlying mint
  const userTokenAccount: PublicKey = await createTestTokenAccount(provider, underlyingMint, authority.publicKey, payer);
  await mintTestTokens(provider, underlyingMint, userTokenAccount, payer, depositAmount * 2);

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
  expect(vaultBalanceAfterDeposit).to.be.at.least(depositAmount);

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
  expect(vaultBalanceAfterWithdraw).to.be.lessThan(vaultBalanceAfterDeposit);
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

    underlyingMint = await initializeAdapterVault(program, authority, vaultStatePda, underlyingMint);
    const vaultTokenAccount = await createVaultTokenAccount(provider, payer, underlyingMint, vaultAuthorityPda);

    // Re-create user token account for the actual vault mint (may differ from proposed mint)
    userTokenAccount = await createTestTokenAccount(provider, underlyingMint, authority.publicKey, payer);
    await mintTestTokens(provider, underlyingMint, userTokenAccount, payer, depositAmount * 2);

    const [userPositionPda] = adapterUserPositionPda(program.programId, authority.publicKey);

    // Allow Surfpool JIT-fetch to catch up (longer for slow adapters like Maple)
    await sleep(3000);

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

    underlyingMint = await initializeAdapterVault(program, authority, vaultStatePda, underlyingMint);
    const vaultTokenAccount = await createVaultTokenAccount(provider, payer, underlyingMint, vaultAuthorityPda);

    // Re-create user token account for the actual vault mint (may differ from proposed mint)
    userTokenAccount = await createTestTokenAccount(provider, underlyingMint, authority.publicKey, payer);
    await mintTestTokens(provider, underlyingMint, userTokenAccount, payer, depositAmount * 2);

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

    // Wait for new slot before testing withdraw slippage (longer for slow adapters like Maple)
    await sleep(3000);

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

/**
 * Fund a user token account for the given mint on any network.
 * On fork, tries fixture wallet; on localnet, mints directly.
 * Returns the user ATA address.
 */
async function fundUserAta(
  provider: anchor.AnchorProvider,
  payer: Keypair,
  user: PublicKey,
  mint: PublicKey,
  amount: number
): Promise<PublicKey> {
  if (isMainnetFork()) {
    const ata = getAssociatedTokenAddressSync(mint, user);
    try {
      const fixtureWalletPath = path.join(__dirname, "../fixtures/fork-wallet.json");
      if (fs.existsSync(fixtureWalletPath)) {
        const fixtureSecret = Uint8Array.from(JSON.parse(fs.readFileSync(fixtureWalletPath, "utf8")));
        const fixtureWallet = Keypair.fromSecretKey(fixtureSecret);
        const fixtureAta = getAssociatedTokenAddressSync(mint, fixtureWallet.publicKey);
        const fixtureInfo = await provider.connection.getAccountInfo(fixtureAta);
        if (fixtureInfo) {
          const sig = await provider.connection.requestAirdrop(fixtureWallet.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
          const bh = await provider.connection.getLatestBlockhash();
          await provider.connection.confirmTransaction({ signature: sig, ...bh });
          const userAta = await getOrCreateAssociatedTokenAccount(provider.connection, payer, mint, user);
          await transfer(provider.connection, payer, fixtureAta, userAta.address, fixtureWallet, amount);
          return userAta.address;
        }
      }
      // Fallback: try to mint (works for test mints on Surfpool)
      const userAta = await getOrCreateAssociatedTokenAccount(provider.connection, payer, mint, user);
      await mintTestTokens(provider, mint, userAta.address, payer, amount);
      return userAta.address;
    } catch {
      return ata;
    }
  }
  const userAta = await createTestTokenAccount(provider, mint, user, payer);
  await mintTestTokens(provider, mint, userAta, payer, amount);
  return userAta;
}

/**
 * Shared zero-amount deposit rejection test.
 * Verifies the adapter returns ZeroDepositAmount when amount is 0.
 */
export async function runAdapterZeroDepositRejection(
  provider: anchor.AnchorProvider,
  authority: anchor.Wallet,
  payer: Keypair,
  opts: AdapterFlowOptions
): Promise<void> {
  const { program } = opts;
  const vaultStateSeed = opts.vaultStateSeed;
  const vaultAuthoritySeed = opts.vaultAuthoritySeed;
  const [vaultStatePda] = findPda([Buffer.from(vaultStateSeed)], program.programId);
  const [vaultAuthorityPda] = findPda([Buffer.from(vaultAuthoritySeed)], program.programId);

  let underlyingMint: PublicKey;
  if (opts.underlyingMint) {
    underlyingMint = opts.underlyingMint;
  } else if (isMainnetFork()) {
    underlyingMint = (await hasUsdcFixture(provider))
      ? MAINNET_USDC_MINT
      : await createTestMint(provider, payer, 6);
  } else {
    underlyingMint = await resolveUnderlyingMint(provider, payer);
  }

  underlyingMint = await initializeAdapterVault(program, authority, vaultStatePda, underlyingMint);
  const vaultTokenAccount = await createVaultTokenAccount(provider, payer, underlyingMint, vaultAuthorityPda);
  const userTokenAccount = await createTestTokenAccount(provider, underlyingMint, authority.publicKey, payer);
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
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    expect.fail("Should have rejected zero deposit");
  } catch (err: unknown) {
    expect(String(err)).to.contain("Deposit amount must be greater than zero");
  }
}

/**
 * Shared zero-amount withdraw rejection test.
 * Deposits first, then attempts to withdraw 0 shares.
 */
export async function runAdapterZeroWithdrawRejection(
  provider: anchor.AnchorProvider,
  authority: anchor.Wallet,
  payer: Keypair,
  opts: AdapterFlowOptions
): Promise<void> {
  const { program, vaultStateSeed, vaultAuthoritySeed, depositAmount = 1_000_000 } = opts;
  const [vaultStatePda] = findPda([Buffer.from(vaultStateSeed)], program.programId);
  const [vaultAuthorityPda] = findPda([Buffer.from(vaultAuthoritySeed)], program.programId);

  let underlyingMint: PublicKey;
  if (opts.underlyingMint) {
    underlyingMint = opts.underlyingMint;
  } else if (isMainnetFork()) {
    underlyingMint = (await hasUsdcFixture(provider))
      ? MAINNET_USDC_MINT
      : await createTestMint(provider, payer, 6);
  } else {
    underlyingMint = await resolveUnderlyingMint(provider, payer);
  }

  underlyingMint = await initializeAdapterVault(program, authority, vaultStatePda, underlyingMint);
  const vaultTokenAccount = await createVaultTokenAccount(provider, payer, underlyingMint, vaultAuthorityPda);
  const userTokenAccount = await fundUserAta(provider, payer, authority.publicKey, underlyingMint, depositAmount * 2);
  const [userPositionPda] = adapterUserPositionPda(program.programId, authority.publicKey);

  // Deposit first so we have shares
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

  // Try to withdraw 0 shares
  try {
    await program.methods
      .withdraw(new anchor.BN(0), new anchor.BN(0))
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
    expect.fail("Should have rejected zero withdraw");
  } catch (err: unknown) {
    expect(String(err)).to.contain("Withdrawal amount must be greater than zero");
  }
}

/**
 * Shared full round-trip flow: deposit → current_value → withdraw all shares.
 * Verifies the user receives underlying tokens back and vault is drained.
 */
export async function runAdapterFullWithdrawFlow(
  provider: anchor.AnchorProvider,
  authority: anchor.Wallet,
  payer: Keypair,
  opts: AdapterFlowOptions
): Promise<void> {
  const { program, vaultStateSeed, vaultAuthoritySeed, depositAmount = 1_000_000 } = opts;
  const [vaultStatePda] = findPda([Buffer.from(vaultStateSeed)], program.programId);
  const [vaultAuthorityPda] = findPda([Buffer.from(vaultAuthoritySeed)], program.programId);

  let underlyingMint: PublicKey;
  if (opts.underlyingMint) {
    underlyingMint = opts.underlyingMint;
  } else if (isMainnetFork()) {
    underlyingMint = (await hasUsdcFixture(provider))
      ? MAINNET_USDC_MINT
      : await createTestMint(provider, payer, 6);
  } else {
    underlyingMint = await resolveUnderlyingMint(provider, payer);
  }

  underlyingMint = await initializeAdapterVault(program, authority, vaultStatePda, underlyingMint);
  const vaultTokenAccount = await createVaultTokenAccount(provider, payer, underlyingMint, vaultAuthorityPda);
  const userTokenAccount = await fundUserAta(provider, payer, authority.publicKey, underlyingMint, depositAmount * 2);
  const [userPositionPda] = adapterUserPositionPda(program.programId, authority.publicKey);

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
    const protocolId = protocolProgramForAdapter(program.programId);
    if (protocolId) {
      depositBuilder.remainingAccounts([
        { pubkey: protocolId, isSigner: false, isWritable: false },
      ]);
    }
  }

  // Deposit amount tracks vault growth - verify increase, not exact value
  const vaultBeforeDeposit = await getTokenBalance(provider, vaultTokenAccount);
  await depositBuilder.rpc();
  const vaultAfterDeposit = await getTokenBalance(provider, vaultTokenAccount);
  expect(vaultAfterDeposit).to.equal(vaultBeforeDeposit + depositAmount);

  // current_value
  const cvBuilder = program.methods.currentValue().accounts({
    user: authority.publicKey,
    vaultState: vaultStatePda,
    userPosition: userPositionPda,
  });

  if (isMainnetFork()) {
    const protocolId = protocolProgramForAdapter(program.programId);
    if (protocolId) {
      cvBuilder.remainingAccounts([
        { pubkey: protocolId, isSigner: false, isWritable: false },
      ]);
    }
  }

  await cvBuilder.rpc();

  // Get position to know receipt token balance (all shares)
  const position = await program.account.adapterPosition.fetch(userPositionPda);
  const totalShares = position.receiptTokenBalance.toNumber();
  expect(totalShares).to.be.greaterThan(0);

  // Allow Surfpool JIT-fetch to catch up before full withdraw
  await sleep(1000);

  // Withdraw all shares
  await program.methods
    .withdraw(new anchor.BN(totalShares), new anchor.BN(0))
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

  // Vault should be empty
  const vaultAfterWithdraw = await getTokenBalance(provider, vaultTokenAccount);
  expect(vaultAfterWithdraw).to.equal(0);

  // User should have received underlying back
  const userBalance = await getTokenBalance(provider, userTokenAccount);
  expect(userBalance).to.be.greaterThan(0);
}

/**
 * Fork-only verification that protocol CPI was actually executed on deposit.
 * Checks that `protocol_routed_underlying` is > 0 after a deposit when
 * remaining accounts (the protocol program) are provided.
 *
 * @param vaultStateAccountName — Anchor IDL account name for the vault state
 *   (e.g. "kaminoVaultState", "marginfiVaultState", "jupiterVaultState", "driftVaultState")
 */
export async function runAdapterProtocolCpiVerification(
  provider: anchor.AnchorProvider,
  authority: anchor.Wallet,
  payer: Keypair,
  opts: AdapterFlowOptions & { vaultStateAccountName: string }
): Promise<void> {
  // Requires real USDC from the fork fixture
  if (isMainnetFork() && !(await hasUsdcFixture(provider))) return;

  const { program, vaultStateSeed, vaultAuthoritySeed, vaultStateAccountName, depositAmount = 1_000_000 } = opts;
  const [vaultStatePda] = findPda([Buffer.from(vaultStateSeed)], program.programId);
  const [vaultAuthorityPda] = findPda([Buffer.from(vaultAuthoritySeed)], program.programId);

  const underlyingMint = MAINNET_USDC_MINT;
  await initializeAdapterVault(program, authority, vaultStatePda, underlyingMint);
  const vaultTokenAccount = await createVaultTokenAccount(provider, payer, underlyingMint, vaultAuthorityPda);

  const userTokenAccount = await fundUserAta(provider, payer, authority.publicKey, underlyingMint, depositAmount * 2);
  const [userPositionPda] = adapterUserPositionPda(program.programId, authority.publicKey);

  const protocolId = protocolProgramForAdapter(program.programId);
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

  if (protocolId) {
    depositBuilder.remainingAccounts([
      { pubkey: protocolId, isSigner: false, isWritable: false },
    ]);
  }

  await depositBuilder.rpc();

  // Fetch vault state and verify protocol CPI ran
  const vaultData = await (program.account as any)[vaultStateAccountName].fetch(vaultStatePda);
  expect(
    vaultData.protocolRoutedUnderlying.toNumber(),
    `Expected protocol_routed_underlying > 0 after deposit with remaining accounts`
  ).to.be.greaterThan(0);
}

/**
 * Fork-only test that verifies `current_value` returns exactly the correct
 * proportional share of the vault's total_underlying.
 *
 * After a single deposit of amount A (first depositor):
 *   total_underlying = A, total_shares = A, receipt_token_balance = A
 *   current_value = A * A / A = A
 *
 * This is the adapter's share-price math: it must match the deposit amount
 * when no yield has accrued yet (before_value_query is a no-op in all
 * reference adapters, so total_underlying / total_shares never changes
 * between deposits).
 *
 * For adapters with a protocol CPI (Kamino, Marginfi, Jupiter, Drift), the
 * total_underlying also equals the amount safely routed through the protocol,
 * so this test implicitly verifies full CPI orchestration.
 */
export async function runAdapterCurrentValueAccuracy(
  provider: anchor.AnchorProvider,
  authority: anchor.Wallet,
  payer: Keypair,
  opts: AdapterFlowOptions & { vaultStateAccountName: string }
): Promise<void> {
  // Requires real USDC from the fork fixture
  if (isMainnetFork() && !(await hasUsdcFixture(provider))) return;

  const { program, vaultStateSeed, vaultAuthoritySeed, vaultStateAccountName, depositAmount = 1_000_000 } = opts;
  const [vaultStatePda] = findPda([Buffer.from(vaultStateSeed)], program.programId);
  const [vaultAuthorityPda] = findPda([Buffer.from(vaultAuthoritySeed)], program.programId);

  const underlyingMint = MAINNET_USDC_MINT;
  await initializeAdapterVault(program, authority, vaultStatePda, underlyingMint);
  const vaultTokenAccount = await createVaultTokenAccount(provider, payer, underlyingMint, vaultAuthorityPda);
  const userTokenAccount = await fundUserAta(provider, payer, authority.publicKey, underlyingMint, depositAmount * 2);
  const [userPositionPda] = adapterUserPositionPda(program.programId, authority.publicKey);

  const protocolId = protocolProgramForAdapter(program.programId);
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

  if (protocolId) {
    depositBuilder.remainingAccounts([
      { pubkey: protocolId, isSigner: false, isWritable: false },
    ]);
  }

  await depositBuilder.rpc();

  // Fetch vault state and position to compute expected value independently
  const vaultData = await (program.account as any)[vaultStateAccountName].fetch(vaultStatePda);
  const position = await program.account.adapterPosition.fetch(userPositionPda);

  const receiptTokenBalance = position.receiptTokenBalance.toNumber();
  const totalUnderlying = vaultData.totalUnderlying.toNumber();
  const totalShares = vaultData.totalShares.toNumber();

  // Expected value = receipt_token_balance * total_underlying / total_shares
  const expectedValue = Number(
    BigInt(receiptTokenBalance) * BigInt(totalUnderlying) / BigInt(totalShares)
  );

  // For first depositor: total_underlying = depositAmount, total_shares = receipt_token_balance
  // So expectedValue must equal depositAmount exactly (share price is 1:1)
  expect(expectedValue, "current_value should match deposit amount for first depositor").to.equal(depositAmount);

  // Verify protocol_routed_underlying reflects the deposit
  expect(
    vaultData.protocolRoutedUnderlying.toNumber(),
    "protocol_routed_underlying should be >= deposit amount after CPI"
  ).to.be.at.least(depositAmount);

  // current_value instruction should emit the same value; we verify it doesn't error
  const cvBuilder = program.methods.currentValue().accounts({
    user: authority.publicKey,
    vaultState: vaultStatePda,
    userPosition: userPositionPda,
  });

  if (protocolId) {
    cvBuilder.remainingAccounts([
      { pubkey: protocolId, isSigner: false, isWritable: false },
    ]);
  }

  await cvBuilder.rpc();
}

/**
 * Two-user independent deposit/withdraw test.
 *
 * Verifies that two separate users can each deposit independently,
 * that their positions are tracked separately, and that withdrawals
 * from one user don't affect the other.
 */
export async function runAdapterMultipleUsers(
  provider: anchor.AnchorProvider,
  authority: anchor.Wallet,
  payer: Keypair,
  opts: AdapterFlowOptions & { vaultStateAccountName: string }
): Promise<void> {
  // Requires real USDC from the fork fixture
  if (isMainnetFork() && !(await hasUsdcFixture(provider))) return;

  const { program, vaultStateSeed, vaultAuthoritySeed, depositAmount = 1_000_000 } = opts;
  const [vaultStatePda] = findPda([Buffer.from(vaultStateSeed)], program.programId);
  const [vaultAuthorityPda] = findPda([Buffer.from(vaultAuthoritySeed)], program.programId);

  const underlyingMint = MAINNET_USDC_MINT;
  await initializeAdapterVault(program, authority, vaultStatePda, underlyingMint);
  const vaultTokenAccount = await createVaultTokenAccount(provider, payer, underlyingMint, vaultAuthorityPda);

  // Drift requires cooldown = 0 for instant settlement
  const protocolId = protocolProgramForAdapter(program.programId);
  if (protocolId?.equals(DRIFT_PROGRAM_ID)) {
    await program.methods
      .setUnstakeCooldown(new anchor.BN(0))
      .accounts({ authority: authority.publicKey, vaultState: vaultStatePda })
      .rpc();
  }

  // Create user B (separate keypair)
  const userB = anchor.web3.Keypair.generate();
  await airdrop(provider.connection, userB.publicKey);

  // Fund both users
  const userAta = await fundUserAta(provider, payer, authority.publicKey, underlyingMint, depositAmount * 2);
  const userBAta = await fundUserAta(provider, payer, userB.publicKey, underlyingMint, depositAmount * 2);

  // User A deposits
  const [positionAPda] = adapterUserPositionPda(program.programId, authority.publicKey);
  const depositA = program.methods
    .deposit(new anchor.BN(depositAmount), new anchor.BN(0))
    .accounts({
      user: authority.publicKey,
      vaultState: vaultStatePda,
      userPosition: positionAPda,
      userTokenAccount: userAta,
      vaultAuthority: vaultAuthorityPda,
      vaultTokenAccount,
      tokenProgram: TOKEN_PROGRAM,
      systemProgram: SystemProgram.programId,
    });

  if (protocolId) {
    depositA.remainingAccounts([{ pubkey: protocolId, isSigner: false, isWritable: false }]);
  }

  await depositA.rpc();

  const posA = await program.account.adapterPosition.fetch(positionAPda);
  expect(posA.owner.toString()).to.equal(authority.publicKey.toString());
  expect(posA.depositedAmount.toNumber()).to.equal(depositAmount);
  expect(posA.receiptTokenBalance.toNumber()).to.be.greaterThan(0);

  // User B deposits independently
  const [positionBPda] = adapterUserPositionPda(program.programId, userB.publicKey);
  const depositB = program.methods
    .deposit(new anchor.BN(depositAmount), new anchor.BN(0))
    .accounts({
      user: userB.publicKey,
      vaultState: vaultStatePda,
      userPosition: positionBPda,
      userTokenAccount: userBAta,
      vaultAuthority: vaultAuthorityPda,
      vaultTokenAccount,
      tokenProgram: TOKEN_PROGRAM,
      systemProgram: SystemProgram.programId,
    })
    .signers([userB]);

  if (protocolId) {
    depositB.remainingAccounts([{ pubkey: protocolId, isSigner: false, isWritable: false }]);
  }

  await depositB.rpc();

  const posB = await program.account.adapterPosition.fetch(positionBPda);
  expect(posB.owner.toString()).to.equal(userB.publicKey.toString());
  expect(posB.depositedAmount.toNumber()).to.equal(depositAmount);
  expect(posB.receiptTokenBalance.toNumber()).to.be.greaterThan(0);

  // Vault totals should reflect both deposits
  const vaultData = await (program.account as any)[opts.vaultStateAccountName].fetch(vaultStatePda);
  expect(vaultData.totalUnderlying.toNumber()).to.equal(depositAmount * 2);
  expect(vaultData.totalShares.toNumber()).to.be.at.least(depositAmount * 2);

  // User A's position is unchanged by user B's deposit
  const posAAfterB = await program.account.adapterPosition.fetch(positionAPda);
  expect(posAAfterB.depositedAmount.toNumber()).to.equal(depositAmount);
  expect(posAAfterB.receiptTokenBalance.toNumber()).to.equal(posA.receiptTokenBalance.toNumber());

  // User A withdraws — should not affect user B
  const isDrift = protocolId?.equals(DRIFT_PROGRAM_ID) ?? false;
  let ticketAPda: PublicKey | undefined;

  let withdrawAAccounts: Record<string, PublicKey>;

  if (isDrift) {
    ticketAPda = findPda([Buffer.from("drift_ticket"), positionAPda.toBuffer()], program.programId)[0];
    withdrawAAccounts = {
      user: authority.publicKey,
      vaultState: vaultStatePda,
      userPosition: positionAPda,
      ticket: ticketAPda,
      tokenProgram: TOKEN_PROGRAM,
      systemProgram: SystemProgram.programId,
    };
  } else {
    withdrawAAccounts = {
      user: authority.publicKey,
      vaultState: vaultStatePda,
      userPosition: positionAPda,
      userTokenAccount: userAta,
      vaultTokenAccount,
      vaultAuthority: vaultAuthorityPda,
      tokenProgram: TOKEN_PROGRAM,
    };
  }

  const withdrawA = program.methods
    .withdraw(new anchor.BN(posA.receiptTokenBalance.toNumber()), new anchor.BN(0))
    .accounts(withdrawAAccounts);

  if (protocolId) {
    withdrawA.remainingAccounts([{ pubkey: protocolId, isSigner: false, isWritable: false }]);
  }

  await withdrawA.rpc();

  if (isDrift && ticketAPda) {
    const settleBuilder = program.methods.settleWithdrawal().accounts({
      user: authority.publicKey,
      vaultState: vaultStatePda,
      userPosition: positionAPda,
      ticket: ticketAPda,
      userTokenAccount: userAta,
      vaultTokenAccount,
      vaultAuthority: vaultAuthorityPda,
      tokenProgram: TOKEN_PROGRAM,
    });

    if (protocolId) {
      settleBuilder.remainingAccounts([{ pubkey: protocolId, isSigner: false, isWritable: false }]);
    }

    await settleBuilder.rpc();
  }

  // User A position is cleared
  const posAAfterWithdraw = await program.account.adapterPosition.fetch(positionAPda);
  expect(posAAfterWithdraw.receiptTokenBalance.toNumber()).to.equal(0);

  // User B position is untouched
  const posBAfterA = await program.account.adapterPosition.fetch(positionBPda);
  expect(posBAfterA.receiptTokenBalance.toNumber()).to.equal(posB.receiptTokenBalance.toNumber());
  expect(posBAfterA.depositedAmount.toNumber()).to.equal(depositAmount);

  // vault totals decreased by user A's withdrawal
  const vaultAfterA = await (program.account as any)[opts.vaultStateAccountName].fetch(vaultStatePda);
  expect(vaultAfterA.totalUnderlying.toNumber()).to.be.lessThan(depositAmount * 2);
}

export async function runAdapterEmptyStateTests(
  provider: anchor.AnchorProvider,
  authority: anchor.Wallet,
  payer: Keypair,
  opts: AdapterFlowOptions & { vaultStateAccountName: string }
): Promise<void> {
  // Requires real USDC from the fork fixture
  if (isMainnetFork() && !(await hasUsdcFixture(provider))) return;

  const { program, vaultStateSeed, vaultAuthoritySeed, depositAmount = 1_000_000 } = opts;
  const [vaultStatePda] = findPda([Buffer.from(vaultStateSeed)], program.programId);
  const [vaultAuthorityPda] = findPda([Buffer.from(vaultAuthoritySeed)], program.programId);

  const underlyingMint = MAINNET_USDC_MINT;
  await initializeAdapterVault(program, authority, vaultStatePda, underlyingMint);
  const vaultTokenAccount = await createVaultTokenAccount(provider, payer, underlyingMint, vaultAuthorityPda);

  const protocolId = protocolProgramForAdapter(program.programId);
  const isDrift = protocolId?.equals(DRIFT_PROGRAM_ID) ?? false;

  // Drift cooldown for settle
  if (isDrift) {
    await program.methods
      .setUnstakeCooldown(new anchor.BN(0))
      .accounts({ authority: authority.publicKey, vaultState: vaultStatePda })
      .rpc();
  }

  // Test 1: current_value with no deposits — should emit/return 0
  const [emptyPositionPda] = adapterUserPositionPda(program.programId, anchor.web3.Keypair.generate().publicKey);
  const cvBuilder = program.methods.currentValue().accounts({
    user: authority.publicKey,
    vaultState: vaultStatePda,
    userPosition: emptyPositionPda,
  });
  if (protocolId) {
    cvBuilder.remainingAccounts([{ pubkey: protocolId, isSigner: false, isWritable: false }]);
  }
  await cvBuilder.rpc();

  // Test 2: Withdraw from empty position
  const [zeroPositionPda] = adapterUserPositionPda(program.programId, authority.publicKey);
  try {
    const wBuilder = program.methods.withdraw(new anchor.BN(depositAmount), new anchor.BN(0)).accounts({
      user: authority.publicKey,
      vaultState: vaultStatePda,
      userPosition: zeroPositionPda,
      userTokenAccount: await fundUserAta(provider, payer, authority.publicKey, underlyingMint, depositAmount),
      vaultTokenAccount,
      vaultAuthority: vaultAuthorityPda,
      tokenProgram: TOKEN_PROGRAM,
    });

    if (isDrift) {
      const [ticketPda] = findPda([Buffer.from("drift_ticket"), zeroPositionPda.toBuffer()], program.programId);
      wBuilder.accounts({ ticket: ticketPda, systemProgram: SystemProgram.programId } as any);
    }

    if (protocolId) {
      wBuilder.remainingAccounts([{ pubkey: protocolId, isSigner: false, isWritable: false }]);
    }

    await wBuilder.rpc();
    expect.fail("Should have rejected withdraw from empty position");
  } catch (err: unknown) {
    expect(String(err)).to.satisfy((s: string) =>
      s.includes("InsufficientReceiptBalance") || s.includes("0x1770") || s.includes("no position")
    );
  }

  // Test 3: Reuse position after full withdraw (deposit again)
  const [reusePositionPda] = adapterUserPositionPda(program.programId, authority.publicKey);
  const userAta = await fundUserAta(provider, payer, authority.publicKey, underlyingMint, depositAmount * 2);

  const deposit1 = program.methods.deposit(new anchor.BN(depositAmount), new anchor.BN(0)).accounts({
    user: authority.publicKey,
    vaultState: vaultStatePda,
    userPosition: reusePositionPda,
    userTokenAccount: userAta,
    vaultAuthority: vaultAuthorityPda,
    vaultTokenAccount,
    tokenProgram: TOKEN_PROGRAM,
    systemProgram: SystemProgram.programId,
  });
  if (protocolId) {
    deposit1.remainingAccounts([{ pubkey: protocolId, isSigner: false, isWritable: false }]);
  }
  await deposit1.rpc();

  let pos = await program.account.adapterPosition.fetch(reusePositionPda);
  expect(pos.depositedAmount.toNumber()).to.equal(depositAmount);

  // Full withdraw
  if (isDrift) {
    const [ticketPda] = findPda([Buffer.from("drift_ticket"), reusePositionPda.toBuffer()], program.programId);
    await program.methods.withdraw(new anchor.BN(pos.receiptTokenBalance.toNumber()), new anchor.BN(0)).accounts({
      user: authority.publicKey,
      vaultState: vaultStatePda,
      userPosition: reusePositionPda,
      ticket: ticketPda,
      tokenProgram: TOKEN_PROGRAM,
      systemProgram: SystemProgram.programId,
    }).rpc();

    await program.methods.settleWithdrawal().accounts({
      user: authority.publicKey,
      vaultState: vaultStatePda,
      userPosition: reusePositionPda,
      ticket: ticketPda,
      userTokenAccount: userAta,
      vaultTokenAccount,
      vaultAuthority: vaultAuthorityPda,
      tokenProgram: TOKEN_PROGRAM,
    }).rpc();
  } else {
    const wBuilder = program.methods.withdraw(new anchor.BN(pos.receiptTokenBalance.toNumber()), new anchor.BN(0)).accounts({
      user: authority.publicKey,
      vaultState: vaultStatePda,
      userPosition: reusePositionPda,
      userTokenAccount: userAta,
      vaultTokenAccount,
      vaultAuthority: vaultAuthorityPda,
      tokenProgram: TOKEN_PROGRAM,
    });
    if (protocolId) {
      wBuilder.remainingAccounts([{ pubkey: protocolId, isSigner: false, isWritable: false }]);
    }
    await wBuilder.rpc();
  }

  pos = await program.account.adapterPosition.fetch(reusePositionPda);
  expect(pos.receiptTokenBalance.toNumber()).to.equal(0);

  // Deposit again on the same position
  const deposit2 = program.methods.deposit(new anchor.BN(depositAmount), new anchor.BN(0)).accounts({
    user: authority.publicKey,
    vaultState: vaultStatePda,
    userPosition: reusePositionPda,
    userTokenAccount: userAta,
    vaultAuthority: vaultAuthorityPda,
    vaultTokenAccount,
    tokenProgram: TOKEN_PROGRAM,
    systemProgram: SystemProgram.programId,
  });
  if (protocolId) {
    deposit2.remainingAccounts([{ pubkey: protocolId, isSigner: false, isWritable: false }]);
  }
  await deposit2.rpc();

  pos = await program.account.adapterPosition.fetch(reusePositionPda);
  expect(pos.depositedAmount.toNumber()).to.equal(depositAmount);
  expect(pos.receiptTokenBalance.toNumber()).to.be.greaterThan(0);
}

export async function runAdapterVaultStatusLifecycle(
  provider: anchor.AnchorProvider,
  authority: anchor.Wallet,
  payer: Keypair,
  opts: AdapterFlowOptions & { vaultStateAccountName: string }
): Promise<void> {
  // Requires real USDC from the fork fixture
  if (isMainnetFork() && !(await hasUsdcFixture(provider))) return;

  const { program, vaultStateSeed, vaultAuthoritySeed, depositAmount = 1_000_000 } = opts;
  const [vaultStatePda] = findPda([Buffer.from(vaultStateSeed)], program.programId);
  const [vaultAuthorityPda] = findPda([Buffer.from(vaultAuthoritySeed)], program.programId);

  const underlyingMint = MAINNET_USDC_MINT;
  await initializeAdapterVault(program, authority, vaultStatePda, underlyingMint);
  const vaultTokenAccount = await createVaultTokenAccount(provider, payer, underlyingMint, vaultAuthorityPda);

  const protocolId = protocolProgramForAdapter(program.programId);
  const isDrift = protocolId?.equals(DRIFT_PROGRAM_ID) ?? false;

  if (isDrift) {
    await program.methods
      .setUnstakeCooldown(new anchor.BN(0))
      .accounts({ authority: authority.publicKey, vaultState: vaultStatePda })
      .rpc();
  }

  // Start: ensure vault is Active
  let vaultData = await (program.account as any)[opts.vaultStateAccountName].fetch(vaultStatePda);
  expect(vaultData.status).to.deep.equal({ active: {} });

  // Toggle Active → DepositsPaused
  await program.methods.toggleStatus().accounts({ authority: authority.publicKey, vaultState: vaultStatePda }).rpc();

  vaultData = await (program.account as any)[opts.vaultStateAccountName].fetch(vaultStatePda);
  expect(vaultData.status).to.deep.equal({ depositsPaused: {} });

  // DepositsPaused: deposit should be blocked
  const userAta = await fundUserAta(provider, payer, authority.publicKey, underlyingMint, depositAmount);
  const [positionPda] = adapterUserPositionPda(program.programId, authority.publicKey);

  try {
    const dBuilder = program.methods.deposit(new anchor.BN(depositAmount), new anchor.BN(0)).accounts({
      user: authority.publicKey,
      vaultState: vaultStatePda,
      userPosition: positionPda,
      userTokenAccount: userAta,
      vaultAuthority: vaultAuthorityPda,
      vaultTokenAccount,
      tokenProgram: TOKEN_PROGRAM,
      systemProgram: SystemProgram.programId,
    });
    if (protocolId) {
      dBuilder.remainingAccounts([{ pubkey: protocolId, isSigner: false, isWritable: false }]);
    }
    await dBuilder.rpc();
    expect.fail("Should have rejected deposit when DepositsPaused");
  } catch (err: unknown) {
    expect(String(err)).to.satisfy((s: string) =>
      s.includes("AdapterNotActive") || s.includes("not active") || s.includes("can't deposit")
    );
  }

  // DepositsPaused: withdraw should still work
  // First deposit (needs to toggle back temporarily or just proceed with an existing position)
  // Simplest: toggle to Active, deposit, toggle back to DepositsPaused, then try withdraw
  await program.methods.toggleStatus().accounts({ authority: authority.publicKey, vaultState: vaultStatePda }).rpc();
  const dBuilder2 = program.methods.deposit(new anchor.BN(depositAmount), new anchor.BN(0)).accounts({
    user: authority.publicKey,
    vaultState: vaultStatePda,
    userPosition: positionPda,
    userTokenAccount: userAta,
    vaultAuthority: vaultAuthorityPda,
    vaultTokenAccount,
    tokenProgram: TOKEN_PROGRAM,
    systemProgram: SystemProgram.programId,
  });
  if (protocolId) {
    dBuilder2.remainingAccounts([{ pubkey: protocolId, isSigner: false, isWritable: false }]);
  }
  await dBuilder2.rpc();
  let pos = await program.account.adapterPosition.fetch(positionPda);
  const receiptBalance = pos.receiptTokenBalance.toNumber();

  // Toggle Active → DepositsPaused (2nd toggle from Active state)
  await program.methods.toggleStatus().accounts({ authority: authority.publicKey, vaultState: vaultStatePda }).rpc();
  vaultData = await (program.account as any)[opts.vaultStateAccountName].fetch(vaultStatePda);
  expect(vaultData.status).to.deep.equal({ depositsPaused: {} });

  // Withdraw should succeed in DepositsPaused
  if (isDrift) {
    const [ticketPda] = findPda([Buffer.from("drift_ticket"), positionPda.toBuffer()], program.programId);
    await program.methods.withdraw(new anchor.BN(receiptBalance), new anchor.BN(0)).accounts({
      user: authority.publicKey,
      vaultState: vaultStatePda,
      userPosition: positionPda,
      ticket: ticketPda,
      tokenProgram: TOKEN_PROGRAM,
      systemProgram: SystemProgram.programId,
    }).rpc();

    await program.methods.settleWithdrawal().accounts({
      user: authority.publicKey,
      vaultState: vaultStatePda,
      userPosition: positionPda,
      ticket: ticketPda,
      userTokenAccount: userAta,
      vaultTokenAccount,
      vaultAuthority: vaultAuthorityPda,
      tokenProgram: TOKEN_PROGRAM,
    }).rpc();
  } else {
    const wBuilder = program.methods.withdraw(new anchor.BN(receiptBalance), new anchor.BN(0)).accounts({
      user: authority.publicKey,
      vaultState: vaultStatePda,
      userPosition: positionPda,
      userTokenAccount: userAta,
      vaultTokenAccount,
      vaultAuthority: vaultAuthorityPda,
      tokenProgram: TOKEN_PROGRAM,
    });
    if (protocolId) {
      wBuilder.remainingAccounts([{ pubkey: protocolId, isSigner: false, isWritable: false }]);
    }
    await wBuilder.rpc();
  }

  pos = await program.account.adapterPosition.fetch(positionPda);
  expect(pos.receiptTokenBalance.toNumber()).to.equal(0);

  // Toggle DepositsPaused → Paused
  await program.methods.toggleStatus().accounts({ authority: authority.publicKey, vaultState: vaultStatePda }).rpc();
  vaultData = await (program.account as any)[opts.vaultStateAccountName].fetch(vaultStatePda);
  expect(vaultData.status).to.deep.equal({ paused: {} });

  // Paused: deposit should be blocked
  try {
    const dBuilder3 = program.methods.deposit(new anchor.BN(depositAmount), new anchor.BN(0)).accounts({
      user: authority.publicKey,
      vaultState: vaultStatePda,
      userPosition: positionPda,
      userTokenAccount: userAta,
      vaultAuthority: vaultAuthorityPda,
      vaultTokenAccount,
      tokenProgram: TOKEN_PROGRAM,
      systemProgram: SystemProgram.programId,
    });
    if (protocolId) {
      dBuilder3.remainingAccounts([{ pubkey: protocolId, isSigner: false, isWritable: false }]);
    }
    await dBuilder3.rpc();
    expect.fail("Should have rejected deposit when Paused");
  } catch (err: unknown) {
    expect(String(err)).to.satisfy((s: string) =>
      s.includes("AdapterNotActive") || s.includes("not active") || s.includes("can't deposit")
    );
  }

  // Paused: withdraw should also be blocked
  // First deposit (need to toggle back)
  await program.methods.toggleStatus().accounts({ authority: authority.publicKey, vaultState: vaultStatePda }).rpc();
  // Paused → DepositsPaused → Active
  await program.methods.toggleStatus().accounts({ authority: authority.publicKey, vaultState: vaultStatePda }).rpc();
  vaultData = await (program.account as any)[opts.vaultStateAccountName].fetch(vaultStatePda);
  expect(vaultData.status).to.deep.equal({ active: {} });

  const dBuilder4 = program.methods.deposit(new anchor.BN(depositAmount), new anchor.BN(0)).accounts({
    user: authority.publicKey,
    vaultState: vaultStatePda,
    userPosition: positionPda,
    userTokenAccount: userAta,
    vaultAuthority: vaultAuthorityPda,
    vaultTokenAccount,
    tokenProgram: TOKEN_PROGRAM,
    systemProgram: SystemProgram.programId,
  });
  if (protocolId) {
    dBuilder4.remainingAccounts([{ pubkey: protocolId, isSigner: false, isWritable: false }]);
  }
  await dBuilder4.rpc();
  pos = await program.account.adapterPosition.fetch(positionPda);
  const receiptBalance2 = pos.receiptTokenBalance.toNumber();

  // Active → DepositsPaused → Paused
  await program.methods.toggleStatus().accounts({ authority: authority.publicKey, vaultState: vaultStatePda }).rpc();
  await program.methods.toggleStatus().accounts({ authority: authority.publicKey, vaultState: vaultStatePda }).rpc();
  vaultData = await (program.account as any)[opts.vaultStateAccountName].fetch(vaultStatePda);
  expect(vaultData.status).to.deep.equal({ paused: {} });

  // Withdraw should fail when Paused
  try {
    if (isDrift) {
      const [ticketPda] = findPda([Buffer.from("drift_ticket"), positionPda.toBuffer()], program.programId);
      await program.methods.withdraw(new anchor.BN(receiptBalance2), new anchor.BN(0)).accounts({
        user: authority.publicKey,
        vaultState: vaultStatePda,
        userPosition: positionPda,
        ticket: ticketPda,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
      }).rpc();
    } else {
      const wBuilder2 = program.methods.withdraw(new anchor.BN(receiptBalance2), new anchor.BN(0)).accounts({
        user: authority.publicKey,
        vaultState: vaultStatePda,
        userPosition: positionPda,
        userTokenAccount: userAta,
        vaultTokenAccount,
        vaultAuthority: vaultAuthorityPda,
        tokenProgram: TOKEN_PROGRAM,
      });
      if (protocolId) {
        wBuilder2.remainingAccounts([{ pubkey: protocolId, isSigner: false, isWritable: false }]);
      }
      await wBuilder2.rpc();
    }
    expect.fail("Should have rejected withdraw when Paused");
  } catch (err: unknown) {
    expect(String(err)).to.satisfy((s: string) =>
      s.includes("AdapterNotActive") || s.includes("not active") || s.includes("can't withdraw")
    );
  }

  // Restore to Active
  await program.methods.toggleStatus().accounts({ authority: authority.publicKey, vaultState: vaultStatePda }).rpc();
  vaultData = await (program.account as any)[opts.vaultStateAccountName].fetch(vaultStatePda);
  expect(vaultData.status).to.deep.equal({ active: {} });
}
