"use client";

import { useState, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

import TopNavBar from "@/components/TopNavBar";
import Sidebar from "@/components/Sidebar";
import Footer from "@/components/Footer";
import AdapterCard from "@/components/AdapterCard";
import RegistryPanel from "@/components/RegistryPanel";
import DispatcherPanel from "@/components/DispatcherPanel";
import TxLog from "@/components/TxLog";
import ErrorBoundary from "@/components/ErrorBoundary";
import type { LogEntry } from "@/components/TxLog";
import { ADAPTERS } from "@/lib/adapters";
import type { AdapterName } from "@/lib/constants";
import { DEPLOYED_ADAPTERS } from "@/lib/constants";

export default function Home() {
  const { connected } = useWallet();
  const [activeView, setActiveView] = useState("playground");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [useDispatcher, setUseDispatcher] = useState(false);

  const addLog = useCallback((entry: Omit<LogEntry, "id">) => {
    setLogs((prev) => [{ id: Date.now() + Math.random(), ...entry }, ...prev]);
  }, []);

  const filtered = ADAPTERS.filter((a) => DEPLOYED_ADAPTERS.has(a.name as AdapterName));

  return (
    <div className="min-h-screen flex flex-col">
      <TopNavBar />
      <Sidebar activeView={activeView} onViewChange={setActiveView} />

      <main className="ml-0 md:ml-64 mt-16 pt-8 px-margin-mobile md:px-margin-desktop pb-24 max-w-container-max mx-auto w-full">
        {activeView === "playground" && (
          <>
            <header className="mb-12 flex flex-col md:flex-row justify-between items-start md:items-end gap-6 border-b border-outline-variant pb-8">
              <div>
                <h1 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg text-primary mb-2">Yield Adapters</h1>
                <p className="font-body-md text-body-md text-on-surface-variant max-w-2xl">
                  All {filtered.length} adapters implement the same 3-instruction interface: deposit, currentValue, withdraw
                </p>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useDispatcher}
                    onChange={(e) => setUseDispatcher(e.target.checked)}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  <span className="font-label-sm text-label-sm text-on-surface-variant">Route through Dispatcher</span>
                </label>
                <div className="flex items-center gap-2 bg-surface-container px-4 py-2 rounded-full border border-outline-variant">
                  <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  <span className="font-label-sm text-label-sm text-primary uppercase tracking-wider">Devnet</span>
                </div>
              </div>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-gutter">
              {filtered.map((a) => (
                <ErrorBoundary key={a.name}>
                  <AdapterCard name={a.name as AdapterName} onLog={addLog} useDispatcher={useDispatcher} />
                </ErrorBoundary>
              ))}
            </div>
          </>
        )}

        {activeView === "registry" && (
          <>
            <header className="mb-12 border-b border-outline-variant pb-8">
              <h1 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg text-primary mb-2">Registry</h1>
              <p className="font-body-md text-body-md text-on-surface-variant">Governance-gated on-chain registry for yield adapters.</p>
            </header>
            <ErrorBoundary>
              <RegistryPanel />
            </ErrorBoundary>
          </>
        )}

        {activeView === "dispatcher" && (
          <>
            <header className="mb-12 border-b border-outline-variant pb-8">
              <h1 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg text-primary mb-2">Dispatcher</h1>
              <p className="font-body-md text-body-md text-on-surface-variant">Routes deposits/withdrawals through the registry to approved adapters.</p>
            </header>
            <ErrorBoundary>
              <DispatcherPanel onLog={addLog} />
            </ErrorBoundary>
          </>
        )}

        {activeView === "log" && (
          <>
            <header className="mb-12 border-b border-outline-variant pb-8">
              <h1 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg text-primary mb-2">Transaction Log</h1>
              <p className="font-body-md text-body-md text-on-surface-variant">Recent transaction history from this session.</p>
            </header>
            <TxLog logs={logs} />
          </>
        )}
      </main>

      <Footer />
    </div>
  );
}
