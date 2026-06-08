import { PublicKey } from "@solana/web3.js";

export const MAINNET_USDC_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);

export const SYRUP_USDC_MINT = new PublicKey(
  "AvZZF1YaZDziPY2RCK4oJrRVrbN3mTD9NL24hPeaZeUj"
);

export const KAMINO_PROGRAM_ID = new PublicKey(
  "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"
);

export const MARGINFI_PROGRAM_ID = new PublicKey(
  "MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA"
);

export const DRIFT_PROGRAM_ID = new PublicKey(
  "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH"
);

export const JUPITER_PERPS_PROGRAM_ID = new PublicKey(
  "PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu"
);

export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

export const SYSTEM_PROGRAM_ID = new PublicKey(
  "11111111111111111111111111111111"
);

export const SEEDS = {
  REGISTRY_STATE: Buffer.from("registry_state"),
  ADAPTER_ENTRY: Buffer.from("adapter_entry"),
  DISPATCHER_STATE: Buffer.from("dispatcher_state"),
  USER_POSITION: Buffer.from("user_position"),
  ADAPTER_POSITION: Buffer.from("adapter_position"),
  VAULT_AUTHORITY: Buffer.from("vault_authority"),
} as const;

export const ADAPTER_VAULT_SEEDS: Record<string, Buffer> = {
  kamino: Buffer.from("kamino_vault_state"),
  marginfi: Buffer.from("marginfi_vault_state"),
  jupiter: Buffer.from("jupiter_vault_state"),
  maple: Buffer.from("maple_vault_state"),
  drift: Buffer.from("drift_vault_state"),
} as const;

export const ADAPTER_VAULT_AUTHORITY_SEEDS: Record<string, Buffer> = {
  kamino: Buffer.from("kamino_vault_authority"),
  marginfi: Buffer.from("marginfi_vault_authority"),
  jupiter: Buffer.from("jupiter_vault_authority"),
  maple: Buffer.from("maple_vault_authority"),
  drift: Buffer.from("drift_vault_authority"),
} as const;

export const ADAPTER_NAMES = [
  "kamino",
  "marginfi",
  "jupiter",
  "maple",
  "drift",
] as const;

export type AdapterName = (typeof ADAPTER_NAMES)[number];

export function isMainnetFork(): boolean {
  return process.env.MAINNET_FORK === "1";
}

export function protocolProgramForAdapter(adapterName: AdapterName): PublicKey {
  const map: Record<AdapterName, PublicKey> = {
    kamino: KAMINO_PROGRAM_ID,
    marginfi: MARGINFI_PROGRAM_ID,
    jupiter: JUPITER_PERPS_PROGRAM_ID,
    maple: SYRUP_USDC_MINT,
    drift: DRIFT_PROGRAM_ID,
  };
  return map[adapterName];
}
