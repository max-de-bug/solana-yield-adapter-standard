import { PublicKey } from "@solana/web3.js";
import type { Idl } from "@anchor-lang/core";

import { PROGRAM_IDS, AdapterName } from "./constants";
import { findPda } from "./pda";

import kaminoIdl from "./idl/adapter_kamino.json";
import marginfiIdl from "./idl/adapter_marginfi.json";
import jupiterIdl from "./idl/adapter_jupiter.json";
import mapleIdl from "./idl/adapter_maple.json";
import driftIdl from "./idl/adapter_drift.json";
import templateIdl from "./idl/adapter_template.json";

export interface AdapterConfig {
  name: AdapterName;
  id: PublicKey;
  label: string;
  url: string;
  vaultStateSeed: Buffer;
  vaultAuthoritySeed: Buffer;
  idl: Idl;
}

export const ADAPTERS: AdapterConfig[] = [
  { name: "kamino", id: PROGRAM_IDS.kamino, label: "Kamino Lend", url: "https://kamino.finance", vaultStateSeed: Buffer.from("kamino_vault_state"), vaultAuthoritySeed: Buffer.from("kamino_vault_authority"), idl: kaminoIdl as Idl },
  { name: "marginfi", id: PROGRAM_IDS.marginfi, label: "MarginFi v2", url: "https://marginfi.com", vaultStateSeed: Buffer.from("marginfi_vault_state"), vaultAuthoritySeed: Buffer.from("marginfi_vault_authority"), idl: marginfiIdl as Idl },
  { name: "jupiter", id: PROGRAM_IDS.jupiter, label: "Jupiter JLP", url: "https://jup.ag", vaultStateSeed: Buffer.from("jupiter_vault_state"), vaultAuthoritySeed: Buffer.from("jupiter_vault_authority"), idl: jupiterIdl as Idl },
  { name: "maple", id: PROGRAM_IDS.maple, label: "Maple Syrup", url: "https://maple.finance", vaultStateSeed: Buffer.from("maple_vault_state"), vaultAuthoritySeed: Buffer.from("maple_vault_authority"), idl: mapleIdl as Idl },
  { name: "drift", id: PROGRAM_IDS.drift, label: "Drift IF", url: "https://drift.trade", vaultStateSeed: Buffer.from("drift_vault_state"), vaultAuthoritySeed: Buffer.from("drift_vault_authority"), idl: driftIdl as Idl },
  { name: "template", id: PROGRAM_IDS.template, label: "Template", url: "", vaultStateSeed: Buffer.from("template_vault_state"), vaultAuthoritySeed: Buffer.from("template_vault_authority"), idl: templateIdl as Idl },
];

export function getAdapter(name: AdapterName): AdapterConfig {
  const a = ADAPTERS.find(a => a.name === name);
  if (!a) throw new Error(`Unknown adapter: ${name}`);
  return a;
}

export function getVaultStatePda(adapterId: PublicKey, seed: Buffer): PublicKey {
  return findPda([seed], adapterId)[0];
}

export function getVaultAuthorityPda(adapterId: PublicKey, seed: Buffer): PublicKey {
  return findPda([seed], adapterId)[0];
}

/** Maple-specific: vault syrup PDA (seed "maple_vault_syrup"). */
export function getVaultSyrupPda(adapterId: PublicKey): PublicKey {
  return findPda([Buffer.from("maple_vault_syrup")], adapterId)[0];
}
