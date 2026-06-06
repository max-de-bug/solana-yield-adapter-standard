import { PublicKey } from "@solana/web3.js";

/** Mainnet USDC mint. */
export const MAINNET_USDC_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);

/** Mainnet syrupUSDC (Maple Finance yield-bearing SPL token). */
export const SYRUP_USDC_MINT = new PublicKey(
  "AvZZF1YaZDziPY2RCK4oJrRVrbN3mTD9NL24hPeaZeUj"
);

/** Protocol program IDs cloned from mainnet in fork tests. */
export const KAMINO_PROGRAM_ID = new PublicKey(
  "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"
);
export const MARGINFI_PROGRAM_ID = new PublicKey(
  "MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA"
);
export const DRIFT_PROGRAM_ID = new PublicKey(
  "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH"
);

/** Jupiter Perpetuals program (JLP pool). */
export const JUPITER_PERPS_PROGRAM_ID = new PublicKey(
  "PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu"
);

export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

/** True when running against a mainnet-fork validator. */
export function isMainnetFork(): boolean {
  return process.env.MAINNET_FORK === "1";
}
