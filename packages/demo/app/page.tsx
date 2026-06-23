"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

import { ADAPTERS } from "@/lib/adapters";
import type { AdapterName } from "@/lib/constants";
import { DEPLOYED_ADAPTERS } from "@/lib/constants";
import TopNavBar from "@/components/TopNavBar";
import Sidebar from "@/components/Sidebar";
import Footer from "@/components/Footer";
import ErrorBoundary from "@/components/ErrorBoundary";
import RegistryPanel from "@/components/RegistryPanel";
import DispatcherPanel from "@/components/DispatcherPanel";
import PlaygroundPanel from "@/components/PlaygroundPanel";
import GlobalDashboard from "@/components/GlobalDashboard";
import ComparisonTable from "@/components/ComparisonTable";
import TxLog from "@/components/TxLog";
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
  const [walletRejected, setWalletRejected] = useState(false);

  useEffect(() => {
    if (!connected || !publicKey) {
      setNetworkCheckDone(false);
      setOnCorrectNetwork(null);
      return;
    }
    let cancelled = false;
    connection.getLatestBlockhash().then(() => {
      if (!cancelled) { setOnCorrectNetwork(true); setNetworkCheckDone(true); }
    }).catch(() => {
      if (!cancelled) { setOnCorrectNetwork(false); setNetworkCheckDone(true); }
    });
    return () => { cancelled = true; };
  }, [connected, publicKey, connection]);

  useEffect(() => {
    setWalletRejected(logs.some(l => l.type === "error" && l.message.includes("Wallet rejected")));
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
  const filtered = ADAPTERS.filter((a) => DEPLOYED_ADAPTERS.has(a.name as AdapterName));

  return (
    <div className="min-h-screen flex flex-col">
      <TopNavBar />

      <div className="flex flex-1">
        <Sidebar activeView="playground" onViewChange={() => {}} />

        <main className="flex-1 ml-0 md:ml-64 mt-16 pt-8 px-margin-mobile md:px-margin-desktop pb-24 max-w-container-max mx-auto w-full">
          {!showContent ? (
            <div className="mx-auto max-w-lg py-20 text-center">
              <h2 className="font-headline-md text-headline-md text-primary mb-3">
                Connect your wallet to interact with yield adapters on devnet
              </h2>
              <p className="font-body-md text-body-md text-on-surface-variant mb-6">
                All 6 adapters implement the same 3-instruction interface:{" "}
                <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">deposit</code>
                ,{" "}
                <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">currentValue</code>
                ,{" "}
                <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">withdraw</code>
              </p>
              <button
                onClick={() => setDemoMode(true)}
                className="bg-surface border border-outline-variant text-primary font-label-md text-label-md px-6 py-2.5 rounded-DEFAULT hover:bg-surface-container transition-colors"
              >
                Explore the UI in Demo Mode
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {/* ── Header ─────────────────────────────── */}
              <header className="flex flex-wrap items-center justify-between gap-4 border-b border-outline-variant pb-6">
                <div>
                  <h1 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg text-primary">
                    Yield Adapter Standard
                  </h1>
                  <p className="font-body-sm text-body-sm text-on-surface-variant">Devnet Playground</p>
                </div>
                <div className="flex items-center gap-3">
                  <select
                    value={adapter}
                    onChange={(e) => setAdapter(e.target.value as AdapterName)}
                    disabled={!showContent}
                    className="bg-surface-container border border-outline-variant text-primary font-label-md text-label-md px-3 py-2 rounded-DEFAULT focus:outline-none focus:border-primary"
                  >
                    {filtered.map((a) => (
                      <option key={a.name} value={a.name}>{a.label}</option>
                    ))}
                  </select>
                  {!connected && (
                    <button
                      onClick={() => setDemoMode((p) => !p)}
                      className={`font-label-md text-label-md px-3 py-2 rounded-DEFAULT border transition-colors ${
                        demoMode
                          ? "bg-primary text-on-primary border-primary"
                          : "bg-surface border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary"
                      }`}
                    >
                      {demoMode ? "Exit Demo" : "Demo Mode"}
                    </button>
                  )}
                </div>
              </header>

              {/* ── Network / Wallet banners ─────────── */}
              {demoMode && (
                <div className="rounded-lg border border-primary/40 bg-primary/5 px-4 py-3 text-center font-body-sm text-body-sm text-primary">
                  Demo Mode — connect a wallet to interact with live devnet data
                </div>
              )}
              {!demoMode && walletRejected && connected && (
                <div className="rounded-lg border border-error/40 bg-error-container/10 px-4 py-3 text-center font-body-sm text-body-sm text-error">
                  Wallet rejecting transactions — make sure your wallet is set to <strong className="font-semibold">Devnet</strong>{" "}
                  and has SOL for fees.{" "}
                  <a href="https://faucet.solana.com" target="_blank" rel="noreferrer" className="underline">
                    Get devnet SOL
                  </a>
                </div>
              )}

              {/* ── System Overview ──────────────────── */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <ErrorBoundary><RegistryPanel /></ErrorBoundary>
                <ErrorBoundary><DispatcherPanel onLog={addLog} /></ErrorBoundary>
              </div>

              {/* ── Adapter Playground ───────────────── */}
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
      </div>

      <Footer />
    </div>
  );
}
