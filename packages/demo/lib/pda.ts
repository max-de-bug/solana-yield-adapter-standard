import { PublicKey } from "@solana/web3.js";

const ADAPTER_POSITION = Buffer.from("adapter_position");

export function findPda(seeds: Buffer[], programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(seeds, programId);
}

export function adapterUserPositionPda(
  adapterProgramId: PublicKey,
  user: PublicKey
): [PublicKey, number] {
  return findPda([ADAPTER_POSITION, user.toBuffer()], adapterProgramId);
}

export function adapterVaultStatePda(
  adapterProgramId: PublicKey,
  seed: Buffer
): [PublicKey, number] {
  return findPda([seed], adapterProgramId);
}
