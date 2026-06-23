"use client";

import { useCallback, useState, useEffect, useRef } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction, SystemProgram } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction, getAccount } from "@solana/spl-token";
import BN from "bn.js";

import { getAdapter, getVaultStatePda, getVaultAuthorityPda, getVaultSyrupPda } from "@/lib/adapters";
import { adapterUserPositionPda, findPda } from "@/lib/pda";
import { PROGRAM_IDS, USDC_MINT, SYRUP_USDC_MINT, TOKEN_PROGRAM_ID, type AdapterName } from "@/lib/constants";
import { parseAnchorError, formatU64 } from "@/lib/errors";
import { adapterEntryPda } from "@/lib/registry";
import { dispatcherStatePda, dispatcherUserPositionPda } from "@/lib/dispatcher";
import { Program } from "@anchor-lang/core";
import { makeProvider, makeProgram } from "@/lib/anchor";
import dispatcherIdl from "@/lib/idl/yield_dispatcher.json";
import type { LogEntry } from "./TxLog";

const ADAPTER_TYPES: Record<string, string> = {
  kamino: "LENDING",
  marginfi: "LENDING",
  jupiter: "LIQUIDITY",
  maple: "POOL",
  drift: "PERP",
  template: "TEMPLATE",
};

const ADAPTER_ICONS: Record<string, string> = {
  kamino: "account_balance_wallet",
  marginfi: "trending_up",
  jupiter: "water_drop",
  maple: "pie_chart",
  drift: "timeline",
  template: "add_box",
};

const STATUS_OFFSETS: Record<string, number> = {
  kamino: 136, marginfi: 136, jupiter: 136,
  maple: 168, drift: 144, template: 136,
};

const STATUS_FROM_DISCR: Record<number, string> = {
  0: "Active", 1: "Paused", 2: "Deprecated", 3: "DepositsPaused",
};

const OFF = {
  AUTHORITY: 8,
  TOTAL_UNDERLYING: 8 + 32 + 32,
  TOTAL_SHARES: 8 + 32 + 32 + 8,
  POSITION_SHARES: 8 + 32 + 32 + 8 + 8,
};

const vaultMint = (name: AdapterName) => (name === "maple" ? SYRUP_USDC_MINT : USDC_MINT);

function vaultAccounts(name: AdapterName) {
  const cfg = getAdapter(name);
  const mint = vaultMint(name);
  const authority = getVaultAuthorityPda(cfg.id, cfg.vaultAuthoritySeed);
  const state = getVaultStatePda(cfg.id, cfg.vaultStateSeed);
  const ata = getAssociatedTokenAddressSync(mint, authority, true);
  return { vaultAuthority: authority, vaultState: state, vaultTokenAccount: ata };
}

function readVaultStatus(bytes: Uint8Array, name: AdapterName): string {
  const offset = STATUS_OFFSETS[name] ?? 136;
  return STATUS_FROM_DISCR[bytes[offset] ?? 0] ?? "Active";
}

function readBigU64(data: Uint8Array, offset: number): bigint {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset, true);
}

interface AdapterCardProps {
  name: AdapterName;
  onLog: (entry: Omit<LogEntry, "id">) => void;
  useDispatcher: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  Active: "#2ecc71",
  DepositsPaused: "#e67e22",
  Paused: "#e74c3c",
  Deprecated: "#8b8f97",
};

export default function AdapterCard({ name, onLog, useDispatcher }: AdapterCardProps) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const cfg = getAdapter(name);
  const [amount, setAmount] = useState("1");
  const [txStatus, setTxStatus] = useState<string>("idle");
  const [currentValue, setCurrentValue] = useState<string | null>(null);
  const [vaultExists, setVaultExists] = useState<boolean | null>(null);
  const [vaultStatus, setVaultStatus] = useState<string | null>(null);
  const [positionExists, setPositionExists] = useState(false);
  const [metrics, setMetrics] = useState<{ totalUnderlying: string; totalShares: string; userShares: string; userValue: string } | null>(null);
  const [userBalance, setUserBalance] = useState<bigint | null>(null);
  const [userAta, setUserAta] = useState<PublicKey | null>(null);
  const [showInput, setShowInput] = useState<"deposit" | "withdraw" | null>(null);
  const adapterRef = useRef<Program | null>(null);
  const dispatcherRef = useRef<Program | null>(null);
  const cancelledRef = useRef(false);

  const va = vaultAccounts(name);
  const [positionAddr] = adapterUserPositionPda(cfg.id, wallet.publicKey ?? PublicKey.default);

  const sendTx = useCallback(async (ix: any, label: string) => {
    const tx = new Transaction().add(ix);
    tx.feePayer = wallet.publicKey!;
    const bh = await connection.getLatestBlockhash();
    tx.recentBlockhash = bh.blockhash;
    let sig: string;
    try {
      const signed = await wallet.signTransaction!(tx);
      sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
    } catch (sendErr: unknown) {
      const sendErrObj = sendErr as any;
      const candidate =
        sendErrObj.transactionMessage ??
        sendErrObj.error?.transactionMessage ??
        sendErrObj.error?.message ??
        (Array.isArray(sendErrObj.logs)
          ? sendErrObj.logs.filter((l: string) => l.startsWith("Program log:") && !l.includes("Dispatcher ")).pop()?.replace("Program log: ", "")
          : null) ??
        (Array.isArray(sendErrObj.error?.logs)
          ? sendErrObj.error.logs.filter((l: string) => l.startsWith("Program log:") && !l.includes("Dispatcher ")).pop()?.replace("Program log: ", "")
          : null) ??
        null;
      const better = candidate && candidate !== "Internal error" ? String(candidate) : null;
      if (!better) {
        throw new Error("Wallet failed to sign — ensure your wallet is on Devnet with SOL for fees.");
      }
      throw new Error(better);
    }
    try {
      await connection.confirmTransaction({
        signature: sig,
        blockhash: bh.blockhash,
        lastValidBlockHeight: bh.lastValidBlockHeight + 150,
      });
    } catch (confirmErr) {
      if (confirmErr instanceof Error) {
        throw new Error((confirmErr as any).transactionMessage ?? confirmErr.message);
      }
      throw confirmErr;
    }
    onLog({ type: "success", message: label, txSig: sig });
    return sig;
  }, [connection, wallet, onLog]);

  const fetchChainData = useCallback(async () => {
    if (!adapterRef.current || !wallet.publicKey) return;
    const [vaultInfo, posInfo] = await Promise.all([
      connection.getAccountInfo(va.vaultState),
      connection.getAccountInfo(positionAddr),
    ]);
    if (cancelledRef.current) return;

    if (vaultInfo) {
      const status = readVaultStatus(vaultInfo.data, name);
      setVaultExists(true);
      setVaultStatus(status);
      const totalUnderlying = readBigU64(vaultInfo.data, OFF.TOTAL_UNDERLYING);
      const totalShares = readBigU64(vaultInfo.data, OFF.TOTAL_SHARES);
      if (posInfo) {
        const shares = readBigU64(posInfo.data, OFF.POSITION_SHARES);
        setPositionExists(true);
        setMetrics({
          totalUnderlying: formatU64(totalUnderlying),
          totalShares: formatU64(totalShares),
          userShares: formatU64(shares),
          userValue: totalShares > BigInt(0)
            ? formatU64(shares * totalUnderlying / totalShares)
            : formatU64(BigInt(0)),
        });
      } else {
        setPositionExists(false);
        setMetrics({
          totalUnderlying: formatU64(totalUnderlying),
          totalShares: formatU64(totalShares),
          userShares: "0",
          userValue: "0",
        });
      }
    } else {
      setVaultExists(false);
      setVaultStatus(null);
      setPositionExists(false);
      setMetrics(null);
    }
  }, [connection, va, positionAddr, name, wallet]);

  const ensureUserAta = useCallback(async (): Promise<PublicKey> => {
    const mint = vaultMint(name);
    const ata = getAssociatedTokenAddressSync(mint, wallet.publicKey!);
    if (userAta?.equals(ata)) return ata;
    const info = await connection.getAccountInfo(ata);
    if (info) { setUserAta(ata); return ata; }
    const ix = createAssociatedTokenAccountInstruction(wallet.publicKey!, ata, wallet.publicKey!, mint);
    const tx = new Transaction().add(ix);
    tx.feePayer = wallet.publicKey!;
    const bh = await connection.getLatestBlockhash();
    tx.recentBlockhash = bh.blockhash;
    const sig = await wallet.sendTransaction!(tx, connection);
    await connection.confirmTransaction(sig, "confirmed");
    setUserAta(ata);
    return ata;
  }, [connection, wallet, name, userAta]);

  const ensureVaultAta = useCallback(async (): Promise<void> => {
    const existing = await connection.getAccountInfo(va.vaultTokenAccount);
    if (existing) return;
    const ix = createAssociatedTokenAccountInstruction(
      wallet.publicKey!,
      va.vaultTokenAccount,
      va.vaultAuthority,
      vaultMint(name),
    );
    await sendTx(ix, `Created vault ATA for ${cfg.label}`);
  }, [va, cfg, connection, wallet, sendTx, name]);

  useEffect(() => {
    if (!wallet.publicKey) return;
    cancelledRef.current = false;
    setVaultExists(null);
    setVaultStatus(null);
    setPositionExists(false);
    setMetrics(null);
    setCurrentValue(null);

    const provider = makeProvider(connection, wallet);
    adapterRef.current = makeProgram(cfg.idl, cfg.id, provider);
    dispatcherRef.current = makeProgram(dispatcherIdl, PROGRAM_IDS.dispatcher, provider);

    connection.getAccountInfo(va.vaultState).then((info) => {
      if (cancelledRef.current) return;
      setVaultExists(!!info);
      if (info) {
        setVaultStatus(readVaultStatus(info.data, name));
      }
    });

    const ata = getAssociatedTokenAddressSync(vaultMint(name), wallet.publicKey);
    connection.getAccountInfo(ata).then((info) => {
      if (!cancelledRef.current && info) setUserAta(ata);
    });

    (async () => {
      const ata = getAssociatedTokenAddressSync(vaultMint(name), wallet.publicKey!);
      try {
        const info = await getAccount(connection, ata, "confirmed");
        if (!cancelledRef.current) setUserBalance(info.amount);
      } catch {
        if (!cancelledRef.current) setUserBalance(BigInt(0));
      }
    })();

    return () => { cancelledRef.current = true; };
  }, [name, connection, wallet, cfg, va]);

  useEffect(() => {
    if (vaultExists === true) fetchChainData();
  }, [vaultExists, fetchChainData]);

  const handleInitialize = useCallback(async () => {
    if (!adapterRef.current || !wallet.signTransaction || !wallet.publicKey) return;
    setTxStatus("initializing");
    try {
      const initAccounts: Record<string, PublicKey> = {
        authority: wallet.publicKey,
        vault_state: va.vaultState,
        system_program: SystemProgram.programId,
      };
      if (name === "maple") {
        initAccounts.vault_authority = va.vaultAuthority;
        initAccounts.underlying_mint = USDC_MINT;
        initAccounts.syrup_mint = SYRUP_USDC_MINT;
        initAccounts.vault_syrup = getVaultSyrupPda(cfg.id);
        initAccounts.token_program = TOKEN_PROGRAM_ID;
      }
      const ix = await adapterRef.current.methods.initialize(USDC_MINT).accounts(initAccounts).instruction();
      await sendTx(ix, `Initialized ${cfg.label} vault`);
      const vaultAta = getAssociatedTokenAddressSync(USDC_MINT, va.vaultAuthority, true);
      const ataInfo = await connection.getAccountInfo(vaultAta);
      if (!ataInfo) {
        const createAtaIx = createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          vaultAta,
          va.vaultAuthority,
          USDC_MINT,
        );
        await sendTx(createAtaIx, `Created vault ATA for ${cfg.label}`);
      }
      setVaultExists(true);
      setVaultStatus("Active");
    } catch (err: unknown) {
      onLog({ type: "error", message: `Initialize failed: ${parseAnchorError(err).message}` });
    } finally { setTxStatus("idle"); }
  }, [cfg, connection, wallet, onLog, name, va, sendTx]);

  const handleDeposit = useCallback(async () => {
    if (!adapterRef.current || !dispatcherRef.current || !wallet.signTransaction || !wallet.publicKey) return;
    setTxStatus("depositing");
    try {
      await ensureVaultAta();
      const ata = await ensureUserAta();
      const amountRaw = Math.round(parseFloat(amount) * 1_000_000);
      if (!(amountRaw > 0)) throw new Error("Amount must be greater than 0");
      const [userPosition] = adapterUserPositionPda(cfg.id, wallet.publicKey);
      const prog = useDispatcher ? dispatcherRef.current! : adapterRef.current!;
      const accts: Record<string, PublicKey> = useDispatcher
        ? {
            user: wallet.publicKey,
            dispatcherState: dispatcherStatePda(PROGRAM_IDS.dispatcher),
            userPosition: dispatcherUserPositionPda(PROGRAM_IDS.dispatcher, wallet.publicKey, cfg.id),
            registryProgram: PROGRAM_IDS.registry,
            adapterEntry: adapterEntryPda(PROGRAM_IDS.registry, cfg.id),
            adapterProgram: cfg.id,
            userTokenAccount: ata,
            adapterVaultState: va.vaultState,
            adapterVault: va.vaultTokenAccount,
            adapterVaultAuthority: va.vaultAuthority,
            adapterUserPosition: userPosition,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          }
        : {
            user: wallet.publicKey,
            vaultState: va.vaultState,
            userPosition,
            userTokenAccount: ata,
            vaultAuthority: va.vaultAuthority,
            vaultTokenAccount: va.vaultTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          };
      const ix = await prog.methods.deposit(new BN(amountRaw), new BN(0)).accounts(accts).instruction();
      await sendTx(ix, `Deposited ${amount} → ${cfg.label}${useDispatcher ? " (via dispatcher)" : ""}`);
      const balAta = getAssociatedTokenAddressSync(vaultMint(name), wallet.publicKey);
      try {
        const info = await getAccount(connection, balAta, "confirmed");
        setUserBalance(info.amount);
      } catch { setUserBalance(BigInt(0)); }
      setShowInput(null);
      await fetchChainData();
    } catch (err: unknown) {
      onLog({ type: "error", message: `Deposit failed: ${parseAnchorError(err).message}` });
    } finally { setTxStatus("idle"); }
  }, [amount, cfg, connection, ensureUserAta, ensureVaultAta, wallet, name, useDispatcher, va, sendTx, fetchChainData, onLog]);

  const handleWithdraw = useCallback(async () => {
    if (!adapterRef.current || !dispatcherRef.current || !wallet.signTransaction || !wallet.publicKey) return;
    setTxStatus("withdrawing");
    try {
      await ensureVaultAta();
      const ata = await ensureUserAta();
      const sharesRaw = Math.round(parseFloat(amount) * 1_000_000);
      if (!(sharesRaw > 0)) throw new Error("Amount must be greater than 0");
      const [userPosition] = adapterUserPositionPda(cfg.id, wallet.publicKey);
      const prog = useDispatcher ? dispatcherRef.current! : adapterRef.current!;

      let accts: Record<string, PublicKey>;
      if (useDispatcher) {
        accts = {
          user: wallet.publicKey,
          dispatcherState: dispatcherStatePda(PROGRAM_IDS.dispatcher),
          userPosition: dispatcherUserPositionPda(PROGRAM_IDS.dispatcher, wallet.publicKey, cfg.id),
          registryProgram: PROGRAM_IDS.registry,
          adapterEntry: adapterEntryPda(PROGRAM_IDS.registry, cfg.id),
          adapterProgram: cfg.id,
          userTokenAccount: ata,
          adapterVaultState: va.vaultState,
          adapterVault: va.vaultTokenAccount,
          adapterVaultAuthority: va.vaultAuthority,
          adapterUserPosition: userPosition,
          tokenProgram: TOKEN_PROGRAM_ID,
        };
      } else if (name === "drift") {
        const ticketPda = findPda(
          [Buffer.from("withdrawal_ticket"), wallet.publicKey.toBuffer()],
          cfg.id
        )[0];
        accts = {
          user: wallet.publicKey,
          vaultState: va.vaultState,
          userPosition,
          ticket: ticketPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        };
      } else {
        accts = {
          user: wallet.publicKey,
          vaultState: va.vaultState,
          userPosition,
          userTokenAccount: ata,
          vaultTokenAccount: va.vaultTokenAccount,
          vaultAuthority: va.vaultAuthority,
          tokenProgram: TOKEN_PROGRAM_ID,
        };
      }
      const ix = await prog.methods.withdraw(new BN(sharesRaw), new BN(0)).accounts(accts).instruction();
      await sendTx(ix, `Withdrew ${amount} shares from ${cfg.label}${useDispatcher ? " (via dispatcher)" : ""}`);
      setCurrentValue(null);
      try {
        const balAta = getAssociatedTokenAddressSync(USDC_MINT, wallet.publicKey);
        const info = await getAccount(connection, balAta, "confirmed");
        setUserBalance(info.amount);
      } catch { setUserBalance(BigInt(0)); }
      setShowInput(null);
      await fetchChainData();
    } catch (err: unknown) {
      onLog({ type: "error", message: `Withdraw failed: ${parseAnchorError(err).message}` });
    } finally { setTxStatus("idle"); }
  }, [amount, cfg, connection, ensureUserAta, ensureVaultAta, wallet, name, useDispatcher, va, sendTx, fetchChainData, onLog]);

  const handleCurrentValue = useCallback(async () => {
    if (!adapterRef.current || !dispatcherRef.current || !wallet.signTransaction || !wallet.publicKey) return;
    setTxStatus("valuing");
    try {
      const prog = useDispatcher ? dispatcherRef.current! : adapterRef.current!;
      const [userPosition] = adapterUserPositionPda(cfg.id, wallet.publicKey);
      const accts: Record<string, PublicKey> = useDispatcher
        ? {
            user: wallet.publicKey,
            dispatcherState: dispatcherStatePda(PROGRAM_IDS.dispatcher),
            userPosition: dispatcherUserPositionPda(PROGRAM_IDS.dispatcher, wallet.publicKey, cfg.id),
            registryProgram: PROGRAM_IDS.registry,
            adapterEntry: adapterEntryPda(PROGRAM_IDS.registry, cfg.id),
            adapterProgram: cfg.id,
            adapterVaultState: va.vaultState,
            adapterUserPosition: userPosition,
          }
        : {
            user: wallet.publicKey,
            vaultState: va.vaultState,
            userPosition,
          };
      const ix = await prog.methods.currentValue().accounts(accts).instruction();
      const sig = await sendTx(ix, `Queried value for ${cfg.label}`);
      const txInfo = await connection.getTransaction(sig, { commitment: "confirmed" });
      const logs = txInfo?.meta?.logMessages?.join("\n") ?? "";
      const match = logs.match(/(\d+)\s*shares?/i);
      setCurrentValue(match ? formatU64(match[1]) : "ok");
      await fetchChainData();
    } catch (err: unknown) {
      onLog({ type: "error", message: `currentValue failed: ${parseAnchorError(err).message}` });
    } finally { setTxStatus("idle"); }
  }, [cfg, connection, wallet, name, useDispatcher, va, sendTx, fetchChainData, onLog]);

  const isBusy = txStatus !== "idle";
  const typeLabel = ADAPTER_TYPES[name] ?? "UNKNOWN";
  const icon = ADAPTER_ICONS[name] ?? "extension";
  const statusColor = vaultStatus ? (STATUS_COLORS[vaultStatus] ?? "#8b8f97") : null;
  const mintLabel = name === "maple" ? "SYRUP" : "USDC";

  return (
    <div className="bg-surface-container-low border border-outline-variant rounded-lg p-6 hover:border-outline transition-colors relative overflow-hidden group">
      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
      <div className="flex justify-between items-start mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-headline-md text-headline-md text-primary">{cfg.label}</h3>
            {vaultExists !== null && (
              <span className="text-xs uppercase tracking-wider ml-2" style={{ color: statusColor ?? "#8b8f97" }}>
                {vaultExists ? (vaultStatus ?? "Unknown") : "Not init"}
              </span>
            )}
          </div>
          <span className="font-label-sm text-label-sm text-on-surface-variant px-2 py-1 bg-surface border border-outline-variant rounded-DEFAULT">{typeLabel}</span>
        </div>
        <span className="material-symbols-outlined text-outline">{icon}</span>
      </div>

      <div className="border-y border-outline-variant py-4 mb-6">
        {/* Metrics row */}
        {metrics ? (
          <div className="flex items-center justify-between text-xs mb-2">
            <div>
              <span className="text-on-surface-variant">Your shares: </span>
              <span className="font-mono text-primary">{metrics.userShares}</span>
            </div>
            <div>
              <span className="text-on-surface-variant">Est. value: </span>
              <span className="font-mono text-[#2ecc71]">{metrics.userValue}</span>
            </div>
            <div>
              <span className="text-on-surface-variant">Balance: </span>
              <span className="font-mono text-primary">{userBalance !== null ? formatU64(userBalance) : "..."}</span>
              {userBalance !== null && userBalance === BigInt(0) && (
                <button
                  className="ml-1 text-[10px] text-primary underline"
                  onClick={async () => {
                    try {
                      const res = await fetch(`/api/faucet?to=${wallet.publicKey!.toBase58()}`);
                      const data = await res.json();
                      if (!data.success) throw new Error(data.error);
                      const ata = getAssociatedTokenAddressSync(USDC_MINT, wallet.publicKey!);
                      const info = await getAccount(connection, ata, "confirmed");
                      setUserBalance(info.amount);
                      onLog({ type: "success", message: "1,000,000 test tokens received", txSig: data.tx });
                    } catch (e: unknown) {
                      onLog({ type: "error", message: `Faucet error: ${e instanceof Error ? e.message : String(e)}` });
                    }
                  }}
                >
                  Get tokens
                </button>
              )}
            </div>
          </div>
        ) : vaultExists === false ? (
          <div className="flex items-center justify-center py-2">
            <button
              className="bg-surface border border-outline-variant text-primary font-label-md text-label-md px-4 py-2 rounded-DEFAULT hover:bg-surface-container transition-colors active:scale-95"
              onClick={handleInitialize}
              disabled={isBusy}
            >
              {txStatus === "initializing" ? "Initializing..." : "Initialize Vault"}
            </button>
          </div>
        ) : (
          <div className="text-center text-sm text-on-surface-variant py-2">Checking vault state...</div>
        )}

        {vaultExists && (
          <div className="flex items-center gap-2 mb-2">
            <span className="material-symbols-outlined text-primary text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
            <span className="font-label-md text-label-md text-on-surface">Interface Coverage: 3/3</span>
          </div>
        )}
        <p className="font-label-sm text-label-sm text-on-surface-variant ml-7">deposit, currentValue, withdraw</p>
      </div>

      {showInput && (
        <div className="mb-4 flex items-center gap-2">
          <input
            type="number" min={0.001} step={0.1} value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={isBusy}
            className="flex-1 bg-surface border border-outline-variant text-primary font-label-md text-label-md px-3 py-1.5 rounded-DEFAULT focus:outline-none focus:border-primary"
            placeholder={`Amount (${mintLabel})`}
          />
          <button
            className="text-xs text-on-surface-variant hover:text-primary"
            onClick={() => setShowInput(null)}
          >
            Cancel
          </button>
        </div>
      )}

      <div className="flex gap-2">
        <button
          className="flex-1 bg-primary text-on-primary font-label-md text-label-md py-2 rounded-DEFAULT hover:bg-primary-fixed transition-colors active:scale-95 disabled:opacity-40"
          onClick={() => { if (!vaultExists) return; if (showInput === "deposit") handleDeposit(); else setShowInput("deposit"); }}
          disabled={isBusy || vaultExists !== true}
        >
          {txStatus === "depositing" ? "Depositing..." : (showInput === "deposit" ? "Confirm" : "Deposit")}
        </button>
        <button
          className="flex-1 bg-surface border border-outline-variant text-primary font-label-md text-label-md py-2 rounded-DEFAULT hover:bg-surface-container transition-colors active:scale-95 disabled:opacity-40"
          onClick={() => { if (!vaultExists || !positionExists) return; if (showInput === "withdraw") handleWithdraw(); else setShowInput("withdraw"); }}
          disabled={isBusy || vaultExists !== true || !positionExists}
        >
          {txStatus === "withdrawing" ? "Withdrawing..." : (showInput === "withdraw" ? "Confirm" : "Withdraw")}
        </button>
        <button
          className="bg-surface border border-outline-variant text-on-surface-variant hover:text-primary font-label-md text-label-md p-2 rounded-DEFAULT hover:bg-surface-container transition-colors active:scale-95 disabled:opacity-40"
          onClick={handleCurrentValue}
          disabled={isBusy || vaultExists !== true || !positionExists}
          title="Current Value"
        >
          <span className="material-symbols-outlined">data_usage</span>
        </button>
      </div>

      {currentValue !== null && (
        <div className="mt-3 flex items-center gap-2 text-xs text-on-surface-variant">
          <span>Position value:</span>
          <span className="font-mono text-[#2ecc71]">{currentValue}</span>
        </div>
      )}
    </div>
  );
}
