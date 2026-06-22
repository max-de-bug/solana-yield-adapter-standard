"use client";

import { useEffect, useState, useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

import { ADAPTERS } from "@/lib/adapters";
import { adapterUserPositionPda } from "@/lib/pda";
import { formatU64 } from "@/lib/errors";

interface PositionSummary {
  adapterLabel: string;
  adapterName: string;
  deposited: string;
  shares: string;
  exists: boolean;
}

interface DispatcherPositionSummary {
  adapterLabel: string;
  adapterName: string;
  deposited: string;
  withdrawn: string;
  shares: string;
  exists: boolean;
}

export default function GlobalDashboard() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [adapterPositions, setAdapterPositions] = useState<PositionSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!wallet.publicKey) return;
    setLoading(true);
    try {
      const results: PositionSummary[] = [];

      for (const a of ADAPTERS) {
        const [posPda] = adapterUserPositionPda(a.id, wallet.publicKey);
        const info = await connection.getAccountInfo(posPda);

        if (!info || info.data.length < 80) {
          results.push({
            adapterLabel: a.label,
            adapterName: a.name,
            deposited: "0",
            shares: "0",
            exists: false,
          });
          continue;
        }

        const view = new DataView(info.data.buffer, info.data.byteOffset, info.data.byteLength);
        const deposited = view.getBigUint64(8 + 32, true);
        const withdrawn = view.getBigUint64(8 + 32 + 8, true);
        const shares = view.getBigUint64(8 + 32 + 8 + 8, true);

        results.push({
          adapterLabel: a.label,
          adapterName: a.name,
          deposited: formatU64(deposited),
          shares: formatU64(shares),
          exists: shares > BigInt(0),
        });
      }

      setAdapterPositions(results);
    } catch (err: unknown) {
      console.warn("dashboard fetch:", err);
    } finally {
      setLoading(false);
    }
  }, [connection, wallet]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const hasAny = adapterPositions.some((p) => p.exists);

  return (
    <section className="rounded-lg border border-[#2a2d35] bg-[#14161b] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Positions</h3>
        {!loading && (
          <span className="text-[11px] text-muted">
            {wallet.publicKey ? wallet.publicKey.toBase58().slice(0, 8) + "..." : "Not connected"}
          </span>
        )}
      </div>

      {loading && (
        <div className="flex flex-col gap-1.5">
          <div className="h-8 animate-pulse rounded bg-[#2a2d35]" />
          <div className="h-8 animate-pulse rounded bg-[#2a2d35]" />
        </div>
      )}

      {!loading && !wallet.publicKey && (
        <p className="py-3 text-center text-sm text-muted">Connect wallet to see positions</p>
      )}

      {!loading && wallet.publicKey && !hasAny && (
        <p className="py-3 text-center text-sm text-muted">No positions found</p>
      )}

      {!loading && hasAny && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#2a2d35] text-muted">
                <th className="px-2 py-1.5 text-left font-semibold">Adapter</th>
                <th className="px-2 py-1.5 text-right font-semibold">Deposited</th>
                <th className="px-2 py-1.5 text-right font-semibold">Shares</th>
              </tr>
            </thead>
            <tbody>
              {adapterPositions.filter((p) => p.exists).map((p) => (
                <tr key={p.adapterName} className="border-b border-[#2a2d35]/30">
                  <td className="px-2 py-1.5 font-medium">{p.adapterLabel}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-[#2ecc71]">{p.deposited}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{p.shares}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
