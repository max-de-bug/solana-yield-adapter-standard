import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { expect } from "chai";
import {
  airdrop,
  createTestMint,
  createTestTokenAccount,
  mintTestTokens,
  getTokenBalance,
  findPda,
} from "./helpers";

describe("adapter-registry", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AdapterRegistry as Program;
  const authority = provider.wallet as anchor.Wallet;
  let registryStatePda: PublicKey;
  let registryBump: number;

  before(async () => {
    [registryStatePda, registryBump] = findPda(
      [Buffer.from("registry_state")],
      program.programId
    );
  });

  it("initializes the registry", async () => {
    try {
      await program.methods
        .initialize()
        .accounts({
          authority: authority.publicKey,
          registryState: registryStatePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (e: unknown) {
      const msg = String(e);
      if (!msg.includes("already in use") && !msg.includes("0x0")) {
        throw e;
      }
    }

    const state = await program.account.registryState.fetch(registryStatePda);
    expect(state.authority.toString()).to.equal(authority.publicKey.toString());
    expect(state.totalProposed.toNumber()).to.be.at.least(0);
    expect(state.totalApproved.toNumber()).to.be.at.least(0);
  });

  it("proposes an adapter", async () => {
    const adapterProgram = Keypair.generate();
    const underlyingMint = Keypair.generate();

    const [adapterEntryPda] = findPda(
      [Buffer.from("adapter_entry"), adapterProgram.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .proposeAdapter("Test Adapter", "https://example.com/metadata.json")
      .accounts({
        proposer: authority.publicKey,
        registryState: registryStatePda,
        adapterEntry: adapterEntryPda,
        adapterProgram: adapterProgram.publicKey,
        underlyingMint: underlyingMint.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const entry = await program.account.adapterEntry.fetch(adapterEntryPda);
    expect(entry.name).to.equal("Test Adapter");
    expect(entry.status).to.deep.equal({ proposed: {} });
    expect(entry.adapterProgramId.toString()).to.equal(
      adapterProgram.publicKey.toString()
    );

    const state = await program.account.registryState.fetch(registryStatePda);
    expect(state.totalProposed.toNumber()).to.be.greaterThan(0);
  });

  it("approves a proposed adapter", async () => {
    const adapterProgram = Keypair.generate();
    const underlyingMint = Keypair.generate();

    const [adapterEntryPda] = findPda(
      [Buffer.from("adapter_entry"), adapterProgram.publicKey.toBuffer()],
      program.programId
    );

    // First propose
    await program.methods
      .proposeAdapter("Approved Adapter", "https://example.com/meta.json")
      .accounts({
        proposer: authority.publicKey,
        registryState: registryStatePda,
        adapterEntry: adapterEntryPda,
        adapterProgram: adapterProgram.publicKey,
        underlyingMint: underlyingMint.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Then approve
    await program.methods
      .approveAdapter()
      .accounts({
        authority: authority.publicKey,
        registryState: registryStatePda,
        adapterEntry: adapterEntryPda,
      })
      .rpc();

    const entry = await program.account.adapterEntry.fetch(adapterEntryPda);
    expect(entry.status).to.deep.equal({ approved: {} });
    expect(entry.approvedAt.toNumber()).to.be.greaterThan(0);
  });

  it("revokes an approved adapter", async () => {
    const adapterProgram = Keypair.generate();
    const underlyingMint = Keypair.generate();

    const [adapterEntryPda] = findPda(
      [Buffer.from("adapter_entry"), adapterProgram.publicKey.toBuffer()],
      program.programId
    );

    // Propose then approve
    await program.methods
      .proposeAdapter("Revoke Target", "https://example.com/meta.json")
      .accounts({
        proposer: authority.publicKey,
        registryState: registryStatePda,
        adapterEntry: adapterEntryPda,
        adapterProgram: adapterProgram.publicKey,
        underlyingMint: underlyingMint.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await program.methods
      .approveAdapter()
      .accounts({
        authority: authority.publicKey,
        registryState: registryStatePda,
        adapterEntry: adapterEntryPda,
      })
      .rpc();

    // Revoke
    await program.methods
      .revokeAdapter()
      .accounts({
        authority: authority.publicKey,
        registryState: registryStatePda,
        adapterEntry: adapterEntryPda,
      })
      .rpc();

    const entry = await program.account.adapterEntry.fetch(adapterEntryPda);
    expect(entry.status).to.deep.equal({ revoked: {} });
    expect(entry.revokedAt.toNumber()).to.be.greaterThan(0);
  });

  it("rejects unauthorized approve attempts", async () => {
    const unauthorizedUser = Keypair.generate();
    await airdrop(provider.connection, unauthorizedUser.publicKey);

    const adapterProgram = Keypair.generate();
    const underlyingMint = Keypair.generate();

    const [adapterEntryPda] = findPda(
      [Buffer.from("adapter_entry"), adapterProgram.publicKey.toBuffer()],
      program.programId
    );

    // Propose first
    await program.methods
      .proposeAdapter("Unauth Test", "https://example.com/meta.json")
      .accounts({
        proposer: authority.publicKey,
        registryState: registryStatePda,
        adapterEntry: adapterEntryPda,
        adapterProgram: adapterProgram.publicKey,
        underlyingMint: underlyingMint.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Try to approve with unauthorized user
    try {
      await program.methods
        .approveAdapter()
        .accounts({
          authority: unauthorizedUser.publicKey,
          registryState: registryStatePda,
          adapterEntry: adapterEntryPda,
        })
        .signers([unauthorizedUser])
        .rpc();

      expect.fail("Should have thrown unauthorized error");
    } catch (err: any) {
      expect(err.toString()).to.contain("Unauthorized");
    }
  });

  it("transfers governance", async () => {
    const newAuthority = Keypair.generate();

    await program.methods
      .transferGovernance()
      .accounts({
        authority: authority.publicKey,
        registryState: registryStatePda,
        newAuthority: newAuthority.publicKey,
      })
      .rpc();

    const state = await program.account.registryState.fetch(registryStatePda);
    expect(state.authority.toString()).to.equal(
      newAuthority.publicKey.toString()
    );
  });
});
