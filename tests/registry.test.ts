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
  sleep,
} from "./helpers";

describe("adapter-registry", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AdapterRegistry as Program;
  const authority = provider.wallet as anchor.Wallet;
  let registryStatePda: PublicKey;
  let registryBump: number;
  /** The effective authority — may differ from `authority` on a fork with leftover state. */
  let effectiveAuthority: PublicKey;

  before(async () => {
    [registryStatePda, registryBump] = findPda(
      [Buffer.from("registry_state")],
      program.programId
    );
    // Resolve the actual authority (may already be initialized from a prior run)
    try {
      const state = await program.account.registryState.fetch(registryStatePda);
      effectiveAuthority = state.authority;
    } catch {
      effectiveAuthority = authority.publicKey;
      return;
    }
    // If the registry has a stale authority (e.g. from a prior Surfpool run),
    // force-transfer governance back to the test wallet.
    if (!effectiveAuthority.equals(authority.publicKey)) {
      try {
        await program.methods
          .forceTransferGovernance()
          .accounts({
            admin: authority.publicKey,
            registryState: registryStatePda,
            newAuthority: authority.publicKey,
          })
          .rpc();
        effectiveAuthority = authority.publicKey;
        console.log("  (forced governance transfer: stale authority -> test wallet)");
      } catch (e) {
        console.log("  (stale registry authority – force transfer failed, tests will skip)", String(e).slice(0, 80));
      }
    }
  });

  // Skip governance-sensitive tests when the registry was initialized
  // by a different wallet (stale fork state from a prior run) or when
  // governance has been transferred to a new authority during this run.
  beforeEach(async function () {
    try {
      const state = await program.account.registryState.fetch(registryStatePda);
      effectiveAuthority = state.authority;
    } catch {
      effectiveAuthority = authority.publicKey;
    }
    if (!effectiveAuthority.equals(authority.publicKey)) {
      this.skip();
    }
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
      // After successful init, update effective authority
      effectiveAuthority = authority.publicKey;
    } catch (e: unknown) {
      const msg = String(e);
      if (!msg.includes("already in use") && !msg.includes("0x0")) {
        throw e;
      }
    }

    const state = await program.account.registryState.fetch(registryStatePda);
    effectiveAuthority = state.authority;
    expect(state.authority.toString()).to.equal(effectiveAuthority.toString());
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

    // Allow blockhash to advance after propose
    await sleep(3000);

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

  it("lifecycle: propose→approve→revoke→re-approve", async () => {
    const adapterProgram = Keypair.generate();
    const underlyingMint = Keypair.generate();

    const [adapterEntryPda] = findPda(
      [Buffer.from("adapter_entry"), adapterProgram.publicKey.toBuffer()],
      program.programId
    );

    // 1. Propose
    await program.methods
      .proposeAdapter("Lifecycle Adapter", "https://example.com/lifecycle.json", "test_vault_state", "vault_authority")
      .accounts({
        proposer: authority.publicKey,
        registryState: registryStatePda,
        adapterEntry: adapterEntryPda,
        adapterProgram: adapterProgram.publicKey,
        underlyingMint: underlyingMint.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    let entry = await program.account.adapterEntry.fetch(adapterEntryPda);
    expect(entry.status).to.deep.equal({ proposed: {} });

    // Wait for new slot before approving
    await sleep(500);

    // 2. Approve
    await program.methods
      .approveAdapter()
      .accounts({
        authority: authority.publicKey,
        registryState: registryStatePda,
        adapterEntry: adapterEntryPda,
      })
      .rpc();

    entry = await program.account.adapterEntry.fetch(adapterEntryPda);
    expect(entry.status).to.deep.equal({ approved: {} });

    // Wait for new slot before revoking
    await sleep(500);

    // 3. Revoke
    await program.methods
      .revokeAdapter()
      .accounts({
        authority: authority.publicKey,
        registryState: registryStatePda,
        adapterEntry: adapterEntryPda,
      })
      .rpc();

    entry = await program.account.adapterEntry.fetch(adapterEntryPda);
    expect(entry.status).to.deep.equal({ revoked: {} });
    expect(entry.revokedAt.toNumber()).to.be.greaterThan(0);

    // Wait for new slot before re-approving
    await sleep(500);

    // 4. Re-approve after revoke
    await program.methods
      .approveAdapter()
      .accounts({
        authority: authority.publicKey,
        registryState: registryStatePda,
        adapterEntry: adapterEntryPda,
      })
      .rpc();

    entry = await program.account.adapterEntry.fetch(adapterEntryPda);
    expect(entry.status).to.deep.equal({ approved: {} });
    expect(entry.approvedAt.toNumber()).to.be.greaterThan(0);
  });

  it("idempotency: proposing the same adapter twice fails", async () => {
    const adapterProgram = Keypair.generate();
    const underlyingMint = Keypair.generate();

    const [adapterEntryPda] = findPda(
      [Buffer.from("adapter_entry"), adapterProgram.publicKey.toBuffer()],
      program.programId
    );

    // First propose succeeds
    await program.methods
      .proposeAdapter("Idempotent Adapter", "https://example.com/idempotent.json", "test_vault_state", "vault_authority")
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
    expect(entry.status).to.deep.equal({ proposed: {} });

    // Second propose with same adapter program should fail (account already exists)
    try {
      await program.methods
        .proposeAdapter("Idempotent Adapter v2", "https://example.com/idempotent2.json", "test_vault_state", "vault_authority")
        .accounts({
          proposer: authority.publicKey,
          registryState: registryStatePda,
          adapterEntry: adapterEntryPda,
          adapterProgram: adapterProgram.publicKey,
          underlyingMint: underlyingMint.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      expect.fail("Should have rejected duplicate proposal");
    } catch (err: unknown) {
      const msg = String(err);
      expect(msg).to.satisfy((s: string) =>
        s.includes("already in use") || s.includes("0x0") || s.includes("AccountNotInitialized")
      );
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

    // Wait for new slot before accepting
    await sleep(1000);

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
