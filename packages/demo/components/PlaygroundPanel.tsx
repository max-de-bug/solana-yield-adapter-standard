"use client";

import { useCallback, useState, useRef, useEffect } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction, SystemProgram } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import BN from "bn.js";

import { getAdapter, getVaultStatePda, getVaultAuthorityPda, getVaultSyrupPda } from "@/lib/adapters";
import { adapterUserPositionPda } from "@/lib/pda";
import { PROGRAM_IDS, USDC_MINT, SYRUP_USDC_MINT, TOKEN_PROGRAM_ID, type AdapterName } from "@/lib/constants";
import { parseAnchorError, formatU64 } from "@/lib/errors";
import { adapterEntryPda } from "@/lib/registry";
import { dispatcherStatePda, dispatcherUserPositionPda } from "@/lib/dispatcher";
import { Program } from "@anchor-lang/core";
import { makeProvider, makeProgram } from "@/lib/anchor";
import dispatcherIdl from "@/lib/idl/yield_dispatcher.json";
import type { LogEntry } from "./TxLog";
import VaultMetrics from "./VaultMetrics";
import type { VaultMetricsData } from "./VaultMetrics";

interface Props {
  adapterName: AdapterName;
  user: PublicKey;
  onLog: (entry: Omit<LogEntry, "id">) => void;
}

type VaultStatusT = "Active" | "DepositsPaused" | "Paused" | "Deprecated";

const STATUS_LABELS: Record<VaultStatusT, { label: string; color: string }> = {
  Active: { label: "Active", color: "#2ecc71" },
  DepositsPaused: { label: "Deposits Paused", color: "#e67e22" },
  Paused: { label: "Paused", color: "#e74c3c" },
  Deprecated: { label: "Deprecated", color: "#8b8f97" },
};

const STATUS_FROM_DISCR: Record<number, VaultStatusT> = {
  0: "Active", 1: "Paused", 2: "Deprecated", 3: "DepositsPaused",
};

const vaultMint = (name: AdapterName) => (name === "maple" ? SYRUP_USDC_MINT : USDC_MINT);

const OFF = {
  AUTHORITY: 8,
  TOTAL_UNDERLYING: 8 + 32 + 32,
  TOTAL_SHARES: 8 + 32 + 32 + 8,
  POSITION_SHARES: 8 + 32 + 32 + 8 + 8,
};

const STATUS_OFFSETS: Record<string, number> = {
  kamino: 136, marginfi: 136, jupiter: 136,
  maple: 168, drift: 144, template: 136,
};

function readVaultStatus(bytes: Uint8Array, name: AdapterName): VaultStatusT {
  const offset = STATUS_OFFSETS[name] ?? 136;
  return STATUS_FROM_DISCR[bytes[offset] ?? 0] ?? "Active";
}

function vaultAccounts(name: AdapterName) {
  const cfg = getAdapter(name);
  const mint = vaultMint(name);
  const authority = getVaultAuthorityPda(cfg.id, cfg.vaultAuthoritySeed);
  const state = getVaultStatePda(cfg.id, cfg.vaultStateSeed);
  const ata = getAssociatedTokenAddressSync(mint, authority, true);
  return { vaultAuthority: authority, vaultState: state, vaultTokenAccount: ata };
}

function readBigU64(data: Uint8Array, offset: number): bigint {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset, true);
}

export default function PlaygroundPanel({ adapterName, user, onLog }: Props) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [amount, setAmount] = useState("1");
  const [txStatus, setTxStatus] = useState<"idle" | "depositing" | "valuing" | "withdrawing" | "initializing" | "toggling">("idle");
  const [currentValue, setCurrentValue] = useState<string | null>(null);
  const [userAta, setUserAta] = useState<PublicKey | null>(null);
  const [vaultState, setVaultState] = useState<VaultStateRaw>({ exists: false, status: null });
  const [position, setPosition] = useState<PositionRaw>({ exists: false });
  const [checkingVault, setCheckingVault] = useState(true);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [useDispatcher, setUseDispatcher] = useState(false);
  const adapterRef = useRef<Program | null>(null);
  const dispatcherRef = useRef<Program | null>(null);
  const cancelledRef = useRef(false);
  const cfg = getAdapter(adapterName);

  function currentValtAccts() {
    return vaultAccounts(adapterName);
  }

  const buildDispatcherDepositAccts = useCallback((ata: PublicKey, userPosition: PublicKey) => {
    const { vaultState: vs, vaultAuthority, vaultTokenAccount } = currentValtAccts();
    return {
      user: wallet.publicKey!,
      dispatcherState: dispatcherStatePda(PROGRAM_IDS.dispatcher),
      userPosition: dispatcherUserPositionPda(PROGRAM_IDS.dispatcher, wallet.publicKey!, cfg.id),
      registryProgram: PROGRAM_IDS.registry,
      adapterEntry: adapterEntryPda(PROGRAM_IDS.registry, cfg.id),
      adapterProgram: cfg.id,
      userTokenAccount: ata,
      adapterVaultState: vs,
      adapterVault: vaultTokenAccount,
      adapterVaultAuthority: vaultAuthority,
      adapterUserPosition: userPosition,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };
  }, [adapterName, cfg.id, wallet]);

  const buildDispatcherCurrentValueAccts = useCallback(() => {
    const { vaultState: vs } = currentValtAccts();
    const [up] = adapterUserPositionPda(cfg.id, wallet.publicKey!);
    return {
      user: wallet.publicKey!,
      dispatcherState: dispatcherStatePda(PROGRAM_IDS.dispatcher),
      userPosition: dispatcherUserPositionPda(PROGRAM_IDS.dispatcher, wallet.publicKey!, cfg.id),
      registryProgram: PROGRAM_IDS.registry,
      adapterEntry: adapterEntryPda(PROGRAM_IDS.registry, cfg.id),
      adapterProgram: cfg.id,
      adapterVaultState: vs,
      adapterUserPosition: up,
    };
  }, [adapterName, cfg.id, wallet]);

  const buildDispatcherWithdrawAccts = useCallback((ata: PublicKey) => {
    const { vaultState: vs, vaultAuthority, vaultTokenAccount } = currentValtAccts();
    const [up] = adapterUserPositionPda(cfg.id, wallet.publicKey!);
    return {
      user: wallet.publicKey!,
      dispatcherState: dispatcherStatePda(PROGRAM_IDS.dispatcher),
      userPosition: dispatcherUserPositionPda(PROGRAM_IDS.dispatcher, wallet.publicKey!, cfg.id),
      registryProgram: PROGRAM_IDS.registry,
      adapterEntry: adapterEntryPda(PROGRAM_IDS.registry, cfg.id),
      adapterProgram: cfg.id,
      userTokenAccount: ata,
      adapterVaultState: vs,
      adapterVault: vaultTokenAccount,
      adapterVaultAuthority: vaultAuthority,
      adapterUserPosition: up,
      tokenProgram: TOKEN_PROGRAM_ID,
    };
  }, [adapterName, cfg.id, wallet]);

  const fetchChainData = useCallback(async () => {
    if (!adapterRef.current) return;
    setMetricsLoading(true);

    const va = currentValtAccts();
    const [positionAddr] = adapterUserPositionPda(cfg.id, user);

    const [vaultInfo, posInfo] = await Promise.all([
      connection.getAccountInfo(va.vaultState),
      connection.getAccountInfo(positionAddr),
    ]);

    if (cancelledRef.current) { setMetricsLoading(false); return; }

    if (vaultInfo) {
      const status = readVaultStatus(vaultInfo.data, adapterName);
      const authBytes = vaultInfo.data.slice(OFF.AUTHORITY, OFF.AUTHORITY + 32);
      setVaultState({
        exists: true, status,
        authorityKey: new PublicKey(authBytes),
        totalUnderlying: readBigU64(vaultInfo.data, OFF.TOTAL_UNDERLYING),
        totalShares: readBigU64(vaultInfo.data, OFF.TOTAL_SHARES),
      });
    } else {
      setVaultState({ exists: false, status: null });
    }

    if (posInfo) {
      setPosition({ exists: true, shares: readBigU64(posInfo.data, OFF.POSITION_SHARES) });
    } else {
      setPosition({ exists: false });
    }

    setMetricsLoading(false);
  }, [adapterName, connection, user, cfg.id]);

  useEffect(() => {
    if (!wallet.publicKey) return;
    cancelledRef.current = false;
    setCurrentValue(null);
    setUserAta(null);
    setVaultState({ exists: false, status: null });
    setPosition({ exists: false });
    setCheckingVault(true);
    setUseDispatcher(false);

    const provider = makeProvider(connection, wallet);
    adapterRef.current = makeProgram(cfg.idl, cfg.id, provider);
    dispatcherRef.current = makeProgram(dispatcherIdl, PROGRAM_IDS.dispatcher, provider);

    const va = currentValtAccts();
    connection.getAccountInfo(va.vaultState).then((info) => {
      if (cancelledRef.current) return;
      if (!info) { setVaultState({ exists: false, status: null }); setCheckingVault(false); return; }
      setVaultState({ exists: true, status: readVaultStatus(info.data, adapterName) });
      setCheckingVault(false);
    }).catch(() => { if (!cancelledRef.current) setCheckingVault(false); });

    const ata = getAssociatedTokenAddressSync(vaultMint(adapterName), user);
    connection.getAccountInfo(ata).then((info) => {
      if (!cancelledRef.current && info) setUserAta(ata);
    });

    return () => { cancelledRef.current = true; };
  }, [adapterName, connection, wallet, cfg, user]);

  useEffect(() => {
    if (vaultState.exists && checkingVault === false) fetchChainData();
  }, [vaultState.exists, checkingVault, fetchChainData]);

  const ensureUserAta = useCallback(async (): Promise<PublicKey> => {
    const mint = vaultMint(adapterName);
    const ata = getAssociatedTokenAddressSync(mint, user);
    if (userAta?.equals(ata)) return ata;
    const info = await connection.getAccountInfo(ata);
    if (info) { setUserAta(ata); return ata; }
    const ix = createAssociatedTokenAccountInstruction(user, ata, user, mint);
    const tx = new Transaction().add(ix);
    tx.feePayer = user;
    const bh = await connection.getLatestBlockhash();
    tx.recentBlockhash = bh.blockhash;
    const sig = await wallet.sendTransaction!(tx, connection);
    await connection.confirmTransaction(sig, "confirmed");
    setUserAta(ata);
    onLog({ type: "info", message: `Created ${adapterName === "maple" ? "SYRUP-USDC" : "USDC"} token account`, txSig: sig });
    return ata;
  }, [connection, user, userAta, wallet, onLog, adapterName]);

  const sendTx = useCallback(async (ix: any, label: string) => {
    const tx = new Transaction().add(ix);
    tx.feePayer = wallet.publicKey!;
    const bh = await connection.getLatestBlockhash();
    tx.recentBlockhash = bh.blockhash;
    const sig = await wallet.sendTransaction!(tx, connection);
    await connection.confirmTransaction(sig, "confirmed");
    onLog({ type: "success", message: label, txSig: sig });
    return sig;
  }, [connection, wallet, onLog]);

  const handleInitialize = useCallback(async () => {
    if (!adapterRef.current || !wallet.signTransaction || !wallet.publicKey) return;
    setTxStatus("initializing");
    try {
      const va = currentValtAccts();
      const initAccounts: Record<string, PublicKey> = {
        authority: wallet.publicKey,
        vault_state: va.vaultState,
        system_program: SystemProgram.programId,
      };
      if (adapterName === "maple") {
        initAccounts.vault_authority = va.vaultAuthority;
        initAccounts.underlying_mint = USDC_MINT;
        initAccounts.syrup_mint = SYRUP_USDC_MINT;
        initAccounts.vault_syrup = getVaultSyrupPda(cfg.id);
        initAccounts.token_program = TOKEN_PROGRAM_ID;
      }
      const ix = await adapterRef.current.methods.initialize(USDC_MINT).accounts(initAccounts).instruction();
      await sendTx(ix, `Initialized ${cfg.label} vault`);
      setVaultState({ exists: true, status: "Active" });
    } catch (err: unknown) {
      onLog({ type: "error", message: `Initialize failed: ${parseAnchorError(err).message}` });
    } finally { setTxStatus("idle"); }
  }, [cfg, connection, wallet, onLog, adapterName, sendTx]);

  const handleToggleStatus = useCallback(async () => {
    if (!adapterRef.current || !wallet.signTransaction || !wallet.publicKey) return;
    setTxStatus("toggling");
    try {
      const ix = await adapterRef.current.methods
        .toggleStatus()
        .accounts({ authority: wallet.publicKey, vaultState: currentValtAccts().vaultState })
        .instruction();
      await sendTx(ix, `Toggled status for ${cfg.label}`);
      await fetchChainData();
    } catch (err: unknown) {
      onLog({ type: "error", message: `Toggle status failed: ${parseAnchorError(err).message}` });
    } finally { setTxStatus("idle"); }
  }, [cfg, connection, wallet, onLog, adapterName, sendTx, fetchChainData]);

  const getDepositAccts = useCallback((ata: PublicKey, userPosition: PublicKey): Record<string, PublicKey> => {
    if (useDispatcher) return buildDispatcherDepositAccts(ata, userPosition);
    const va = currentValtAccts();
    return { user: wallet.publicKey!, vaultState: va.vaultState, userPosition, userTokenAccount: ata, vaultAuthority: va.vaultAuthority, vaultTokenAccount: va.vaultTokenAccount, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId };
  }, [adapterName, useDispatcher, buildDispatcherDepositAccts, wallet]);

  const handleDeposit = useCallback(async () => {
    if (!adapterRef.current || !dispatcherRef.current || !wallet.signTransaction || !wallet.publicKey) return;
    setTxStatus("depositing");
    try {
      const ata = await ensureUserAta();
      const amountRaw = Math.round(parseFloat(amount) * 1_000_000);
      if (!(amountRaw > 0)) throw new Error("Amount must be greater than 0");
      const [userPosition] = adapterUserPositionPda(cfg.id, wallet.publicKey);
      const prog = useDispatcher ? dispatcherRef.current! : adapterRef.current!;
      const ix = await prog.methods.deposit(new BN(amountRaw), new BN(0)).accounts(getDepositAccts(ata, userPosition)).instruction();
      await sendTx(ix, `Deposited ${amount} → ${cfg.label}${useDispatcher ? " (via dispatcher)" : ""}`);
      await fetchChainData();
    } catch (err: unknown) {
      onLog({ type: "error", message: `Deposit failed: ${parseAnchorError(err).message}` });
    } finally { setTxStatus("idle"); }
  }, [amount, cfg, connection, ensureUserAta, wallet, adapterName, useDispatcher, getDepositAccts, sendTx, fetchChainData]);

  const handleCurrentValue = useCallback(async () => {
    if (!adapterRef.current || !dispatcherRef.current || !wallet.signTransaction || !wallet.publicKey) return;
    setTxStatus("valuing");
    try {
      const prog = useDispatcher ? dispatcherRef.current! : adapterRef.current!;
      const accts = useDispatcher ? buildDispatcherCurrentValueAccts() : { user: wallet.publicKey, vaultState: currentValtAccts().vaultState, userPosition: adapterUserPositionPda(cfg.id, wallet.publicKey)[0] };
      const ix = await prog.methods.currentValue().accounts(accts).instruction();
      const sig = await sendTx(ix, `Queried current_value for ${cfg.label}${useDispatcher ? " (via dispatcher)" : ""}`);

      const txInfo = await connection.getTransaction(sig, { commitment: "confirmed" });
      const logs = txInfo?.meta?.logMessages?.join("\n") ?? "";
      const match = logs.match(/(\d+)\s*shares?/i);
      setCurrentValue(match ? match[1] : "ok");
    } catch (err: unknown) {
      onLog({ type: "error", message: `currentValue failed: ${parseAnchorError(err).message}` });
    } finally { setTxStatus("idle"); }
  }, [cfg, connection, wallet, adapterName, useDispatcher, buildDispatcherCurrentValueAccts, sendTx]);

  const getWithdrawAccts = useCallback((ata: PublicKey): Record<string, PublicKey> => {
    if (useDispatcher) return buildDispatcherWithdrawAccts(ata);
    const va = currentValtAccts();
    return { user: wallet.publicKey!, vaultState: va.vaultState, userPosition: adapterUserPositionPda(cfg.id, wallet.publicKey!)[0], userTokenAccount: ata, vaultAuthority: va.vaultAuthority, vaultTokenAccount: va.vaultTokenAccount, tokenProgram: TOKEN_PROGRAM_ID };
  }, [adapterName, useDispatcher, buildDispatcherWithdrawAccts, wallet, cfg.id]);

  const handleWithdraw = useCallback(async () => {
    if (!adapterRef.current || !dispatcherRef.current || !wallet.signTransaction || !wallet.publicKey) return;
    setTxStatus("withdrawing");
    try {
      const ata = await ensureUserAta();
      const sharesRaw = Math.round(parseFloat(amount) * 1_000_000);
      if (!(sharesRaw > 0)) throw new Error("Amount must be greater than 0");
      const prog = useDispatcher ? dispatcherRef.current! : adapterRef.current!;
      const ix = await prog.methods.withdraw(new BN(sharesRaw), new BN(0)).accounts(getWithdrawAccts(ata)).instruction();
      const sig = await sendTx(ix, `Withdrew ${amount} shares from ${cfg.label}${useDispatcher ? " (via dispatcher)" : ""}`);
      setCurrentValue(null);
      await fetchChainData();
    } catch (err: unknown) {
      onLog({ type: "error", message: `Withdraw failed: ${parseAnchorError(err).message}` });
    } finally { setTxStatus("idle"); }
  }, [amount, cfg, connection, ensureUserAta, wallet, adapterName, useDispatcher, getWithdrawAccts, sendTx, fetchChainData]);

  const isBusy = txStatus !== "idle";

  const metrics: VaultMetricsData | null = vaultState.totalUnderlying !== undefined
    ? {
        totalUnderlying: formatU64(vaultState.totalUnderlying),
        totalShares: formatU64(vaultState.totalShares ?? BigInt(0)),
        userShares: formatU64(position.shares ?? BigInt(0)),
        userSharePct: (vaultState.totalShares && vaultState.totalShares > BigInt(0) && position.shares)
          ? `${((Number(position.shares) / Number(vaultState.totalShares)) * 100).toFixed(2)}%`
          : "0.00%",
        userValue: (vaultState.totalUnderlying && vaultState.totalShares && position.shares && vaultState.totalShares > BigInt(0))
          ? formatU64(position.shares * vaultState.totalUnderlying / vaultState.totalShares)
          : formatU64(BigInt(0)),
      }
    : null;

  const isVaultAuthority = !!(vaultState.authorityKey && wallet.publicKey && vaultState.authorityKey.equals(wallet.publicKey));

  if (checkingVault) {
    return (
      <section className="rounded-lg border border-[#2a2d35] bg-[#14161b] p-6">
        <h2 className="mb-4 text-lg font-semibold">{cfg.label}</h2>
        <p className="py-8 text-center text-sm text-muted">Checking vault state...</p>
      </section>
    );
  }

  const statusDisplay = vaultState.status ? STATUS_LABELS[vaultState.status] : null;
  const mintLabel = adapterName === "maple" ? "SYRUP" : "USDC";

  return (
    <section className="rounded-lg border border-[#2a2d35] bg-[#14161b] p-6">
      <div className="mb-4 flex items-baseline gap-3">
        <h2 className="text-lg font-semibold">{cfg.label}</h2>
        {cfg.url && (
          <a href={cfg.url} target="_blank" rel="noreferrer" className="text-xs text-muted hover:text-accent">
            {cfg.url.replace("https://", "")}
          </a>
        )}
        {vaultState.exists && statusDisplay && (
          <span className="ml-auto text-[11px] font-semibold uppercase tracking-wider" style={{ color: statusDisplay.color }}>
            {statusDisplay.label}
          </span>
        )}
        {!vaultState.exists && (
          <span className="ml-auto text-[11px] font-semibold uppercase tracking-wider text-[#e67e22]">Not initialized</span>
        )}
      </div>

      {!vaultState.exists && (
        <div className="mb-4 rounded-lg border border-[#e67e22]/30 bg-[#e67e22]/10 px-4 py-3">
          <p className="text-xs text-muted">Vault needs to be initialized on devnet before first use.</p>
          <button className="btn btn-initialize mt-2" onClick={handleInitialize} disabled={isBusy}>
            {txStatus === "initializing" ? "Initializing..." : "initialize()"}
          </button>
        </div>
      )}

      {vaultState.exists && (
        <>
          <VaultMetrics metrics={metrics} loading={metricsLoading} mintLabel={mintLabel} />

          <div className="mb-4">
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted">Amount ({mintLabel})</label>
            <input
              type="number" min={0.001} step={0.1} value={amount}
              onChange={(e) => setAmount(e.target.value)} disabled={isBusy}
              className="w-full rounded-lg border border-[#2a2d35] bg-[#1c1f26] px-3 py-2 font-mono text-base text-white outline-none transition-colors focus:border-accent"
            />
          </div>

          <div className="mb-2 flex gap-2">
            <button className="btn btn-deposit flex-1" onClick={handleDeposit} disabled={isBusy}>
              {txStatus === "depositing" ? "Depositing..." : "deposit(amount)"}
            </button>
            <button className="btn btn-value flex-1" onClick={handleCurrentValue} disabled={isBusy}>
              {txStatus === "valuing" ? "Querying..." : "currentValue()"}
            </button>
            <button className="btn btn-withdraw flex-1" onClick={handleWithdraw} disabled={isBusy}>
              {txStatus === "withdrawing" ? "Withdrawing..." : "withdraw(shares)"}
            </button>
          </div>

          <div className="mb-4 flex items-center justify-between">
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={useDispatcher} onChange={(e) => setUseDispatcher(e.target.checked)} className="h-3.5 w-3.5 accent-[#6c5ce7]" />
              <span className="text-[11px] text-muted">Route through Dispatcher</span>
            </label>
            {isVaultAuthority && (
              <button className="btn btn-initialize text-[11px]" onClick={handleToggleStatus} disabled={isBusy}>
                {txStatus === "toggling" ? "Toggling..." : "toggleStatus()"}
              </button>
            )}
          </div>

          <div className="mb-3 flex items-center gap-1.5 text-[11px] font-mono">
            <span className="text-white/80">User</span>
            <span className="text-muted">→</span>
            {useDispatcher ? (
              <>
                <span className="text-[#6c5ce7]">Dispatcher</span>
                <span className="text-muted">→</span>
                <span className="text-white/80">Registry</span>
                <span className="text-muted">→</span>
              </>
            ) : null}
            <span className="text-white/80">{cfg.label}</span>
            <span className="text-muted">→</span>
            <span className="text-white/80">Vault</span>
          </div>

          {currentValue !== null && (
            <div className="mb-4 flex items-center gap-3 rounded-lg border border-[#2a2d35] bg-[#1c1f26] px-4 py-3">
              <span className="text-xs text-muted">Position value:</span>
              <span className="font-mono text-lg text-[#2ecc71]">{currentValue}</span>
            </div>
          )}
        </>
      )}

      <p className="border-t border-[#2a2d35] pt-4 text-center text-[11px] text-muted">
        All adapters implement the same 3-instruction interface
      </p>
    </section>
  );
}

interface VaultStateRaw {
  exists: boolean;
  status: VaultStatusT | null;
  totalUnderlying?: bigint;
  totalShares?: bigint;
  authorityKey?: PublicKey;
}

interface PositionRaw {
  exists: boolean;
  shares?: bigint;
}


