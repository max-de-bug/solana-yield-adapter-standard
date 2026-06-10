import { Program } from "@anchor-lang/core";
import { Wallet } from "@anchor-lang/core";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  transfer,
} from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "fs";
import * as path from "path";

import {
  MAINNET_USDC_MINT,
  SYRUP_USDC_MINT,
  TOKEN_PROGRAM_ID,
  isMainnetFork,
  KAMINO_PROGRAM_ID,
  MARGINFI_PROGRAM_ID,
  DRIFT_PROGRAM_ID,
  JUPITER_PERPS_PROGRAM_ID,
  AdapterName,
} from "./constants";
import {
  adapterUserPositionPda,
  findPda,
} from "./pda";
import {
  createTestMint,
  createTokenAccount,
  mintTestTokens,
} from "./token";
import { getTokenBalance } from "./accounts";
import type { AdapterFlowOptions } from "./adapter";

function protocolPdaForProgram(
  programId: PublicKey
): PublicKey | null {
  const id = programId.toBase58();
  const known: Record<string, PublicKey> = {};
  try {
    const anchor = require("@anchor-lang/core") as typeof import("@anchor-lang/core");
    const ws = (anchor as any).workspace;
    if (ws?.AdapterKamino?.programId?.toBase58() === id) return KAMINO_PROGRAM_ID;
    if (ws?.AdapterMarginfi?.programId?.toBase58() === id) return MARGINFI_PROGRAM_ID;
    if (ws?.AdapterJupiter?.programId?.toBase58() === id) return JUPITER_PERPS_PROGRAM_ID;
    if (ws?.AdapterDrift?.programId?.toBase58() === id) return DRIFT_PROGRAM_ID;
  } catch {}
  return null;
}

export async function runAdapterDepositWithdrawFlow(
  provider: any,
  authority: Wallet,
  payer: Keypair,
  options: AdapterFlowOptions
): Promise<void> {
  const { program, adapterName, depositAmount = 1_000_000, withdrawShares = 500_000 } = options;
  const connection = provider.connection;

  const vaultStateSeed = Buffer.from(`${adapterName}_vault_state`);
  const vaultAuthoritySeed = Buffer.from(`${adapterName}_vault_authority`);

  const [vaultStatePda] = findPda([vaultStateSeed], program.programId);
  const [vaultAuthorityPda] = findPda([vaultAuthoritySeed], program.programId);

  let underlyingMint: PublicKey;
  let userTokenAccount: PublicKey;

  if (isMainnetFork()) {
    const fixtureWalletPath = path.join(
      __dirname,
      "..", "..", "..", "tests", "fixtures", "fork-wallet.json"
    );
    if (fs.existsSync(fixtureWalletPath)) {
      // Legacy fixture path: use MAINNET_USDC_MINT and transfer from fixture wallet
      underlyingMint = options.underlyingMint ?? (adapterName === "maple" ? SYRUP_USDC_MINT : MAINNET_USDC_MINT);
      const fixtureSecret = Uint8Array.from(
        JSON.parse(fs.readFileSync(fixtureWalletPath, "utf8"))
      );
      const fixtureWallet = Keypair.fromSecretKey(fixtureSecret);

      await connection.requestAirdrop(
        fixtureWallet.publicKey,
        2 * LAMPORTS_PER_SOL
      );

      const fixtureAta = getAssociatedTokenAddressSync(
        underlyingMint,
        fixtureWallet.publicKey
      );
      userTokenAccount = (
        await getOrCreateAssociatedTokenAccount(
          connection,
          payer,
          underlyingMint,
          authority.publicKey,
          false,
          undefined,
          undefined,
          TOKEN_PROGRAM_ID
        )
      ).address;

      await transfer(
        connection,
        payer,
        fixtureAta,
        userTokenAccount,
        fixtureWallet,
        depositAmount * 2,
        [],
        undefined,
        TOKEN_PROGRAM_ID
      );
    } else {
      // Surfpool path: create test mint and use it for vault + user
      underlyingMint = await createTestMint(connection, payer, 6);
      userTokenAccount = await createTokenAccount(connection, underlyingMint, authority.publicKey, payer);
      await mintTestTokens(connection, underlyingMint, userTokenAccount, payer, depositAmount * 2);
    }
  } else {
    underlyingMint = options.underlyingMint ?? await createTestMint(connection, payer, 6);
    userTokenAccount = await createTokenAccount(
      connection,
      underlyingMint,
      authority.publicKey,
      payer
    );
    await mintTestTokens(
      connection,
      underlyingMint,
      userTokenAccount,
      payer,
      depositAmount * 2
    );
  }

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

  const vaultTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    underlyingMint,
    vaultAuthorityPda,
    true
  );

  const userPositionPdaAddr = adapterUserPositionPda(
    program.programId,
    authority.publicKey
  )[0];

  const depositBuilder = program.methods
    .deposit(new BN(depositAmount))
    .accounts({
      user: authority.publicKey,
      vaultState: vaultStatePda,
      userPosition: userPositionPdaAddr,
      userTokenAccount,
      vaultAuthority: vaultAuthorityPda,
      vaultTokenAccount: vaultTokenAccount.address,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    });

  if (isMainnetFork()) {
    const protocolId = protocolPdaForProgram(program.programId);
    if (protocolId) {
      depositBuilder.remainingAccounts([
        { pubkey: protocolId, isSigner: false, isWritable: false },
      ]);
    }
  }

  await depositBuilder.rpc();

  const vaultAfterDeposit = await getTokenBalance(connection, vaultTokenAccount.address);
  if (vaultAfterDeposit !== BigInt(depositAmount)) {
    throw new Error(
      `Vault balance mismatch: expected ${depositAmount}, got ${vaultAfterDeposit}`
    );
  }

  const valueBuilder = program.methods.currentValue().accounts({
    user: authority.publicKey,
    vaultState: vaultStatePda,
    userPosition: userPositionPdaAddr,
  });

  if (isMainnetFork()) {
    const protocolId = protocolPdaForProgram(program.programId);
    if (protocolId) {
      valueBuilder.remainingAccounts([
        { pubkey: protocolId, isSigner: false, isWritable: false },
      ]);
    }
  }
  await valueBuilder.rpc();

  await program.methods
    .withdraw(new BN(withdrawShares))
    .accounts({
      user: authority.publicKey,
      vaultState: vaultStatePda,
      userPosition: userPositionPdaAddr,
      userTokenAccount,
      vaultTokenAccount: vaultTokenAccount.address,
      vaultAuthority: vaultAuthorityPda,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  const userBalance = await getTokenBalance(connection, userTokenAccount);
  if (userBalance <= 0) {
    throw new Error("User balance should be > 0 after partial withdraw");
  }

  const vaultAfterWithdraw = await getTokenBalance(connection, vaultTokenAccount.address);
  if (vaultAfterWithdraw >= BigInt(depositAmount)) {
    throw new Error(
      "Vault balance should be less than deposit after partial withdraw"
    );
  }
}
