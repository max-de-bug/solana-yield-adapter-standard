import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { createVaultTokenAccount, initializeAdapterVault } from "./adapter";
import { adapterUserPositionPda, findPda } from "./index";

export interface ApprovedAdapterSetup {
  adapterProgram: PublicKey;
  adapterEntryPda: PublicKey;
  vaultStatePda: PublicKey;
  vaultAuthorityPda: PublicKey;
  vaultTokenAccount: PublicKey;
  adapterUserPositionPda: PublicKey;
  vaultMint: PublicKey;
}

/** Ensure registry governance account exists. */
export async function ensureRegistryInitialized(
  registryProgram: Program,
  authority: anchor.Wallet
): Promise<PublicKey> {
  const [registryStatePda] = findPda(
    [Buffer.from("registry_state")],
    registryProgram.programId
  );

  try {
    await registryProgram.account.registryState.fetch(registryStatePda);
    return registryStatePda;
  } catch {
    // Account doesn't exist, create it
  }

  await registryProgram.methods
    .initialize()
    .accounts({
      authority: authority.publicKey,
      registryState: registryStatePda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  return registryStatePda;
}

/** Propose and approve an adapter in the registry. */
export async function approveAdapterInRegistry(
  registryProgram: Program,
  authority: anchor.Wallet,
  registryStatePda: PublicKey,
  adapterProgram: PublicKey,
  underlyingMint: PublicKey,
  name: string,
  metadataUri: string,
  vaultStateSeed: string = "test_vault_state",
  vaultAuthoritySeed: string = "vault_authority"
): Promise<PublicKey> {
  const [adapterEntryPda] = findPda(
    [Buffer.from("adapter_entry"), adapterProgram.toBuffer()],
    registryProgram.programId
  );

  // Always try to propose — handles both fresh and existing entries.
  // If the entry already exists, propose will fail (account in use) and
  // we catch that silently. We cannot update an existing entry's fields,
  // so the caller MUST pass the correct underlyingMint from the start
  // (which setupApprovedAdapterForDispatcher now does after resolving
  // the actual vault mint).
  try {
    await registryProgram.methods
      .proposeAdapter(name, metadataUri, vaultStateSeed, vaultAuthoritySeed)
      .accounts({
        proposer: authority.publicKey,
        registryState: registryStatePda,
        adapterEntry: adapterEntryPda,
        adapterProgram,
        underlyingMint,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  } catch {
    // Entry already exists — can't update fields, continue
  }

  // Always try to approve — OK if already approved
  try {
    await registryProgram.methods
      .approveAdapter()
      .accounts({
        authority: authority.publicKey,
        registryState: registryStatePda,
        adapterEntry: adapterEntryPda,
      })
      .rpc();
  } catch {
    // Already approved or other non-fatal error
  }

  return adapterEntryPda;
}

/** Initialize a reference adapter vault and return PDAs for dispatcher CPI. */
export async function setupReferenceAdapterVault(
  adapterProgram: Program,
  provider: anchor.AnchorProvider,
  authority: anchor.Wallet,
  payer: anchor.web3.Keypair,
  underlyingMint: PublicKey,
  vaultStateSeed: string,
  vaultAuthoritySeed: string
): Promise<{
  vaultStatePda: PublicKey;
  vaultAuthorityPda: PublicKey;
  vaultTokenAccount: PublicKey;
  vaultMint: PublicKey;
}> {
  const [vaultStatePda] = findPda(
    [Buffer.from(vaultStateSeed)],
    adapterProgram.programId
  );
  const [vaultAuthorityPda] = findPda(
    [Buffer.from(vaultAuthoritySeed)],
    adapterProgram.programId
  );

  const actualMint = await initializeAdapterVault(
    adapterProgram,
    authority,
    vaultStatePda,
    underlyingMint
  );

  const vaultTokenAccount = await createVaultTokenAccount(
    provider,
    payer,
    actualMint,
    vaultAuthorityPda
  );

  return { vaultStatePda, vaultAuthorityPda, vaultTokenAccount, vaultMint: actualMint };
}

/** Resolve the Kamino vault mint (reuses vault from adapter tests when present). */
export async function resolveKaminoVaultMint(
  kaminoProgram: Program,
  fallbackMint: PublicKey
): Promise<PublicKey> {
  const [vaultStatePda] = findPda(
    [Buffer.from("kamino_vault_state")],
    kaminoProgram.programId
  );

  try {
    const vault = await kaminoProgram.account.kaminoVaultState.fetch(
      vaultStatePda
    );
    return vault.underlyingMint;
  } catch {
    return fallbackMint;
  }
}

/** Generic adapter approval + vault setup for dispatcher tests. */
export async function setupApprovedAdapterForDispatcher(
  provider: anchor.AnchorProvider,
  authority: anchor.Wallet,
  payer: anchor.web3.Keypair,
  underlyingMint: PublicKey,
  adapterProgram: Program,
  adapterName: string,
  vaultStateSeed: string,
  vaultAuthoritySeed: string
): Promise<ApprovedAdapterSetup> {
  const registryProgram = anchor.workspace.AdapterRegistry as Program;
  const registryStatePda = await ensureRegistryInitialized(registryProgram, authority);

  // Initialize vault FIRST to get the actual on-chain mint (may differ from
  // underlyingMint if the vault already exists with a different mint).
  const [vaultStatePda] = findPda(
    [Buffer.from(vaultStateSeed)],
    adapterProgram.programId
  );
  const [vaultAuthorityPda] = findPda(
    [Buffer.from(vaultAuthoritySeed)],
    adapterProgram.programId
  );

  const vaultMint = await initializeAdapterVault(
    adapterProgram,
    authority,
    vaultStatePda,
    underlyingMint
  );

  const vaultTokenAccount = await createVaultTokenAccount(
    provider,
    payer,
    vaultMint,
    vaultAuthorityPda
  );

  // Register with the ACTUAL vault mint so the dispatcher's
  // user_token_account.mint == adapter_entry.underlying_mint check passes.
  const adapterEntryPda = await approveAdapterInRegistry(
    registryProgram,
    authority,
    registryStatePda,
    adapterProgram.programId,
    vaultMint,
    adapterName,
    "https://example.com/adapter.json",
    vaultStateSeed,
    vaultAuthoritySeed
  );

  return {
    adapterProgram: adapterProgram.programId,
    adapterEntryPda,
    vaultStatePda,
    vaultAuthorityPda,
    vaultTokenAccount,
    vaultMint,
    adapterUserPositionPda: adapterUserPositionPda(
      adapterProgram.programId,
      authority.publicKey
    )[0],
  };
}

/** Full Kamino adapter approval + vault setup for dispatcher tests. */
export async function setupApprovedKaminoForDispatcher(
  provider: anchor.AnchorProvider,
  authority: anchor.Wallet,
  payer: anchor.web3.Keypair,
  underlyingMint: PublicKey
): Promise<ApprovedAdapterSetup> {
  const registryProgram = anchor.workspace.AdapterRegistry as Program;
  const kaminoProgram = anchor.workspace.AdapterKamino as Program;

  const vaultMint = await resolveKaminoVaultMint(
    kaminoProgram,
    underlyingMint
  );

  const registryStatePda = await ensureRegistryInitialized(
    registryProgram,
    authority
  );

  const vaultStateSeed = "kamino_vault_state";

  const adapterEntryPda = await approveAdapterInRegistry(
    registryProgram,
    authority,
    registryStatePda,
    kaminoProgram.programId,
    vaultMint,
    "Kamino USDC (reference)",
    "https://example.com/kamino-reference.json",
    vaultStateSeed,
    "kamino_vault_authority"
  );

  const { vaultStatePda, vaultAuthorityPda, vaultTokenAccount, vaultMint: resolvedMint } =
    await setupReferenceAdapterVault(
      kaminoProgram,
      provider,
      authority,
      payer,
      vaultMint,
      vaultStateSeed,
      "kamino_vault_authority"
    );

  return {
    adapterProgram: kaminoProgram.programId,
    adapterEntryPda,
    vaultStatePda,
    vaultAuthorityPda,
    vaultTokenAccount,
    vaultMint: resolvedMint,
    adapterUserPositionPda: adapterUserPositionPda(
      kaminoProgram.programId,
      authority.publicKey
    )[0],
  };
}

export function userPositionPda(
  dispatcherProgramId: PublicKey,
  user: PublicKey,
  adapterProgram: PublicKey
): PublicKey {
  const [pda] = findPda(
    [
      Buffer.from("user_position"),
      user.toBuffer(),
      adapterProgram.toBuffer(),
    ],
    dispatcherProgramId
  );
  return pda;
}
