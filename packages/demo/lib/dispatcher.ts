import { PublicKey } from "@solana/web3.js";
import { findPda } from "./pda";

export const DISPATCHER_STATE_SEED = Buffer.from("dispatcher_state");
export const USER_POSITION_SEED = Buffer.from("user_position");

export function dispatcherStatePda(dispatcherId: PublicKey): PublicKey {
  return findPda([DISPATCHER_STATE_SEED], dispatcherId)[0];
}

export function dispatcherUserPositionPda(
  dispatcherId: PublicKey,
  user: PublicKey,
  adapterProgramId: PublicKey,
): PublicKey {
  return findPda([USER_POSITION_SEED, user.toBuffer(), adapterProgramId.toBuffer()], dispatcherId)[0];
}
