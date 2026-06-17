import * as anchor from "@anchor-lang/core";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  createMint,
  mintTo,
  getAccount,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";

export {
  findPda,
  adapterUserPositionPda,
  airdrop,
} from "../../packages/sdk/src";

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

export async function mintTestTokens(
  provider: anchor.AnchorProvider,
  mint: PublicKey,
  destination: PublicKey,
  authority: Keypair,
  amount: number
): Promise<void> {
  await mintTo(provider.connection, authority, mint, destination, authority, amount);
}

export async function getTokenBalance(
  provider: anchor.AnchorProvider,
  tokenAccount: PublicKey
): Promise<number> {
  const account = await getAccount(provider.connection, tokenAccount);
  return Number(account.amount);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Send a transaction as raw bytes with skipPreflight and confirm it.
 *  Uses blockheight-based confirmation strategy (~800s timeout) for Surfpool.
 *  Retries on blockhash reuse ("already processed") with fresh blockhash.
 *  Does NOT retry on instruction errors — those are intentional (caught by caller).
 *  Note: web3.js 1.98.x throws `SendTransactionError` on instruction errors
 *  instead of returning them, so we catch that here. */
export async function sendAndConfirm(
  provider: anchor.AnchorProvider,
  tx: anchor.web3.Transaction,
  signers?: anchor.web3.Signer[]
): Promise<string> {
  tx.feePayer ??= provider.wallet.publicKey;
  for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(200);
    const bh = await provider.connection.getLatestBlockhash();
    const lastValidBlockHeight = bh.lastValidBlockHeight + 2000;
    tx.recentBlockhash = bh.blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    if (signers) tx.sign(...signers);
    await provider.wallet.signTransaction(tx);
    let sig: string;
    try {
      sig = await provider.connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    } catch {
      await sleep(500);
      continue;
    }
    try {
      await provider.connection.confirmTransaction({
        signature: sig,
        blockhash: bh.blockhash,
        lastValidBlockHeight,
      });
    } catch (e: unknown) {
      throw new Error(String(e));
    }
    return sig;
  }
  throw new Error("sendAndConfirm failed after 3 attempts");
}

/** Build a transaction from an instruction and send+confirm via raw bytes.
 *  Handles Surfpool's 400ms slot timing with extended blockheight validity. */
export async function sendInstruction(
  provider: anchor.AnchorProvider,
  ix: anchor.web3.TransactionInstruction,
  signers?: anchor.web3.Signer[]
): Promise<string> {
  const tx = new anchor.web3.Transaction().add(ix);
  return sendAndConfirm(provider, tx, signers);
}
