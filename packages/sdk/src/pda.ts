import { PublicKey } from "@solana/web3.js";
import { SEEDS } from "./constants";

export function findPda(
  seeds: Buffer[],
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(seeds, programId);
}

export function registryStatePda(registryProgramId: PublicKey): [PublicKey, number] {
  return findPda([SEEDS.REGISTRY_STATE], registryProgramId);
}

export function adapterEntryPda(
  registryProgramId: PublicKey,
  adapterProgramId: PublicKey
): [PublicKey, number] {
  return findPda(
    [SEEDS.ADAPTER_ENTRY, adapterProgramId.toBuffer()],
    registryProgramId
  );
}

export function dispatcherStatePda(dispatcherProgramId: PublicKey): [PublicKey, number] {
  return findPda([SEEDS.DISPATCHER_STATE], dispatcherProgramId);
}

export function dispatcherUserPositionPda(
  dispatcherProgramId: PublicKey,
  user: PublicKey,
  adapterProgram: PublicKey
): [PublicKey, number] {
  return findPda(
    [SEEDS.USER_POSITION, user.toBuffer(), adapterProgram.toBuffer()],
    dispatcherProgramId
  );
}

export function adapterUserPositionPda(
  adapterProgramId: PublicKey,
  user: PublicKey
): [PublicKey, number] {
  return findPda(
    [SEEDS.ADAPTER_POSITION, user.toBuffer()],
    adapterProgramId
  );
}

export function adapterVaultStatePda(
  adapterProgramId: PublicKey,
  seed: Buffer
): [PublicKey, number] {
  return findPda([seed], adapterProgramId);
}

export function adapterVaultAuthorityPda(
  adapterProgramId: PublicKey,
  seed: Buffer
): [PublicKey, number] {
  return findPda([seed], adapterProgramId);
}
