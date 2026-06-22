import { AnchorProvider, Program } from "@anchor-lang/core";
import { type Connection, type PublicKey, type Transaction, type VersionedTransaction } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";

interface AnchorWallet {
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;
  publicKey: PublicKey;
}

function asAnchorWallet(w: WalletContextState): AnchorWallet {
  return {
    publicKey: w.publicKey!,
    signTransaction: (tx) => w.signTransaction!(tx),
    signAllTransactions: (txs) => w.signAllTransactions!(txs),
  };
}

export function makeProvider(connection: Connection, wallet: WalletContextState): AnchorProvider {
  return new AnchorProvider(connection, asAnchorWallet(wallet), { commitment: "confirmed" });
}

export function makeProgram<T = any>(idl: T, address: PublicKey, provider: AnchorProvider): Program {
  return new Program({ ...idl, address: address.toBase58() }, provider);
}
