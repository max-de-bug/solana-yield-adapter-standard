import {
  getAccount,
  getMint,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "./constants";

export interface VaultStateAccount {
  authority: PublicKey;
  underlyingMint: PublicKey;
  totalUnderlying: bigint;
  totalShares: bigint;
  status: Record<string, unknown>;
  bump: number;
}

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

export interface DispatcherStateAccount {
  authority: PublicKey;
  registryProgramId: PublicKey;
  totalDeposits: bigint;
  isPaused: boolean;
}

export interface RegistryStateAccount {
  authority: PublicKey;
  totalProposed: bigint;
  totalApproved: bigint;
}

export interface AdapterEntryAccount {
  name: string;
  adapterProgramId: PublicKey;
  underlyingMint: PublicKey;
  status: Record<string, unknown>;
  proposedAt: bigint;
  approvedAt: bigint;
  revokedAt: bigint;
}

export async function fetchVaultState(
  connection: Connection,
  program: { account: { vaultState: { fetch: (pda: PublicKey) => Promise<unknown> } } },
  vaultStatePda: PublicKey
): Promise<VaultStateAccount> {
  return program.account.vaultState.fetch(vaultStatePda) as Promise<VaultStateAccount>;
}

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

export async function fetchDispatcherState(
  connection: Connection,
  program: { account: { dispatcherState: { fetch: (pda: PublicKey) => Promise<unknown> } } },
  pda: PublicKey
): Promise<DispatcherStateAccount> {
  return program.account.dispatcherState.fetch(pda) as Promise<DispatcherStateAccount>;
}

export async function fetchRegistryState(
  connection: Connection,
  program: { account: { registryState: { fetch: (pda: PublicKey) => Promise<unknown> } } },
  pda: PublicKey
): Promise<RegistryStateAccount> {
  return program.account.registryState.fetch(pda) as Promise<RegistryStateAccount>;
}

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

export async function getTokenBalance(
  connection: Connection,
  tokenAccount: PublicKey
): Promise<bigint> {
  const account = await getAccount(connection, tokenAccount, undefined, TOKEN_PROGRAM_ID);
  return account.amount;
}

export async function getTokenMintDecimals(
  connection: Connection,
  mint: PublicKey
): Promise<number> {
  const mintInfo = await getMint(connection, mint, undefined, TOKEN_PROGRAM_ID);
  return mintInfo.decimals;
}

export function associatedTokenAddress(
  mint: PublicKey,
  owner: PublicKey
): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner);
}
