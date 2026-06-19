import { PublicKey } from "@solana/web3.js";

/** Mainnet USDC mint address (used on mainnet fork tests). */
export const MAINNET_USDC_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);

/** syrupUSDC mint address (used by Maple adapter on mainnet fork). */
export const SYRUP_USDC_MINT = new PublicKey(
  "AvZZF1YaZDziPY2RCK4oJrRVrbN3mTD9NL24hPeaZeUj"
);

/** Kamino Lend v2 program ID. */
export const KAMINO_PROGRAM_ID = new PublicKey(
  "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"
);

/** MarginFi v2 program ID. */
export const MARGINFI_PROGRAM_ID = new PublicKey(
  "MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA"
);

/** Drift v2 program ID. */
export const DRIFT_PROGRAM_ID = new PublicKey(
  "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH"
);

/** Jupiter Perps (JLP) program ID. */
export const JUPITER_PERPS_PROGRAM_ID = new PublicKey(
  "PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu"
);

/** Orca Whirlpools program ID (used by Maple adapter for USDC→syrupUSDC swap). */
export const ORCA_PROGRAM_ID = new PublicKey(
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"
);

/** syrupUSDC / USDC Whirlpool address on mainnet. */
export const SYRUP_USDC_WHIRLPOOL = new PublicKey(
  "6fteKNvMdv7tYmBoJHhj1jx6rHcEwC6RdSEmVpyS613J"
);

/** Chainlink oracle feed for syrupUSDC price (used by Maple adapter). */
export const SYRUP_CHAINLINK_FEED = new PublicKey(
  "CpNyiFt84q66665Kx64bobxZuMgZ2EecrhAJs1HikS2T"
);

/** SPL Associated Token Account program ID. */
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

/** SPL Token program ID. */
export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

/** System program ID. */
export const SYSTEM_PROGRAM_ID = new PublicKey(
  "11111111111111111111111111111111"
);

/** Canonical PDA seed buffers used across all programs. */
export const SEEDS = {
  REGISTRY_STATE: Buffer.from("registry_state"),
  ADAPTER_ENTRY: Buffer.from("adapter_entry"),
  DISPATCHER_STATE: Buffer.from("dispatcher_state"),
  USER_POSITION: Buffer.from("user_position"),
  ADAPTER_POSITION: Buffer.from("adapter_position"),
  VAULT_AUTHORITY: Buffer.from("vault_authority"),
} as const;

/** Per-adapter vault state PDA seeds. */
export const ADAPTER_VAULT_SEEDS: Record<string, Buffer> = {
  kamino: Buffer.from("kamino_vault_state"),
  marginfi: Buffer.from("marginfi_vault_state"),
  jupiter: Buffer.from("jupiter_vault_state"),
  maple: Buffer.from("maple_vault_state"),
  drift: Buffer.from("drift_vault_state"),
  template: Buffer.from("template_vault_state"),
} as const;

/** Per-adapter vault authority PDA seeds. */
export const ADAPTER_VAULT_AUTHORITY_SEEDS: Record<string, Buffer> = {
  kamino: Buffer.from("kamino_vault_authority"),
  marginfi: Buffer.from("marginfi_vault_authority"),
  jupiter: Buffer.from("jupiter_vault_authority"),
  maple: Buffer.from("maple_vault_authority"),
  drift: Buffer.from("drift_vault_authority"),
  template: Buffer.from("template_vault_authority"),
} as const;

/** Per-adapter syrup vault PDA seeds (only Maple uses syrup). */
export const ADAPTER_VAULT_SYRUP_SEEDS: Record<string, Buffer> = {
  maple: Buffer.from("maple_vault_syrup"),
} as const;

/** Ordered list of all adapter names. */
export const ADAPTER_NAMES = [
  "kamino",
  "marginfi",
  "jupiter",
  "maple",
  "drift",
  "template",
] as const;

/** Union type of all adapter names. */
export type AdapterName = (typeof ADAPTER_NAMES)[number];

/** Returns true when running against a mainnet fork (Surfpool or solana-test-validator with --clone). */
export function isMainnetFork(): boolean {
  return process.env.MAINNET_FORK === "1";
}

/** Returns the protocol program ID associated with a given adapter name. */
export function protocolProgramForAdapter(adapterName: AdapterName): PublicKey {
  const map: Record<AdapterName, PublicKey> = {
    kamino: KAMINO_PROGRAM_ID,
    marginfi: MARGINFI_PROGRAM_ID,
    jupiter: JUPITER_PERPS_PROGRAM_ID,
    maple: ORCA_PROGRAM_ID,
    drift: DRIFT_PROGRAM_ID,
    template: PublicKey.default,
  };
  return map[adapterName];
}
