import { Program } from "@anchor-lang/core";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  transfer,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "fs";
import * as path from "path";

import {
  MAINNET_USDC_MINT,
  SYRUP_USDC_MINT,
  TOKEN_PROGRAM_ID as TOKEN_PROG,
  isMainnetFork,
  SEEDS,
  ADAPTER_VAULT_SEEDS,
  ADAPTER_VAULT_AUTHORITY_SEEDS,
  AdapterName,
} from "./constants";
import {
  findPda,
  adapterVaultStatePda,
  adapterVaultAuthorityPda,
  adapterUserPositionPda,
} from "./pda";
import {
  createTestMint,
  createTokenAccount,
  mintTestTokens,
  airdrop,
} from "./token";
import { getTokenBalance } from "./accounts";

/** Options for configuring a deposit/withdraw flow in {@link runAdapterDepositWithdrawFlow}. */
export interface AdapterFlowOptions {
  program: Program;
  adapterName: AdapterName;
  depositAmount?: number;
  withdrawShares?: number;
  underlyingMint?: PublicKey;
}

/** High-level client for interacting with a single yield adapter program.
 *
 * Derives vault PDAs from the adapter name, handles idempotent initialization,
 * and resolves the correct underlying mint for localnet vs mainnet fork.
 *
 * @example
 * ```typescript
 * const adapter = new AdapterClient(program, provider, "kamino");
 * await adapter.initializeVault(authority.publicKey, underlyingMint);
 * const vaultToken = await adapter.createVaultTokenAccount(connection, payer, underlyingMint);
 * ``` */
export class AdapterClient {
  constructor(
    readonly program: Program,
    readonly provider: any,
    readonly adapterName: AdapterName
  ) {}

  /** Returns the adapter program ID. */
  programId(): PublicKey {
    return this.program.programId;
  }

  /** Returns the PDA seed for this adapter's vault state. */
  vaultStateSeed(): Buffer {
    return ADAPTER_VAULT_SEEDS[this.adapterName];
  }

  /** Returns the PDA seed for this adapter's vault authority. */
  vaultAuthoritySeed(): Buffer {
    return ADAPTER_VAULT_AUTHORITY_SEEDS[this.adapterName];
  }

  /** Returns the [PDA, bump] for this adapter's vault state account. */
  vaultStatePda(): [PublicKey, number] {
    return adapterVaultStatePda(this.program.programId, this.vaultStateSeed());
  }

  /** Returns the [PDA, bump] for this adapter's vault authority account. */
  vaultAuthorityPda(): [PublicKey, number] {
    return adapterVaultAuthorityPda(
      this.program.programId,
      this.vaultAuthoritySeed()
    );
  }

  /** Returns the [PDA, bump] for a user's position within this adapter. */
  userPositionPda(user: PublicKey): [PublicKey, number] {
    return adapterUserPositionPda(this.program.programId, user);
  }

  /** Initializes the vault for this adapter. Idempotent — silently skips if the vault state already exists. */
  async initializeVault(
    authority: PublicKey,
    underlyingMint: PublicKey
  ): Promise<void> {
    const [vaultState] = this.vaultStatePda();
    try {
      await this.program.methods
        .initialize(underlyingMint)
        .accounts({
          authority,
          vaultState,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (e: unknown) {
      const msg = String(e);
      if (!msg.includes("already in use") && !msg.includes("0x0")) {
        throw e;
      }
    }
  }

  /** Creates an associated token account for the vault (under PDA authority). Returns the token account address. */
  async createVaultTokenAccount(
    connection: Connection,
    payer: Keypair,
    underlyingMint: PublicKey
  ): Promise<PublicKey> {
    const [, vaultAuthorityBump] = this.vaultAuthorityPda();
    const [vaultAuthority] = this.vaultAuthorityPda();
    const account = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      underlyingMint,
      vaultAuthority,
      true
    );
    return account.address;
  }

  /** Resolves the underlying mint: returns mainnet USDC (or syrupUSDC for Maple) on fork, or creates a test mint on localnet. */
  async resolveUnderlyingMint(
    connection: Connection,
    payer: Keypair
  ): Promise<PublicKey> {
    if (isMainnetFork()) {
      return this.adapterName === "maple" ? SYRUP_USDC_MINT : MAINNET_USDC_MINT;
    }
    return createTestMint(connection, payer, 6);
  }
}
