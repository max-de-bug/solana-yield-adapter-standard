"use client";

export interface LogEntry {
  id: number;
  type: "info" | "success" | "error";
  message: string;
  txSig?: string;
}

interface Props {
  logs: LogEntry[];
}

export default function TxLog({ logs }: Props) {
  return (
    <div className="rounded-lg border border-[#2a2d35] bg-[#14161b] p-4">
      <h3 className="mb-3 text-sm font-semibold">Transaction Log</h3>
      <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
        {logs.length === 0 && (
          <p className="text-sm text-muted">No transactions yet</p>
        )}
        {logs.map((e) => {
          const bg =
            e.type === "success"
              ? "bg-[#2ecc71]/10"
              : e.type === "error"
                ? "bg-[#e74c3c]/10"
                : "bg-[#6c5ce7]/10";
          return (
            <div
              key={e.id}
              className={`flex items-center justify-between gap-2 rounded px-2 py-1.5 text-sm ${bg}`}
            >
              <span className="flex-1">{e.message}</span>
              {e.txSig && (
                <a
                  href={`https://explorer.solana.com/tx/${e.txSig}?cluster=devnet`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs text-accent hover:text-accent-hover"
                >
                  {e.txSig.slice(0, 8)}...
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
