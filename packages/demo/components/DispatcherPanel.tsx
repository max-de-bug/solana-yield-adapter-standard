"use client";

import { useEffect, useState, useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Transaction, SystemProgram } from "@solana/web3.js";
import { Program, AnchorProvider } from "@anchor-lang/core";

import { PROGRAM_IDS } from "@/lib/constants";
import { dispatcherStatePda } from "@/lib/dispatcher";
import { parseAnchorError } from "@/lib/errors";
import dispatcherIdl from "@/lib/idl/yield_dispatcher.json";
import type { LogEntry } from "./TxLog";

interface State {
  authority: string;
  registryProgramId: string;
  totalDeposits: number;
  totalWithdrawals: number;
  isPaused: boolean;
  bump: number;
}

interface Props {
  onLog: (entry: Omit<LogEntry, "id">) => void;
}

export default function DispatcherPanel({ onLog }: Props) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [state, setState] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [initializing, setInitializing] = useState(false);

  const fetchData = useCallback(async () => {
    if (!wallet.publicKey) return;
    setLoading(true);
    try {
      const provider = new AnchorProvider(connection, wallet as any, { commitment: "confirmed" });
      const idl = { ...dispatcherIdl, address: PROGRAM_IDS.dispatcher.toBase58() } as any;
      const program = new Program(idl, provider);

      const dsPda = dispatcherStatePda(PROGRAM_IDS.dispatcher);
      const info = await connection.getAccountInfo(dsPda);
      if (!info) {
        setState(null);
        setLoading(false);
        return;
      }

      const ds = await (program.account as any).dispatcherState.fetch(dsPda);
      setState({
        authority: ds.authority.toBase58(),
        registryProgramId: ds.registryProgramId.toBase58(),
        totalDeposits: Number(ds.totalDeposits),
        totalWithdrawals: Number(ds.totalWithdrawals),
        isPaused: ds.isPaused,
        bump: ds.bump,
      });
    } catch (err: unknown) {
      console.warn("dispatcher fetch:", err);
      setState(null);
    } finally {
      setLoading(false);
    }
  }, [connection, wallet]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleInitialize = useCallback(async () => {
    if (!wallet.signTransaction || !wallet.publicKey) return;
    setInitializing(true);
    try {
      const provider = new AnchorProvider(connection, wallet as any, { commitment: "confirmed" });
      const idl = { ...dispatcherIdl, address: PROGRAM_IDS.dispatcher.toBase58() } as any;
      const program = new Program(idl, provider);

      const dsPda = dispatcherStatePda(PROGRAM_IDS.dispatcher);

      const ix = await program.methods
        .initialize()
        .accounts({
          authority: wallet.publicKey,
          dispatcherState: dsPda,
          registryProgram: PROGRAM_IDS.registry,
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      const tx = new Transaction().add(ix);
      tx.feePayer = wallet.publicKey;
      const bh = await connection.getLatestBlockhash();
      tx.recentBlockhash = bh.blockhash;
      const sig = await wallet.sendTransaction!(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      onLog({ type: "success", message: "Dispatcher initialized", txSig: sig });
      await fetchData();
    } catch (err: unknown) {
      const { message } = parseAnchorError(err);
      onLog({ type: "error", message: `Dispatcher init failed: ${message}` });
    } finally {
      setInitializing(false);
    }
  }, [connection, wallet, onLog, fetchData]);

  const handleTogglePause = useCallback(async () => {
    if (!wallet.signTransaction || !wallet.publicKey) return;
    setToggling(true);
    try {
      const provider = new AnchorProvider(connection, wallet as any, { commitment: "confirmed" });
      const idl = { ...dispatcherIdl, address: PROGRAM_IDS.dispatcher.toBase58() } as any;
      const program = new Program(idl, provider);

      const dsPda = dispatcherStatePda(PROGRAM_IDS.dispatcher);

      const ix = await program.methods
        .togglePause()
        .accounts({
          authority: wallet.publicKey,
          dispatcherState: dsPda,
        })
        .instruction();

      const tx = new Transaction().add(ix);
      tx.feePayer = wallet.publicKey;
      const bh = await connection.getLatestBlockhash();
      tx.recentBlockhash = bh.blockhash;
      const sig = await wallet.sendTransaction!(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      const action = state?.isPaused ? "resumed" : "paused";
      onLog({ type: "success", message: `Dispatcher ${action}`, txSig: sig });
      await fetchData();
    } catch (err: unknown) {
      const { message } = parseAnchorError(err);
      onLog({ type: "error", message: `Toggle failed: ${message}` });
    } finally {
      setToggling(false);
    }
  }, [connection, wallet, onLog, fetchData, state]);

  const isAuthority = state && wallet.publicKey && state.authority === wallet.publicKey.toBase58();

  if (loading) {
    return (
      <section className="rounded-lg border border-[#2a2d35] bg-[#14161b] p-4">
        <div className="h-12 animate-pulse rounded bg-[#2a2d35]" />
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-[#2a2d35] bg-[#14161b] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Dispatcher</h3>
        {state && (
          <span className={`text-[11px] font-semibold uppercase tracking-wider ${state.isPaused ? "text-[#e74c3c]" : "text-[#2ecc71]"}`}>
            {state.isPaused ? "Paused" : "Active"}
          </span>
        )}
      </div>

      {!state && (
        <div className="rounded-lg border border-[#e67e22]/30 bg-[#e67e22]/10 px-4 py-3">
          <p className="text-xs text-muted mb-2">Not initialized on devnet.</p>
          <button className="btn btn-initialize mt-1" onClick={handleInitialize} disabled={initializing}>
            {initializing ? "Initializing..." : "initialize()"}
          </button>
        </div>
      )}

      {state && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded bg-[#1c1f26] px-2 py-1.5">
              <span className="text-muted">Deposits</span>
              <p className="font-mono">{state.totalDeposits}</p>
            </div>
            <div className="rounded bg-[#1c1f26] px-2 py-1.5">
              <span className="text-muted">Withdrawals</span>
              <p className="font-mono">{state.totalWithdrawals}</p>
            </div>
          </div>

          {isAuthority && (
            <button
              className="btn btn-value w-full text-xs"
              onClick={handleTogglePause}
              disabled={toggling}
            >
              {toggling ? "Toggling..." : `togglePause()`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
