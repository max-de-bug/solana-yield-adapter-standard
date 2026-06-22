import { PublicKey } from "@solana/web3.js";
import { findPda } from "./pda";

export const REGISTRY_STATE_SEED = Buffer.from("registry_state");
export const ADAPTER_ENTRY_SEED = Buffer.from("adapter_entry");

export function registryStatePda(registryId: PublicKey): PublicKey {
  return findPda([REGISTRY_STATE_SEED], registryId)[0];
}

export function adapterEntryPda(registryId: PublicKey, adapterProgramId: PublicKey): PublicKey {
  return findPda([ADAPTER_ENTRY_SEED, adapterProgramId.toBuffer()], registryId)[0];
}
