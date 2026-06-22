"use client";

import { useEffect, useState, useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

import { PROGRAM_IDS } from "@/lib/constants";
import { ADAPTERS } from "@/lib/adapters";
import { registryStatePda, adapterEntryPda } from "@/lib/registry";
import { makeProvider, makeProgram } from "@/lib/anchor";
import registryIdl from "@/lib/idl/adapter_registry.json";

interface AdapterEntry {
  name: string;
  adapterProgramId: string;
  status: "Proposed" | "Approved" | "Revoked";
  underlyingMint: string;
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
          results.push({ name: entry.name, adapterProgramId: entry.adapterProgramId.toBase58(), status: statusLabel(entry.status) as any, underlyingMint: entry.underlyingMint.toBase58() });
        } catch {
          results.push({ name: a.label, adapterProgramId: a.id.toBase58(), status: "Proposed", underlyingMint: "" });
        }
      }
      setEntries(results);
    } catch { /* registry not deployed yet */ } finally { setLoading(false); }
  }, [connection, wallet]);

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
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.adapterProgramId} className="border-b border-[#2a2d35]/30">
                <td className="px-2 py-1.5 font-medium">{e.name}</td>
                <td className="px-2 py-1.5 text-right">
                  <span className="font-semibold" style={{ color: STATUS_COLORS[e.status] ?? "#8b8f97" }}>{e.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
