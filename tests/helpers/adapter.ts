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

/** Fund a user USDC ATA from the fork fixture account (mainnet-fork only). */
export async function fundUserUsdcOnFork(
  provider: anchor.AnchorProvider,
  payer: Keypair,
  user: PublicKey,
  amount: number
): Promise<PublicKey> {
  const fixtureWalletPath = path.join(
    __dirname,
    "../fixtures/fork-wallet.json"
  );
  if (!fs.existsSync(fixtureWalletPath)) {
    throw new Error(
      `Missing ${fixtureWalletPath}. Run: ./scripts/setup-fork-usdc-fixture.sh`
    );
  }

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
  if (!fixtureInfo) {
    throw new Error(
      `Fork fixture ATA ${fixtureAta.toBase58()} missing. Re-run ./scripts/setup-fork-usdc-fixture.sh and ensure run-mainnet-fork-tests.sh loads tests/fixtures/fork-usdc-ata.json`
    );
  }

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

  return userAta.address;
}

/** Fund a user token ATA from a fork fixture for any mint. */
async function fundUserTokenOnFork(
  provider: anchor.AnchorProvider,
  payer: Keypair,
  user: PublicKey,
  mint: PublicKey,
  fixtureFileName: string,
  setupScriptName: string,
  amount: number
): Promise<PublicKey> {
  const fixtureWalletPath = path.join(
    __dirname,
    "../fixtures/fork-wallet.json"
  );
  if (!fs.existsSync(fixtureWalletPath)) {
    throw new Error(
      `Missing ${fixtureWalletPath}. Run: ./scripts/setup-fork-usdc-fixture.sh`
    );
  }

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
  if (!fixtureInfo) {
    throw new Error(
      `Fork fixture ATA ${fixtureAta.toBase58()} missing. Ensure ${setupScriptName} and run-mainnet-fork-tests.sh load ${fixtureFileName}`
    );
  }

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

  return userAta.address;
}

/** Fund a user syrupUSDC ATA from the fork fixture (mainnet-fork only). */
export async function fundUserSyrupUsdcOnFork(
  provider: anchor.AnchorProvider,
  payer: Keypair,
  user: PublicKey,
  amount: number
): Promise<PublicKey> {
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
export async function initializeAdapterVault(
  program: Program,
  authority: anchor.Wallet,
  vaultStatePda: PublicKey,
  underlyingMint: PublicKey
): Promise<void> {
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

  let underlyingMint: PublicKey;
  if (explicitMint) {
    underlyingMint = explicitMint;
  } else {
    underlyingMint = await resolveUnderlyingMint(provider, payer);
  }

  await initializeAdapterVault(
    program,
    authority,
    vaultStatePda,
    underlyingMint
  );

  const vaultTokenAccount = await createVaultTokenAccount(
    provider,
    payer,
    underlyingMint,
    vaultAuthorityPda
  );

  let userTokenAccount: PublicKey;
  if (isMainnetFork()) {
    if (explicitMint && explicitMint.equals(SYRUP_USDC_MINT)) {
      userTokenAccount = await fundUserSyrupUsdcOnFork(
        provider,
        payer,
        authority.publicKey,
        depositAmount * 2
      );
    } else {
      userTokenAccount = await fundUserUsdcOnFork(
        provider,
        payer,
        authority.publicKey,
        depositAmount * 2
      );
    }
  } else {
    userTokenAccount = await createTestTokenAccount(
      provider,
      underlyingMint,
      authority.publicKey,
      payer
    );
    await mintTestTokens(
      provider,
      underlyingMint,
      userTokenAccount,
      payer,
      depositAmount * 2
    );
  }

  const userPositionPda = adapterUserPositionPda(
    authority.publicKey,
    program.programId
  );

  const depositBuilder = program.methods
    .deposit(new anchor.BN(depositAmount))
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
    .withdraw(new anchor.BN(withdrawShares))
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
