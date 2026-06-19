import { PublicKey } from "@solana/web3.js";
import { SEEDS } from "./constants";

/** Generic PDA finder wrapping `PublicKey.findProgramAddressSync`. */
export function findPda(
  seeds: Buffer[],
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(seeds, programId);
}

/** Returns the [PDA, bump] for the registry singleton state account. */
export function registryStatePda(registryProgramId: PublicKey): [PublicKey, number] {
  return findPda([SEEDS.REGISTRY_STATE], registryProgramId);
}

/** Returns the [PDA, bump] for a specific adapter's entry in the registry. */
export function adapterEntryPda(
  registryProgramId: PublicKey,
  adapterProgramId: PublicKey
): [PublicKey, number] {
  return findPda(
    [SEEDS.ADAPTER_ENTRY, adapterProgramId.toBuffer()],
    registryProgramId
  );
}

/** Returns the [PDA, bump] for the dispatcher singleton state account. */
export function dispatcherStatePda(dispatcherProgramId: PublicKey): [PublicKey, number] {
  return findPda([SEEDS.DISPATCHER_STATE], dispatcherProgramId);
}

/** Returns the [PDA, bump] for a user's position within the dispatcher for a given adapter. */
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

/** Returns the [PDA, bump] for a user's position within a specific adapter program. */
export function adapterUserPositionPda(
  adapterProgramId: PublicKey,
  user: PublicKey
): [PublicKey, number] {
  return findPda(
    [SEEDS.ADAPTER_POSITION, user.toBuffer()],
    adapterProgramId
  );
}

/** Returns the [PDA, bump] for an adapter's vault state account. */
export function adapterVaultStatePda(
  adapterProgramId: PublicKey,
  seed: Buffer
): [PublicKey, number] {
  return findPda([seed], adapterProgramId);
}

/** Returns the [PDA, bump] for an adapter's vault authority account. */
export function adapterVaultAuthorityPda(
  adapterProgramId: PublicKey,
  seed: Buffer
): [PublicKey, number] {
  return findPda([seed], adapterProgramId);
}
