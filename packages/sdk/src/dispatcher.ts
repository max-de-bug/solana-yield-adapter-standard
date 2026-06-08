import { Program } from "@anchor-lang/core";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";
import { SEEDS, TOKEN_PROGRAM_ID, isMainnetFork, protocolProgramForAdapter } from "./constants";
import {
  dispatcherStatePda,
  dispatcherUserPositionPda,
  adapterEntryPda,
} from "./pda";
import type { AdapterName } from "./constants";

export class DispatcherClient {
  constructor(
    readonly program: Program,
    readonly provider: any
  ) {}

  programId(): PublicKey {
    return this.program.programId;
  }

  async ensureInitialized(
    authority: PublicKey,
    registryProgramId: PublicKey
  ): Promise<PublicKey> {
    const [pda] = dispatcherStatePda(this.program.programId);
    try {
      await this.program.methods
        .initialize()
        .accounts({
          authority,
          dispatcherState: pda,
          registryProgram: registryProgramId,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (e: unknown) {
      const msg = String(e);
      if (!msg.includes("already in use") && !msg.includes("0x0")) {
        throw e;
      }
    }
    return pda;
  }

  async deposit(
    user: PublicKey,
    amount: BN,
    registryProgramId: PublicKey,
    adapterProgramId: PublicKey,
    adapterEntryPda: PublicKey,
    accounts: {
      userTokenAccount: PublicKey;
      adapterVaultState: PublicKey;
      adapterVault: PublicKey;
      adapterVaultAuthority: PublicKey;
      adapterUserPosition: PublicKey;
    },
    dispatcherState?: PublicKey
  ): Promise<void> {
    const [statePda] = dispatcherState
      ? [dispatcherState]
      : dispatcherStatePda(this.program.programId);

    const builder = this.program.methods
      .deposit(amount)
      .accounts({
        user,
        dispatcherState: statePda,
        userPosition: dispatcherUserPositionPda(
          this.program.programId,
          user,
          adapterProgramId
        )[0],
        registryProgram: registryProgramId,
        adapterEntry: adapterEntryPda,
        adapterProgram: adapterProgramId,
        userTokenAccount: accounts.userTokenAccount,
        adapterVaultState: accounts.adapterVaultState,
        adapterVault: accounts.adapterVault,
        adapterVaultAuthority: accounts.adapterVaultAuthority,
        adapterUserPosition: accounts.adapterUserPosition,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      });

    await builder.rpc();
  }

  async withdraw(
    user: PublicKey,
    shares: BN,
    registryProgramId: PublicKey,
    adapterProgramId: PublicKey,
    adapterEntryPda: PublicKey,
    accounts: {
      userTokenAccount: PublicKey;
      adapterVaultState: PublicKey;
      adapterVault: PublicKey;
      adapterVaultAuthority: PublicKey;
      adapterUserPosition: PublicKey;
    },
    dispatcherState?: PublicKey
  ): Promise<void> {
    const [statePda] = dispatcherState
      ? [dispatcherState]
      : dispatcherStatePda(this.program.programId);

    await this.program.methods
      .withdraw(shares)
      .accounts({
        user,
        dispatcherState: statePda,
        userPosition: dispatcherUserPositionPda(
          this.program.programId,
          user,
          adapterProgramId
        )[0],
        registryProgram: registryProgramId,
        adapterEntry: adapterEntryPda,
        adapterProgram: adapterProgramId,
        userTokenAccount: accounts.userTokenAccount,
        adapterVaultState: accounts.adapterVaultState,
        adapterVault: accounts.adapterVault,
        adapterVaultAuthority: accounts.adapterVaultAuthority,
        adapterUserPosition: accounts.adapterUserPosition,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  async currentValue(
    user: PublicKey,
    adapterProgramId: PublicKey
  ): Promise<void> {
    const [statePda] = dispatcherStatePda(this.program.programId);

    await this.program.methods
      .currentValue()
      .accounts({
        user,
        dispatcherState: statePda,
        userPosition: dispatcherUserPositionPda(
          this.program.programId,
          user,
          adapterProgramId
        )[0],
      })
      .rpc();
  }
}
