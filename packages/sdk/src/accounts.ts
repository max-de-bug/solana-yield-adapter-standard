import {
  getAccount,
  getMint,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "./constants";

/** On-chain layout of an adapter vault state account. */
export interface VaultStateAccount {
  authority: PublicKey;
  underlyingMint: PublicKey;
  totalUnderlying: bigint;
  totalShares: bigint;
  status: Record<string, unknown>;
  bump: number;
}

/** On-chain layout of a user's position within an adapter. */
export interface AdapterPositionAccount {
  owner: PublicKey;
  adapterProgramId: PublicKey;
  depositedAmount: bigint;
  withdrawnAmount: bigint;
  receiptTokenBalance: bigint;
  lastUpdated: bigint;
  lastWithdrawRequest: bigint;
  bump: number;
}

/** On-chain layout of the yield-dispatcher singleton state. */
export interface DispatcherStateAccount {
  authority: PublicKey;
  registryProgramId: PublicKey;
  totalDeposits: bigint;
  isPaused: boolean;
}

/** On-chain layout of the adapter-registry singleton state. */
export interface RegistryStateAccount {
  authority: PublicKey;
  totalProposed: bigint;
  totalApproved: bigint;
}

/** On-chain layout of a single adapter entry in the registry. */
export interface AdapterEntryAccount {
  name: string;
  adapterProgramId: PublicKey;
  underlyingMint: PublicKey;
  status: Record<string, unknown>;
  proposedAt: bigint;
  approvedAt: bigint;
  revokedAt: bigint;
}

/** Fetches an adapter vault state account from on-chain. */
export async function fetchVaultState(
  connection: Connection,
  program: { account: { vaultState: { fetch: (pda: PublicKey) => Promise<unknown> } } },
  vaultStatePda: PublicKey
): Promise<VaultStateAccount> {
  return program.account.vaultState.fetch(vaultStatePda) as Promise<VaultStateAccount>;
}

/** Fetches an adapter user position from on-chain, returning null if it does not exist. */
export async function fetchAdapterPosition(
  connection: Connection,
  program: { account: { adapterPosition?: { fetch: (pda: PublicKey) => Promise<unknown> } } },
  pda: PublicKey
): Promise<AdapterPositionAccount | null> {
  try {
    const acc = program.account.adapterPosition;
    if (!acc) return null;
    return (await acc.fetch(pda)) as AdapterPositionAccount;
  } catch {
    return null;
  }
}

/** Fetches the dispatcher state account from on-chain. */
export async function fetchDispatcherState(
  connection: Connection,
  program: { account: { dispatcherState: { fetch: (pda: PublicKey) => Promise<unknown> } } },
  pda: PublicKey
): Promise<DispatcherStateAccount> {
  return program.account.dispatcherState.fetch(pda) as Promise<DispatcherStateAccount>;
}

/** Fetches the registry state account from on-chain. */
export async function fetchRegistryState(
  connection: Connection,
  program: { account: { registryState: { fetch: (pda: PublicKey) => Promise<unknown> } } },
  pda: PublicKey
): Promise<RegistryStateAccount> {
  return program.account.registryState.fetch(pda) as Promise<RegistryStateAccount>;
}

/** Fetches a registry adapter entry from on-chain, returning null if it does not exist. */
export async function fetchAdapterEntry(
  connection: Connection,
  program: { account: { adapterEntry: { fetch: (pda: PublicKey) => Promise<unknown> } } },
  pda: PublicKey
): Promise<AdapterEntryAccount | null> {
  try {
    return (await program.account.adapterEntry.fetch(pda)) as AdapterEntryAccount;
  } catch {
    return null;
  }
}

/** Returns the token balance (as bigint) for a given SPL token account. */
export async function getTokenBalance(
  connection: Connection,
  tokenAccount: PublicKey
): Promise<bigint> {
  const account = await getAccount(connection, tokenAccount, undefined, TOKEN_PROGRAM_ID);
  return account.amount;
}

/** Returns the number of decimals for a given SPL mint. */
export async function getTokenMintDecimals(
  connection: Connection,
  mint: PublicKey
): Promise<number> {
  const mintInfo = await getMint(connection, mint, undefined, TOKEN_PROGRAM_ID);
  return mintInfo.decimals;
}

/** Derives the associated token account address for a given mint and owner. */
export function associatedTokenAddress(
  mint: PublicKey,
  owner: PublicKey
): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner);
}
