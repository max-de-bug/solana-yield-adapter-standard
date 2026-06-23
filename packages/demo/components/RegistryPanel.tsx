"use client";

import { useEffect, useState, useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction, SystemProgram } from "@solana/web3.js";

import { PROGRAM_IDS, USDC_MINT } from "@/lib/constants";
import { ADAPTERS, type AdapterConfig } from "@/lib/adapters";
import { registryStatePda, adapterEntryPda } from "@/lib/registry";
import { makeProvider, makeProgram } from "@/lib/anchor";
import { parseAnchorError } from "@/lib/errors";
import registryIdl from "@/lib/idl/adapter_registry.json";

interface AdapterEntry {
  name: string;
  adapterProgramId: string;
  status: "Proposed" | "Approved" | "Revoked" | null;
  underlyingMint: string;
  adapterConfig: AdapterConfig;
}

const STATUS_COLORS: Record<string, string> = {
  Approved: "#2ecc71",
  Proposed: "#f1c40f",
  Revoked: "#e74c3c",
};

function statusLabel(raw: any): string {
  if (typeof raw === "string") return raw;
  return ["Proposed", "Approved", "Revoked"][raw] ?? "Proposed";
}

export default function RegistryPanel() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [registryState, setRegistryState] = useState<any>(null);
  const [entries, setEntries] = useState<AdapterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [initializing, setInitializing] = useState(false);
  const [proposing, setProposing] = useState<Set<string>>(new Set());
  const [approving, setApproving] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!wallet.publicKey) return;
    setLoading(true);
    try {
      const provider = makeProvider(connection, wallet);
      const program = makeProgram(registryIdl, PROGRAM_IDS.registry, provider);

      const rsPda = registryStatePda(PROGRAM_IDS.registry);
      const rsInfo = await connection.getAccountInfo(rsPda);
      if (!rsInfo) { setRegistryState(null); setEntries([]); setLoading(false); return; }

      const rs = await (program.account as any).registryState.fetch(rsPda);
      setRegistryState(rs);

      const results: AdapterEntry[] = [];
      for (const a of ADAPTERS) {
        try {
          const entry = await (program.account as any).adapterEntry.fetch(adapterEntryPda(PROGRAM_IDS.registry, a.id));
          results.push({ name: entry.name, adapterProgramId: entry.adapterProgramId.toBase58(), status: statusLabel(entry.status) as any, underlyingMint: entry.underlyingMint.toBase58(), adapterConfig: a });
        } catch {
          results.push({ name: a.label, adapterProgramId: a.id.toBase58(), status: null, underlyingMint: "", adapterConfig: a });
        }
      }
      setEntries(results);
      setError(null);
    } catch { /* registry not deployed yet */ } finally { setLoading(false); }
  }, [connection, wallet]);

  const handleInitialize = useCallback(async () => {
    if (!wallet.publicKey || !wallet.signTransaction) return;
    setError(null);
    setInitializing(true);
    try {
      const provider = makeProvider(connection, wallet);
      const program = makeProgram(registryIdl, PROGRAM_IDS.registry, provider);
      const ix = await program.methods
        .initialize()
        .accounts({
          authority: wallet.publicKey,
          registryState: registryStatePda(PROGRAM_IDS.registry),
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      const tx = new Transaction().add(ix);
      tx.feePayer = wallet.publicKey;
      const bh = await connection.getLatestBlockhash();
      tx.recentBlockhash = bh.blockhash;
      const signed = await wallet.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
      await connection.confirmTransaction({
        signature: sig,
        blockhash: bh.blockhash,
        lastValidBlockHeight: bh.lastValidBlockHeight + 150,
      }, "confirmed");
      await fetchData();
    } catch (e: unknown) {
      console.error("Registry init failed:", e);
      const parsed = parseAnchorError(e);
      setError(parsed.message);
    } finally { setInitializing(false); }
  }, [connection, wallet, fetchData]);

  const handlePropose = useCallback(async (adapterId: string) => {
    if (!wallet.publicKey || !wallet.signTransaction) return;
    setError(null);
    const adapterPubkey = new PublicKey(adapterId);
    setProposing((prev) => new Set(prev).add(adapterId));
    try {
      const provider = makeProvider(connection, wallet);
      const program = makeProgram(registryIdl, PROGRAM_IDS.registry, provider);
      const cfg = ADAPTERS.find(a => a.id.equals(adapterPubkey))!;
      const rsPda = registryStatePda(PROGRAM_IDS.registry);
      const entryPda = adapterEntryPda(PROGRAM_IDS.registry, adapterPubkey);
      const ix = await program.methods
        .proposeAdapter(
          cfg.label,
          "",
          cfg.vaultStateSeed.toString(),
          cfg.vaultAuthoritySeed.toString(),
        )
        .accounts({
          proposer: wallet.publicKey,
          registryState: rsPda,
          adapterEntry: entryPda,
          adapterProgram: adapterPubkey,
          underlyingMint: USDC_MINT,
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      const tx = new Transaction().add(ix);
      tx.feePayer = wallet.publicKey;
      const bh = await connection.getLatestBlockhash();
      tx.recentBlockhash = bh.blockhash;
      const signed = await wallet.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
      await connection.confirmTransaction({
        signature: sig,
        blockhash: bh.blockhash,
        lastValidBlockHeight: bh.lastValidBlockHeight + 150,
      }, "confirmed");
      await fetchData();
    } catch (e: unknown) {
      console.error("Propose failed:", e);
      const parsed = parseAnchorError(e);
      setError(parsed.message);
    } finally {
      setProposing((prev) => { const next = new Set(prev); next.delete(adapterId); return next; });
    }
  }, [connection, wallet, fetchData]);

  const handleApprove = useCallback(async (adapterId: string) => {
    if (!wallet.publicKey || !wallet.signTransaction) return;
    setError(null);
    const adapterPubkey = new PublicKey(adapterId);
    setApproving((prev) => new Set(prev).add(adapterId));
    try {
      const provider = makeProvider(connection, wallet);
      const program = makeProgram(registryIdl, PROGRAM_IDS.registry, provider);
      const ix = await program.methods
        .approveAdapter()
        .accounts({
          authority: wallet.publicKey,
          registryState: registryStatePda(PROGRAM_IDS.registry),
          adapterEntry: adapterEntryPda(PROGRAM_IDS.registry, adapterPubkey),
        })
        .instruction();

      const tx = new Transaction().add(ix);
      tx.feePayer = wallet.publicKey;
      const bh = await connection.getLatestBlockhash();
      tx.recentBlockhash = bh.blockhash;
      const signed = await wallet.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
      await connection.confirmTransaction({
        signature: sig,
        blockhash: bh.blockhash,
        lastValidBlockHeight: bh.lastValidBlockHeight + 150,
      }, "confirmed");
      await fetchData();
    } catch (e: unknown) {
      console.error("Approve failed:", e);
      const parsed = parseAnchorError(e);
      setError(parsed.message);
    } finally {
      setApproving((prev) => { const next = new Set(prev); next.delete(adapterId); return next; });
    }
  }, [connection, wallet, fetchData]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <section className="rounded-lg border border-[#2a2d35] bg-[#14161b] p-4">
        <div className="h-12 animate-pulse rounded bg-[#2a2d35]" />
      </section>
    );
  }

  if (!registryState) {
    return (
      <section className="rounded-lg border border-[#2a2d35] bg-[#14161b] p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Registry</h3>
          <span className="text-[11px] text-muted">Not initialized on devnet</span>
        </div>
        <button
          className="btn btn-initialize mt-2"
          onClick={handleInitialize}
          disabled={initializing}
        >
          {initializing ? "Initializing..." : "initialize()"}
        </button>
        {error && <p className="mt-2 text-[11px] text-[#e74c3c]">{error}</p>}
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-[#2a2d35] bg-[#14161b] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Registry</h3>
        <div className="flex items-center gap-4 text-[11px] text-muted">
          <span>Total proposed: <span className="font-mono text-white">{Number(registryState.totalProposed)}</span></span>
          <span>Approved: <span className="font-mono text-[#2ecc71]">{Number(registryState.totalApproved)}</span></span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#2a2d35] text-muted">
              <th className="px-2 py-1.5 text-left font-semibold">Adapter</th>
              <th className="px-2 py-1.5 text-right font-semibold">Status</th>
              <th className="px-2 py-1.5 text-right font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.adapterProgramId} className="border-b border-[#2a2d35]/30">
                <td className="px-2 py-1.5 font-medium">{e.name}</td>
                <td className="px-2 py-1.5 text-right">
                  <span className="font-semibold" style={{ color: e.status ? (STATUS_COLORS[e.status] ?? "#8b8f97") : "#8b8f97" }}>{e.status ?? "Not registered"}</span>
                </td>
                <td className="px-2 py-1.5 text-right">
                  {e.status === null ? (
                    <button
                      className="rounded border border-[#f1c40f]/50 px-2 py-0.5 text-[10px] text-[#f1c40f] transition-colors hover:bg-[#f1c40f]/10 disabled:opacity-40"
                      onClick={() => handlePropose(e.adapterProgramId)}
                      disabled={proposing.has(e.adapterProgramId)}
                    >
                      {proposing.has(e.adapterProgramId) ? "..." : "Propose"}
                    </button>
                  ) : e.status === "Proposed" ? (
                    <button
                      className="rounded border border-[#2ecc71]/50 px-2 py-0.5 text-[10px] text-[#2ecc71] transition-colors hover:bg-[#2ecc71]/10 disabled:opacity-40"
                      onClick={() => handleApprove(e.adapterProgramId)}
                      disabled={approving.has(e.adapterProgramId)}
                    >
                      {approving.has(e.adapterProgramId) ? "..." : "Approve"}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p className="mt-2 text-[11px] text-[#e74c3c]">{error}</p>}
    </section>
  );
}
