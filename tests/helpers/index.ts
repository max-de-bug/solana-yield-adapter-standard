import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  createMint,
  mintTo,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { expect } from "chai";

/**
 * Shared test helpers for the Solana Yield Adapter Standard test suite.
 */

/** Airdrop SOL to a keypair and confirm. */
export async function airdrop(
  provider: anchor.AnchorProvider,
  to: PublicKey,
  amount: number = 10 * anchor.web3.LAMPORTS_PER_SOL
): Promise<void> {
  const sig = await provider.connection.requestAirdrop(to, amount);
  const latestBlockhash = await provider.connection.getLatestBlockhash();
  await provider.connection.confirmTransaction({
    signature: sig,
    ...latestBlockhash,
  });
}

/** Create a new SPL token mint. */
export async function createTestMint(
  provider: anchor.AnchorProvider,
  authority: Keypair,
  decimals: number = 6
): Promise<PublicKey> {
  return createMint(
    provider.connection,
    authority,
    authority.publicKey,
    null,
    decimals
  );
}

/** Create (or fetch) the owner's ATA for a mint. */
export async function createTestTokenAccount(
  provider: anchor.AnchorProvider,
  mint: PublicKey,
  owner: PublicKey,
  payer: Keypair
): Promise<PublicKey> {
  const account = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    mint,
    owner
  );
  return account.address;
}

/** Mint tokens to a token account. */
export async function mintTestTokens(
  provider: anchor.AnchorProvider,
  mint: PublicKey,
  destination: PublicKey,
  authority: Keypair,
  amount: number
): Promise<void> {
  await mintTo(provider.connection, authority, mint, destination, authority, amount);
}

/** Get the token balance for an account. */
export async function getTokenBalance(
  provider: anchor.AnchorProvider,
  tokenAccount: PublicKey
): Promise<number> {
  const account = await getAccount(provider.connection, tokenAccount);
  return Number(account.amount);
}

/** Find PDA with given seeds and program ID. */
export function findPda(
  seeds: Buffer[],
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(seeds, programId);
}

/** Adapter-side per-user position PDA (`adapter_position` + user). */
export function adapterUserPositionPda(
  user: PublicKey,
  adapterProgramId: PublicKey
): PublicKey {
  const [pda] = findPda(
    [Buffer.from("adapter_position"), user.toBuffer()],
    adapterProgramId
  );
  return pda;
}

/** Sleep for a given number of milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
