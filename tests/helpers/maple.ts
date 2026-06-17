import * as anchor from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import {
  ORCA_PROGRAM_ID,
  SYRUP_USDC_WHIRLPOOL,
  SYRUP_CHAINLINK_FEED,
  isMainnetFork,
} from "./constants";

/**
 * Build remaining accounts for Maple Orca swap deposit/withdraw.
 *
 * On fork, fetches the whirlpool state to derive vaults and tick arrays dynamically.
 * On localnet, returns empty (no swap performed).
 *
 * Layout (8 accounts):
 *   0: vault_syrup (w)
 *   1: whirlpool (w)
 *   2: token_vault_a (w) — pool syrupUSDC vault
 *   3: token_vault_b (w) — pool USDC vault
 *   4: tick_array_0 (w)
 *   5: tick_array_1 (w)
 *   6: tick_array_2 (w)
 *   7: oracle
 */
export async function buildMapleSwapAccounts(
  connection: anchor.web3.Connection,
  vaultSyrupPda: PublicKey
): Promise<{ pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[]> {
  if (!isMainnetFork()) {
    return [];
  }

  const poolInfo = await connection.getAccountInfo(SYRUP_USDC_WHIRLPOOL);
  if (!poolInfo) {
    return [];
  }

  const data = poolInfo.data;
  const tickCurrentIndex = new Int32Array(
    new Uint8Array(data.slice(49, 53)).buffer
  )[0];
  const tokenVaultA = new PublicKey(data.slice(133, 165));
  const tokenVaultB = new PublicKey(data.slice(165, 197));
  const oracle = new PublicKey(data.slice(197, 229));

  const tickSpacing = 64;
  const TICK_ARRAY_SIZE = 88;
  const ticksPerArray = tickSpacing * TICK_ARRAY_SIZE;
  const tickArrayIndex = Math.floor(tickCurrentIndex / ticksPerArray);

  const tickArrays: PublicKey[] = [];
  for (const offset of [-1, 0, 1]) {
    const idx = tickArrayIndex + offset;
    const seed = Buffer.alloc(8);
    seed.writeBigInt64LE(BigInt(idx), 0);
    const [pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("tick_array"),
        SYRUP_USDC_WHIRLPOOL.toBuffer(),
        seed,
      ],
      ORCA_PROGRAM_ID
    );
    tickArrays.push(pda);
  }

  return [
    { pubkey: vaultSyrupPda, isSigner: false, isWritable: true },
    { pubkey: SYRUP_USDC_WHIRLPOOL, isSigner: false, isWritable: true },
    { pubkey: tokenVaultA, isSigner: false, isWritable: true },
    { pubkey: tokenVaultB, isSigner: false, isWritable: true },
    { pubkey: tickArrays[0], isSigner: false, isWritable: true },
    { pubkey: tickArrays[1], isSigner: false, isWritable: true },
    { pubkey: tickArrays[2], isSigner: false, isWritable: true },
    { pubkey: oracle, isSigner: false, isWritable: false },
  ];
}

/**
 * Build remaining accounts for Maple current_value (just chainlink feed).
 */
export function buildMapleCurrentValueAccounts(): {
  pubkey: PublicKey;
  isSigner: boolean;
  isWritable: boolean;
}[] {
  if (!isMainnetFork()) {
    return [];
  }
  return [
    { pubkey: SYRUP_CHAINLINK_FEED, isSigner: false, isWritable: false },
  ];
}
