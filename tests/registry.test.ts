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
      .proposeAdapter("Test Adapter", "https://example.com/metadata.json", "test_vault_state", "vault_authority")
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
      .proposeAdapter("Approved Adapter", "https://example.com/meta.json", "test_vault_state", "vault_authority")
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
      .proposeAdapter("Revoke Target", "https://example.com/meta.json", "test_vault_state", "vault_authority")
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
      .proposeAdapter("Unauth Test", "https://example.com/meta.json", "test_vault_state", "vault_authority")
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

  it("sets a guardian", async () => {
    const guardian = Keypair.generate();
    await airdrop(provider.connection, guardian.publicKey);

    await program.methods
      .setGuardian(guardian.publicKey)
      .accounts({
        authority: authority.publicKey,
        registryState: registryStatePda,
      })
      .rpc();

    const state = await program.account.registryState.fetch(registryStatePda);
    expect(state.guardian.toString()).to.equal(guardian.publicKey.toString());
    expect(state.authority.toString()).to.equal(authority.publicKey.toString());
  });

  it("guardian can approve a proposed adapter", async () => {
    const guardian = anchor.web3.Keypair.generate();
    await airdrop(provider.connection, guardian.publicKey);

    // Set guardian
    await program.methods
      .setGuardian(guardian.publicKey)
      .accounts({
        authority: authority.publicKey,
        registryState: registryStatePda,
      })
      .rpc();

    const adapterProgram = Keypair.generate();
    const underlyingMint = Keypair.generate();

    const [adapterEntryPda] = findPda(
      [Buffer.from("adapter_entry"), adapterProgram.publicKey.toBuffer()],
      program.programId
    );

    // Propose first
    await program.methods
      .proposeAdapter("Guardian Approved", "https://example.com/meta.json", "test_vault_state", "vault_authority")
      .accounts({
        proposer: authority.publicKey,
        registryState: registryStatePda,
        adapterEntry: adapterEntryPda,
        adapterProgram: adapterProgram.publicKey,
        underlyingMint: underlyingMint.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Guardian approves (not authority)
    await program.methods
      .approveAdapter()
      .accounts({
        authority: guardian.publicKey,
        registryState: registryStatePda,
        adapterEntry: adapterEntryPda,
      })
      .signers([guardian])
      .rpc();

    const entry = await program.account.adapterEntry.fetch(adapterEntryPda);
    expect(entry.status).to.deep.equal({ approved: {} });
  });

  it("guardian can revoke an approved adapter", async () => {
    const guardian = anchor.web3.Keypair.generate();
    await airdrop(provider.connection, guardian.publicKey);

    await program.methods
      .setGuardian(guardian.publicKey)
      .accounts({
        authority: authority.publicKey,
        registryState: registryStatePda,
      })
      .rpc();

    const adapterProgram = Keypair.generate();
    const underlyingMint = Keypair.generate();

    const [adapterEntryPda] = findPda(
      [Buffer.from("adapter_entry"), adapterProgram.publicKey.toBuffer()],
      program.programId
    );

    // Propose then approve (as authority)
    await program.methods
      .proposeAdapter("Guardian Revoke", "https://example.com/meta.json", "test_vault_state", "vault_authority")
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

    // Guardian revokes
    await program.methods
      .revokeAdapter()
      .accounts({
        authority: guardian.publicKey,
        registryState: registryStatePda,
        adapterEntry: adapterEntryPda,
      })
      .signers([guardian])
      .rpc();

    const entry = await program.account.adapterEntry.fetch(adapterEntryPda);
    expect(entry.status).to.deep.equal({ revoked: {} });
  });

  it("clears the guardian via Pubkey.default()", async () => {
    // Set a guardian first
    const guardian = Keypair.generate();
    await airdrop(provider.connection, guardian.publicKey);

    await program.methods
      .setGuardian(guardian.publicKey)
      .accounts({
        authority: authority.publicKey,
        registryState: registryStatePda,
      })
      .rpc();

    let state = await program.account.registryState.fetch(registryStatePda);
    expect(state.guardian.toString()).to.equal(guardian.publicKey.toString());

    // Clear it
    await program.methods
      .setGuardian(anchor.web3.PublicKey.default)
      .accounts({
        authority: authority.publicKey,
        registryState: registryStatePda,
      })
      .rpc();

    state = await program.account.registryState.fetch(registryStatePda);
    expect(state.guardian).to.be.null;
  });

  it("guardian cannot set a new guardian", async () => {
    const guardian = Keypair.generate();
    await airdrop(provider.connection, guardian.publicKey);

    await program.methods
      .setGuardian(guardian.publicKey)
      .accounts({
        authority: authority.publicKey,
        registryState: registryStatePda,
      })
      .rpc();

    const anotherGuardian = Keypair.generate();
    await airdrop(provider.connection, anotherGuardian.publicKey);

    try {
      await program.methods
        .setGuardian(anotherGuardian.publicKey)
        .accounts({
          authority: guardian.publicKey,
          registryState: registryStatePda,
        })
        .signers([guardian])
        .rpc();
      expect.fail("Should have rejected guardian setting a new guardian");
    } catch (err: any) {
      expect(err.toString()).to.contain("Unauthorized");
    }
  });

  it("transfers governance via two-step nominate + accept", async () => {
    const newAuthority = Keypair.generate();
    await airdrop(provider.connection, newAuthority.publicKey);

    // Step 1: current authority nominates new authority
    await program.methods
      .nominateGovernance()
      .accounts({
        authority: authority.publicKey,
        registryState: registryStatePda,
        newAuthority: newAuthority.publicKey,
      })
      .rpc();

    let state = await program.account.registryState.fetch(registryStatePda);
    expect(state.pendingAuthority.toString()).to.equal(
      newAuthority.publicKey.toString()
    );
    expect(state.authority.toString()).to.equal(
      authority.publicKey.toString()
    );

    // Step 2: new authority accepts the nomination
    await program.methods
      .acceptGovernance()
      .accounts({
        signer: newAuthority.publicKey,
        registryState: registryStatePda,
      })
      .signers([newAuthority])
      .rpc();

    state = await program.account.registryState.fetch(registryStatePda);
    expect(state.authority.toString()).to.equal(
      newAuthority.publicKey.toString()
    );
    expect(state.pendingAuthority).to.be.null;
  });
});
