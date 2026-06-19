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

/** High-level client for interacting with the yield-dispatcher program.
 *
 * Routes deposits, withdrawals, and current-value queries through the
 * registered adapter via CPI, enforcing registry gating and the circuit breaker.
 *
 * @example
 * ```typescript
 * const dispatcher = new DispatcherClient(program, provider);
 * await dispatcher.ensureInitialized(authority.publicKey, registryProgramId);
 * await dispatcher.deposit(user, amount, minSharesOut, registryProgramId,
 *   adapterProgramId, adapterEntryPda, accounts);
 * ``` */
export class DispatcherClient {
  constructor(
    readonly program: Program,
    readonly provider: any
  ) {}

  /** Returns the dispatcher program ID. */
  programId(): PublicKey {
    return this.program.programId;
  }

  /** Initializes the dispatcher singleton if not already deployed. Idempotent (no-op if already exists). Returns the dispatcher state PDA. */
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

  /** Deposits an amount of underlying tokens into the given adapter through the dispatcher.
   *
   * The dispatcher validates the adapter is Approved in the registry, then CPI-calls
   * the adapter's deposit instruction. */
  async deposit(
    user: PublicKey,
    amount: BN,
    minSharesOut: BN,
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
      .deposit(amount, minSharesOut)
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

  /** Withdraws shares from the given adapter through the dispatcher. */
  async withdraw(
    user: PublicKey,
    shares: BN,
    minUnderlyingOut: BN,
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
      .withdraw(shares, minUnderlyingOut)
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

  /** Queries the current value of a user's position through the dispatcher. */
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
