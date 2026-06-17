import {
  createMint,
  mintTo,
  getOrCreateAssociatedTokenAccount,
  transfer,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

export async function airdrop(
  connection: Connection,
  to: PublicKey,
  amount: number = 10 * LAMPORTS_PER_SOL
): Promise<void> {
  const sig = await connection.requestAirdrop(to, amount);
  const latestBlockhash = await connection.getLatestBlockhash();
  const lastValidBlockHeight = latestBlockhash.lastValidBlockHeight + 2000;
  await connection.confirmTransaction({
    signature: sig,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight,
  });
}

export async function createTestMint(
  connection: Connection,
  authority: Keypair,
  decimals: number = 6
): Promise<PublicKey> {
  return createMint(connection, authority, authority.publicKey, null, decimals);
}

export async function createTokenAccount(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey,
  payer: Keypair
): Promise<PublicKey> {
  const account = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    owner
  );
  return account.address;
}

export async function mintTestTokens(
  connection: Connection,
  mint: PublicKey,
  destination: PublicKey,
  authority: Keypair,
  amount: number
): Promise<void> {
  await mintTo(connection, authority, mint, destination, authority, amount);
}

export async function transferTokens(
  connection: Connection,
  source: PublicKey,
  destination: PublicKey,
  authority: Keypair,
  amount: number
): Promise<void> {
  await transfer(
    connection,
    authority,
    source,
    destination,
    authority,
    amount,
    [],
    undefined,
    TOKEN_PROGRAM_ID
  );
}
