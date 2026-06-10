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
    await registryProgram.methods
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

  try {
    await registryProgram.account.adapterEntry.fetch(adapterEntryPda);
    return adapterEntryPda;
  } catch {
    // not proposed yet
  }

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

  await registryProgram.methods
    .approveAdapter()
    .accounts({
      authority: authority.publicKey,
      registryState: registryStatePda,
      adapterEntry: adapterEntryPda,
    })
    .rpc();

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
}> {
  const [vaultStatePda] = findPda(
    [Buffer.from(vaultStateSeed)],
    adapterProgram.programId
  );
  const [vaultAuthorityPda] = findPda(
    [Buffer.from(vaultAuthoritySeed)],
    adapterProgram.programId
  );

  await initializeAdapterVault(
    adapterProgram,
    authority,
    vaultStatePda,
    underlyingMint
  );

  const vaultTokenAccount = await createVaultTokenAccount(
    provider,
    payer,
    underlyingMint,
    vaultAuthorityPda
  );

  return { vaultStatePda, vaultAuthorityPda, vaultTokenAccount };
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

  const { vaultStatePda, vaultAuthorityPda, vaultTokenAccount } =
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
