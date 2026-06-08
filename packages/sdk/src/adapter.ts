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

export interface AdapterFlowOptions {
  program: Program;
  adapterName: AdapterName;
  depositAmount?: number;
  withdrawShares?: number;
  underlyingMint?: PublicKey;
}

export class AdapterClient {
  constructor(
    readonly program: Program,
    readonly provider: any,
    readonly adapterName: AdapterName
  ) {}

  programId(): PublicKey {
    return this.program.programId;
  }

  vaultStateSeed(): Buffer {
    return ADAPTER_VAULT_SEEDS[this.adapterName];
  }

  vaultAuthoritySeed(): Buffer {
    return ADAPTER_VAULT_AUTHORITY_SEEDS[this.adapterName];
  }

  vaultStatePda(): [PublicKey, number] {
    return adapterVaultStatePda(this.program.programId, this.vaultStateSeed());
  }

  vaultAuthorityPda(): [PublicKey, number] {
    return adapterVaultAuthorityPda(
      this.program.programId,
      this.vaultAuthoritySeed()
    );
  }

  userPositionPda(user: PublicKey): [PublicKey, number] {
    return adapterUserPositionPda(this.program.programId, user);
  }

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
