"use client";

interface VaultMetricsData {
  totalUnderlying: string;
  totalShares: string;
  userShares: string;
  userSharePct: string;
  userValue: string;
}

interface Props {
  metrics: VaultMetricsData | null;
  loading: boolean;
  mintLabel: string;
}

function stat(label: string, value: string, accent: string) {
  return (
    <div className="flex items-center justify-between gap-2 rounded bg-[#1c1f26] px-3 py-2">
      <span className="text-[11px] text-muted">{label}</span>
      <span className="font-mono text-sm" style={{ color: accent }}>{value}</span>
    </div>
  );
}

export default function VaultMetrics({ metrics, loading, mintLabel }: Props) {
  if (loading) {
    return (
      <div className="mb-4 rounded-lg border border-[#2a2d35] bg-[#14161b] p-3">
        <div className="flex flex-col gap-1.5">
          <div className="h-8 animate-pulse rounded bg-[#2a2d35]" />
          <div className="h-8 animate-pulse rounded bg-[#2a2d35]" />
        </div>
      </div>
    );
  }

  if (!metrics) return null;

  return (
    <div className="mb-4 rounded-lg border border-[#2a2d35] bg-[#14161b] p-3">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Vault Metrics</h3>
      <div className="flex flex-col gap-1.5">
        {stat(`Total ${mintLabel}`, metrics.totalUnderlying, "#f1c40f")}
        {stat("Total Shares", metrics.totalShares, "#f1c40f")}
        {metrics.userShares !== "0" && (
          <>
            {stat("Your Shares", metrics.userShares, "#2ecc71")}
            <div className="my-0.5 border-t border-[#2a2d35]/50" />
            {stat("Your Share", metrics.userSharePct, "#6c5ce7")}
            {stat(`Est. Value (${mintLabel})`, metrics.userValue, "#2ecc71")}
          </>
        )}
      </div>
    </div>
  );
}

export type { VaultMetricsData };
