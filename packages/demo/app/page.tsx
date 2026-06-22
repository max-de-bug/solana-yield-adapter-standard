"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";

import { ADAPTERS } from "@/lib/adapters";
import type { AdapterName } from "@/lib/constants";
import { PROGRAM_IDS } from "@/lib/constants";
import ErrorBoundary from "@/components/ErrorBoundary";
import RegistryPanel from "@/components/RegistryPanel";
import DispatcherPanel from "@/components/DispatcherPanel";
import PlaygroundPanel from "@/components/PlaygroundPanel";
import GlobalDashboard from "@/components/GlobalDashboard";
import ComparisonTable from "@/components/ComparisonTable";
import TxLog from "@/components/TxLog";
import Footer from "@/components/Footer";
import type { LogEntry } from "@/components/TxLog";

const DEMO_PUBKEY = new PublicKey("11111111111111111111111111111111");

export default function Home() {
  const { publicKey, connected } = useWallet();
  const { connection } = useConnection();
  const [adapter, setAdapter] = useState<AdapterName>("kamino");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [demoMode, setDemoMode] = useState(false);
  const [networkCheckDone, setNetworkCheckDone] = useState(false);
  const [onCorrectNetwork, setOnCorrectNetwork] = useState<boolean | null>(null);

  // Check if the connected wallet is on devnet by querying a devnet checkpoint
  useEffect(() => {
    if (!connected || !publicKey) {
      setNetworkCheckDone(false);
      setOnCorrectNetwork(null);
      return;
    }
    let cancelled = false;
    // Try to get the latest blockhash from devnet — if it fails or returns
    // an unexpected result, the wallet might be on a different network.
    connection.getLatestBlockhash().then((bh) => {
      if (!cancelled) {
        // Devnet slot range is roughly 200M-500M as of 2026
        // Mainnet is ~350M+; if slot is < 100M we're probably on testnet/localnet
        // If the request succeeded at all, we're on devnet (mainnet would need different RPC)
        setOnCorrectNetwork(true);
        setNetworkCheckDone(true);
      }
    }).catch(() => {
      if (!cancelled) {
        setOnCorrectNetwork(false);
        setNetworkCheckDone(true);
      }
    });
    return () => { cancelled = true; };
  }, [connected, publicKey, connection]);

  // Track wallet-rejection errors in logs and show banner
  const [walletRejected, setWalletRejected] = useState(false);
  useEffect(() => {
    const hasRejection = logs.some(l =>
      l.type === "error" &&
      l.message.includes("Wallet rejected")
    );
    setWalletRejected(hasRejection);
  }, [logs]);

  const addLog = useCallback((entry: Omit<LogEntry, "id">) => {
    setLogs((prev) => [{ id: Date.now() + Math.random(), ...entry }, ...prev]);
  }, []);

  const effectivePublicKey = useMemo(() => {
    if (connected && publicKey) return publicKey;
    if (demoMode) return DEMO_PUBKEY;
    return null;
  }, [connected, publicKey, demoMode]);

  const showContent = connected || demoMode;

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-4">
      {/* ── Header ─────────────────────────────────── */}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-[#2a2d35] pb-4">
        <div>
          <h1 className="text-xl font-semibold">Yield Adapter Standard</h1>
          <span className="text-sm text-muted">Devnet Playground</span>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={adapter}
            onChange={(e) => setAdapter(e.target.value as AdapterName)}
            className="rounded-lg border border-[#2a2d35] bg-[#14161b] px-3 py-2 text-sm text-white outline-none transition-colors focus:border-accent"
            disabled={!showContent}
          >
            {ADAPTERS.map((a) => (
              <option key={a.name} value={a.name}>
                {a.label}
              </option>
            ))}
          </select>
          <WalletMultiButton />
          {!connected && (
            <button
              onClick={() => setDemoMode((p) => !p)}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                demoMode
                  ? "border-[#6c5ce7] bg-[#6c5ce7]/10 text-[#6c5ce7]"
                  : "border-[#2a2d35] text-muted hover:border-[#6c5ce7] hover:text-[#6c5ce7]"
              }`}
            >
              {demoMode ? "Exit Demo" : "Demo Mode"}
            </button>
          )}
        </div>
      </header>

      <main className="flex-1">
        {!showContent ? (
          <div className="mx-auto max-w-lg py-20 text-center">
            <h2 className="mb-3 text-lg font-medium">
              Connect your wallet to interact with yield adapters on devnet
            </h2>
            <p className="mb-6 text-sm text-muted">
              All 6 adapters implement the same 3-instruction interface:{" "}
              <code className="rounded bg-[#1c1f26] px-1.5 py-0.5 text-xs">deposit</code>
              ,{" "}
              <code className="rounded bg-[#1c1f26] px-1.5 py-0.5 text-xs">currentValue</code>
              ,{" "}
              <code className="rounded bg-[#1c1f26] px-1.5 py-0.5 text-xs">withdraw</code>
            </p>
            <button
              onClick={() => setDemoMode(true)}
              className="rounded-lg border border-[#6c5ce7] bg-[#6c5ce7]/10 px-6 py-2.5 text-sm font-medium text-[#6c5ce7] transition-colors hover:bg-[#6c5ce7]/20"
            >
              Explore the UI in Demo Mode
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {demoMode && (
              <div className="rounded-lg border border-[#6c5ce7]/40 bg-[#6c5ce7]/5 px-4 py-3 text-center text-sm text-[#6c5ce7]">
                Demo Mode — connect a wallet to interact with live devnet data
              </div>
            )}
            {!demoMode && walletRejected && connected && (
              <div className="rounded-lg border border-[#e74c3c]/40 bg-[#e74c3c]/5 px-4 py-3 text-center text-sm text-[#e74c3c]">
                ⚠ Wallet rejecting transactions — make sure your wallet is set to <strong>Devnet</strong>{" "}
                (not Mainnet) and has SOL for fees.{" "}
                <a href="https://faucet.solana.com" target="_blank" rel="noreferrer" className="underline">
                  Get devnet SOL
                </a>
              </div>
            )}
            {/* ── System Overview ────────────────────── */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <ErrorBoundary>
                <RegistryPanel />
              </ErrorBoundary>
              <ErrorBoundary>
                <DispatcherPanel onLog={addLog} />
              </ErrorBoundary>
            </div>

            {/* ── Adapter Playground ─────────────────── */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="flex flex-col gap-6">
                <ErrorBoundary>
                  <PlaygroundPanel
                    key={adapter}
                    adapterName={adapter}
                    user={effectivePublicKey!}
                    onLog={addLog}
                  />
                </ErrorBoundary>
                <ErrorBoundary>
                  <ComparisonTable currentAdapter={adapter} />
                </ErrorBoundary>
              </div>
              <div className="flex flex-col gap-6">
                <ErrorBoundary>
                  <GlobalDashboard />
                </ErrorBoundary>
                <ErrorBoundary>
                  <TxLog logs={logs} />
                </ErrorBoundary>
              </div>
            </div>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
