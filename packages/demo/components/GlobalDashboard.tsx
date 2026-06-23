"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction, SystemProgram } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction, getAccount } from "@solana/spl-token";
import BN from "bn.js";
import { Program } from "@anchor-lang/core";

import { ADAPTERS, getAdapter, getVaultStatePda, getVaultAuthorityPda } from "@/lib/adapters";
import { adapterUserPositionPda } from "@/lib/pda";
import { formatU64, parseAnchorError } from "@/lib/errors";
import { makeProvider, makeProgram } from "@/lib/anchor";
import { PROGRAM_IDS, USDC_MINT, TOKEN_PROGRAM_ID } from "@/lib/constants";
import type { AdapterName } from "@/lib/constants";

interface PositionSummary {
  adapterLabel: string;
  adapterName: string;
  deposited: string;
  shares: string;
  exists: boolean;
}

const OFF = {
  AUTHORITY: 8,
  TOTAL_UNDERLYING: 8 + 32 + 32,
  TOTAL_SHARES: 8 + 32 + 32 + 8,
  POSITION_SHARES: 8 + 32 + 32 + 8 + 8,
};

function readBigU64(data: Uint8Array, offset: number): bigint {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset, true);
}

export default function GlobalDashboard() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [adapterPositions, setAdapterPositions] = useState<PositionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState("1");
  const [busyAdapter, setBusyAdapter] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"deposit" | "value" | "withdraw" | null>(null);
  const [valueResults, setValueResults] = useState<Record<string, string>>({});
  const adapterRefs = useRef<Record<string, Program>>({});

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

  useEffect(() => {
    if (!wallet.publicKey) return;
    const provider = makeProvider(connection, wallet);
    for (const a of ADAPTERS) {
      const cfg = getAdapter(a.name as AdapterName);
      adapterRefs.current[a.name] = makeProgram(cfg.idl, cfg.id, provider);
    }
  }, [connection, wallet]);

  const vaultAccounts = useCallback((name: string) => {
    const cfg = getAdapter(name as AdapterName);
    const authority = getVaultAuthorityPda(cfg.id, cfg.vaultAuthoritySeed);
    const state = getVaultStatePda(cfg.id, cfg.vaultStateSeed);
    const ata = getAssociatedTokenAddressSync(USDC_MINT, authority, true);
    return { vaultAuthority: authority, vaultState: state, vaultTokenAccount: ata };
  }, []);

  const sendTx = useCallback(async (ix: any, label: string) => {
    if (!wallet.signTransaction || !wallet.publicKey) throw new Error("Wallet not connected");
    const tx = new Transaction().add(ix);
    tx.feePayer = wallet.publicKey;
    const bh = await connection.getLatestBlockhash();
    tx.recentBlockhash = bh.blockhash;
    const signed = await wallet.signTransaction!(tx);
    const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
    await connection.confirmTransaction({
      signature: sig,
      blockhash: bh.blockhash,
      lastValidBlockHeight: bh.lastValidBlockHeight + 150,
    });
    return sig;
  }, [connection, wallet]);

  const ensureUserAta = useCallback(async (): Promise<PublicKey> => {
    if (!wallet.publicKey) throw new Error("Wallet not connected");
    const ata = getAssociatedTokenAddressSync(USDC_MINT, wallet.publicKey);
    const info = await connection.getAccountInfo(ata);
    if (info) return ata;
    const ix = createAssociatedTokenAccountInstruction(wallet.publicKey, ata, wallet.publicKey, USDC_MINT);
    const tx = new Transaction().add(ix);
    tx.feePayer = wallet.publicKey;
    const bh = await connection.getLatestBlockhash();
    tx.recentBlockhash = bh.blockhash;
    const signed = await wallet.signTransaction!(tx);
    const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
    await connection.confirmTransaction({
      signature: sig,
      blockhash: bh.blockhash,
      lastValidBlockHeight: bh.lastValidBlockHeight + 150,
    });
    return ata;
  }, [connection, wallet]);

  const ensureVaultAta = useCallback(async (name: string) => {
    const va = vaultAccounts(name);
    const existing = await connection.getAccountInfo(va.vaultTokenAccount);
    if (existing) return;
    if (!wallet.publicKey) throw new Error("Wallet not connected");
    const ix = createAssociatedTokenAccountInstruction(
      wallet.publicKey,
      va.vaultTokenAccount,
      va.vaultAuthority,
      USDC_MINT,
    );
    await sendTx(ix, `Created vault ATA for ${name}`);
  }, [connection, wallet, vaultAccounts, sendTx]);

  const handleDeposit = useCallback(async (name: string) => {
    if (!wallet.publicKey) return;
    const prog = adapterRefs.current[name];
    if (!prog) return;
    const cfg = getAdapter(name as AdapterName);
    setBusyAdapter(name);
    setBusyAction("deposit");
    try {
      await ensureVaultAta(name);
      const ata = await ensureUserAta();
      const amountRaw = Math.round(parseFloat(amount) * 1_000_000);
      if (!(amountRaw > 0)) throw new Error("Amount must be greater than 0");
      const va = vaultAccounts(name);
      const [userPosition] = adapterUserPositionPda(cfg.id, wallet.publicKey);
      const ix = await prog.methods.deposit(new BN(amountRaw), new BN(0)).accounts({
        user: wallet.publicKey,
        vaultState: va.vaultState,
        userPosition,
        userTokenAccount: ata,
        vaultAuthority: va.vaultAuthority,
        vaultTokenAccount: va.vaultTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      }).instruction();
      await sendTx(ix, `Deposited ${amount} → ${cfg.label}`);
      await fetchData();
    } catch (err: unknown) {
      console.warn(`Deposit ${name} failed:`, err);
    } finally {
      setBusyAdapter(null);
      setBusyAction(null);
    }
  }, [amount, wallet, vaultAccounts, ensureUserAta, ensureVaultAta, sendTx, fetchData]);

  const handleCurrentValue = useCallback(async (name: string) => {
    if (!wallet.publicKey) return;
    const prog = adapterRefs.current[name];
    if (!prog) return;
    const cfg = getAdapter(name as AdapterName);
    setBusyAdapter(name);
    setBusyAction("value");
    try {
      const va = vaultAccounts(name);
      const [userPosition] = adapterUserPositionPda(cfg.id, wallet.publicKey);
      const ix = await prog.methods.currentValue().accounts({
        user: wallet.publicKey,
        vaultState: va.vaultState,
        userPosition,
      }).instruction();
      const sig = await sendTx(ix, `Queried current_value for ${cfg.label}`);
      const txInfo = await connection.getTransaction(sig, { commitment: "confirmed" });
      const logs = txInfo?.meta?.logMessages?.join("\n") ?? "";
      const match = logs.match(/(\d+)\s*shares?/i);
      const val = match ? formatU64(match[1]) : "ok";
      setValueResults((prev) => ({ ...prev, [name]: val }));
    } catch (err: unknown) {
      console.warn(`currentValue ${name} failed:`, err);
    } finally {
      setBusyAdapter(null);
      setBusyAction(null);
    }
  }, [wallet, vaultAccounts, sendTx, connection]);

  const handleWithdraw = useCallback(async (name: string) => {
    if (!wallet.publicKey) return;
    const prog = adapterRefs.current[name];
    if (!prog) return;
    const cfg = getAdapter(name as AdapterName);
    setBusyAdapter(name);
    setBusyAction("withdraw");
    try {
      await ensureVaultAta(name);
      const ata = await ensureUserAta();
      const sharesRaw = Math.round(parseFloat(amount) * 1_000_000);
      if (!(sharesRaw > 0)) throw new Error("Amount must be greater than 0");
      const va = vaultAccounts(name);
      const [userPosition] = adapterUserPositionPda(cfg.id, wallet.publicKey);
      const ix = await prog.methods.withdraw(new BN(sharesRaw), new BN(0)).accounts({
        user: wallet.publicKey,
        vaultState: va.vaultState,
        userPosition,
        userTokenAccount: ata,
        vaultTokenAccount: va.vaultTokenAccount,
        vaultAuthority: va.vaultAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).instruction();
      await sendTx(ix, `Withdrew ${amount} shares from ${cfg.label}`);
      setValueResults((prev) => ({ ...prev, [name]: "" }));
      await fetchData();
    } catch (err: unknown) {
      console.warn(`Withdraw ${name} failed:`, err);
    } finally {
      setBusyAdapter(null);
      setBusyAction(null);
    }
  }, [amount, wallet, vaultAccounts, ensureUserAta, ensureVaultAta, sendTx, fetchData]);

  const isBusy = (name: string) => busyAdapter === name;

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

      {!loading && wallet.publicKey && (
        <>
          {/* Amount input */}
          <div className="mb-3">
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted">Amount (USDC)</label>
            <input
              type="number" min={0.001} step={0.1} value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-lg border border-[#2a2d35] bg-[#1c1f26] px-3 py-2 font-mono text-base text-white outline-none transition-colors focus:border-accent"
            />
          </div>

          {/* All adapters table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#2a2d35] text-muted">
                  <th className="px-2 py-1.5 text-left font-semibold">Adapter</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Deposited</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Shares</th>
                  <th className="px-2 py-1.5 text-center font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {adapterPositions.map((p) => (
                  <tr key={p.adapterName} className="border-b border-[#2a2d35]/30">
                    <td className="px-2 py-1.5 font-medium">{p.adapterLabel}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-[#2ecc71]">{p.deposited}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{p.shares}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          className="rounded bg-[#6c5ce7] px-1.5 py-1 text-[10px] font-semibold text-white hover:bg-[#5a4bd1] disabled:opacity-40"
                          onClick={() => handleDeposit(p.adapterName)}
                          disabled={isBusy(p.adapterName)}
                        >
                          {isBusy(p.adapterName) && busyAction === "deposit" ? "..." : "deposit(amount)"}
                        </button>
                        <button
                          className="rounded bg-[#3498db] px-1.5 py-1 text-[10px] font-semibold text-white hover:bg-[#2980b9] disabled:opacity-40"
                          onClick={() => handleCurrentValue(p.adapterName)}
                          disabled={isBusy(p.adapterName) || !p.exists}
                          title={!p.exists ? "Deposit first" : ""}
                        >
                          {isBusy(p.adapterName) && busyAction === "value" ? "..." : "currentValue()"}
                        </button>
                        <button
                          className="rounded bg-[#e74c3c] px-1.5 py-1 text-[10px] font-semibold text-white hover:bg-[#c0392b] disabled:opacity-40"
                          onClick={() => handleWithdraw(p.adapterName)}
                          disabled={isBusy(p.adapterName) || !p.exists}
                          title={!p.exists ? "Deposit first" : ""}
                        >
                          {isBusy(p.adapterName) && busyAction === "withdraw" ? "..." : "withdraw(shares)"}
                        </button>
                        {valueResults[p.adapterName] && (
                          <span className="ml-1 font-mono text-[10px] text-[#2ecc71]">{valueResults[p.adapterName]}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}