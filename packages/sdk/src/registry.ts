import { Program } from "@anchor-lang/core";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { SEEDS } from "./constants";
import { findPda, registryStatePda, adapterEntryPda } from "./pda";
import { fetchRegistryState, fetchAdapterEntry } from "./accounts";

/** High-level client for interacting with the on-chain adapter registry.
 *
 * Supports the full governance lifecycle: propose → approve → revoke
 * and two-step governance transfer (nominate → accept).
 *
 * @example
 * ```typescript
 * const registry = new RegistryClient(program, provider);
 * const entryPda = await registry.proposeAndApprove(
 *   authority.publicKey,
 *   adapterProgramId,
 *   underlyingMint,
 *   "my-adapter",
 *   "https://metadata.uri",
 *   "my_vault_state"
 * );
 * ``` */
export class RegistryClient {
  constructor(
    readonly program: Program,
    readonly provider: any
  ) {}

  /** Returns the registry program ID. */
  programId(): PublicKey {
    return this.program.programId;
  }

  /** Initializes the registry singleton if not already deployed. Idempotent (no-op if already exists). Returns the registry state PDA. */
  async ensureInitialized(authority: PublicKey): Promise<PublicKey> {
    const [pda] = registryStatePda(this.program.programId);
    try {
      await this.program.methods
        .initialize()
        .accounts({
          authority,
          registryState: pda,
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

  /** Proposes a new adapter in the registry. Skips if the adapter entry already exists. Returns the adapter entry PDA. */
  async proposeAdapter(
    authority: PublicKey,
    adapterProgramId: PublicKey,
    underlyingMint: PublicKey,
    name: string,
    metadataUri: string,
    vaultStateSeed: string,
    registryStatePda?: PublicKey
  ): Promise<PublicKey> {
    const [entryPda] = adapterEntryPda(this.program.programId, adapterProgramId);
    const regPda = registryStatePda ?? (await this.ensureInitialized(authority));

    const existing = await fetchAdapterEntry(
      this.provider.connection,
      this.program as any,
      entryPda
    );
    if (existing) return entryPda;

    await this.program.methods
      .proposeAdapter(name, metadataUri, vaultStateSeed)
      .accounts({
        proposer: authority,
        registryState: regPda,
        adapterEntry: entryPda,
        adapterProgram: adapterProgramId,
        underlyingMint,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return entryPda;
  }

  /** Approves a proposed adapter (authority or guardian only). Returns the adapter entry PDA. */
  async approveAdapter(
    authority: PublicKey,
    adapterProgramId: PublicKey,
    registryStatePda?: PublicKey
  ): Promise<PublicKey> {
    const [entryPda] = adapterEntryPda(this.program.programId, adapterProgramId);
    const regPda = registryStatePda ?? (await this.ensureInitialized(authority));

    await this.program.methods
      .approveAdapter()
      .accounts({
        authority,
        registryState: regPda,
        adapterEntry: entryPda,
      })
      .rpc();

    return entryPda;
  }

  /** Proposes and approves an adapter in a single call (convenience for tests). */
  async proposeAndApprove(
    authority: PublicKey,
    adapterProgramId: PublicKey,
    underlyingMint: PublicKey,
    name: string,
    metadataUri: string,
    vaultStateSeed: string
  ): Promise<PublicKey> {
    const regPda = await this.ensureInitialized(authority);
    await this.proposeAdapter(
      authority,
      adapterProgramId,
      underlyingMint,
      name,
      metadataUri,
      vaultStateSeed,
      regPda
    );
    return this.approveAdapter(authority, adapterProgramId, regPda);
  }

  /** Revokes a previously approved adapter (authority only). */
  async revokeAdapter(
    authority: PublicKey,
    adapterProgramId: PublicKey
  ): Promise<void> {
    const [regPda] = registryStatePda(this.program.programId);
    const [entryPda] = adapterEntryPda(this.program.programId, adapterProgramId);

    await this.program.methods
      .revokeAdapter()
      .accounts({
        authority,
        registryState: regPda,
        adapterEntry: entryPda,
      })
      .rpc();
  }

  /** Nominates a new governance authority (current authority must sign). Two-step transfer: nominate → accept. */
  async nominateGovernance(
    authority: PublicKey,
    newAuthority: PublicKey,
    registryStatePda?: PublicKey
  ): Promise<void> {
    const regPda = registryStatePda ?? (await this.ensureInitialized(authority));

    await this.program.methods
      .nominateGovernance()
      .accounts({
        authority,
        registryState: regPda,
        newAuthority,
      })
      .rpc();
  }

  /** Accepts a pending governance nomination (new authority signs). */
  async acceptGovernance(
    signer: PublicKey,
    registryStatePda?: PublicKey
  ): Promise<void> {
    const regPda = registryStatePda ?? (await this.ensureInitialized(signer));

    await this.program.methods
      .acceptGovernance()
      .accounts({
        signer,
        registryState: regPda,
      })
      .rpc();
  }
}
