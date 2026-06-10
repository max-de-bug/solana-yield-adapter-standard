import { Program } from "@anchor-lang/core";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { SEEDS } from "./constants";
import { findPda, registryStatePda, adapterEntryPda } from "./pda";
import { fetchRegistryState, fetchAdapterEntry } from "./accounts";

export class RegistryClient {
  constructor(
    readonly program: Program,
    readonly provider: any
  ) {}

  programId(): PublicKey {
    return this.program.programId;
  }

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
