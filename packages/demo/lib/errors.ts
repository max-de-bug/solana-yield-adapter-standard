/**
 * Known error messages mapped from Anchor error codes across all adapter programs.
 *
 * Anchor 1.0 assigns each program a unique code range.  The ranges are:
 *   Adapter programs:   12000–12999
 *   Registry:           11000–11999
 *   Dispatcher:         10000–10999
 *
 * These are populated from the Rust `#[error_code]` attribute macros in each program.
 * Only Drift's IDL exports errors (13000+); the rest are compiled from source.
 */
const KNOWN_ERRORS: Record<number, string> = {
  // ── Dispatcher (12100–12105) ────────────────────────────
  12100: "Dispatcher is paused",
  12101: "Adapter not registered or not approved",
  12102: "Amount must be greater than zero",
  12103: "Unauthorized: not the dispatcher authority",
  12104: "Adapter CPI call failed",
  12105: "Registry program mismatch",

  // ── Registry (12200–12207) ──────────────────────────────
  12200: "Unauthorized: not the governance authority",
  12201: "Adapter name too long",
  12202: "Metadata URI too long",
  12203: "Invalid adapter status for this operation",
  12204: "Adapter already registered",
  12205: "No pending governance transfer",
  12206: "Not the pending governance authority",
  12207: "Invalid vault state seed",

  // ── Adapter common (12000–12199) ────────────────────────
  12000: "Vault state account already exists",
  12001: "Position account already exists",
  12106: "Vault is paused — no operations allowed",
  12107: "Deposits are currently paused for this vault",
  12108: "Slippage exceeded minimum shares out",
  12109: "Slippage exceeded minimum underlying out",
  12110: "Insufficient vault balance for withdrawal",
  12111: "Arithmetic error in vault calculation",
  12112: "Invalid vault authority",
  12113: "Unauthorized: caller is not the vault authority",
  12114: "Governance token mint mismatch",

  // ── Drift-specific (13000–13099) ────────────────────────
  13000: "Unstaking cooldown has not elapsed (13 days required)",
  13001: "A pending withdrawal ticket already exists for this position",
  13002: "No pending withdrawal ticket found for this position",
  13003: "Settlement of withdrawal ticket failed",
};

/**
 * Parse an Anchor error from a transaction response or error object.
 * Returns a human-readable message and the raw error code (if found).
 */
/**
 * Extract a program error code from transaction logs.
 */
function extractProgramErrorFromLogs(logs: string[]): { message: string; code?: number } | null {
  for (const line of logs) {
    const match = line.match(/Program log: (Error Code|AnchorError)\s*[:\s]+(\w+)/);
    if (match) return { message: match[2] };
  }
  for (const line of logs) {
    const match = line.match(/Program log:.*Error Number:\s*(\d+)/);
    if (match) {
      const code = parseInt(match[1], 10);
      const known = KNOWN_ERRORS[code];
      return { message: known ?? `Program error 0x${code.toString(16).toUpperCase()}`, code };
    }
  }
  for (const line of logs) {
    const match = line.match(/Program log:.*custom program error:\s*(0x[0-9a-fA-F]+|\d+)/);
    if (match) {
      const raw = match[1];
      const code = raw.startsWith("0x") ? parseInt(raw, 16) : parseInt(raw, 10);
      const known = KNOWN_ERRORS[code];
      return { message: known ?? `Program error 0x${code.toString(16).toUpperCase()}`, code };
    }
  }
  // Return the last program log line as a fallback
  const programLogs = logs.filter(l => l.startsWith("Program log:"));
  if (programLogs.length > 0) {
    const last = programLogs[programLogs.length - 1].replace(/^Program log:\s*/, "");
    if (last && !last.startsWith("{")) return { message: last };
  }
  return null;
}

/**
 * Extract error info from any error shape by traversing known envelope properties.
 *
 * Known error chains (web3.js 1.x + wallet-adapter):
 *   WalletSendTransactionError (.error) → SendTransactionError (.logs, .transactionMessage)
 *   WalletSendTransactionError (.error) → regular Error (wallet rejected, no logs)
 *   SendTransactionError directly (if caught by user code before wallet wrapping)
 *
 * Also handles minified class names where constructor.name is something like "p" or "te".
 */
/**
 * Find all values in an error tree that look like RPC logs from a transaction
 * simulation/send failure.  Works with minified (Terser) builds where property
 * names are mangled — enumerates own properties dynamically rather than relying
 * on known names like `.logs`, `.transactionMessage`, etc.
 */
function findLogsInErrorTree(err: any, depth: number): string[] | null {
  if (!err || depth > 6) return null;

  // Enumerate all own properties
  const keys = Object.keys(err);
  for (const k of keys) {
    try {
      const v = (err as any)[k];

      // If it's a string and looks like an RPC error message, we found it
      if (typeof v === "string" && v.length > 10 && !v.startsWith("Internal") && !v.startsWith("failed")) {
        // Good candidate — but continue looking for logs first
      }

      // Logs are always string arrays with program log lines
      if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") {
        const s = v[0] as string;
        if (s.includes("Program ") || s.includes("program ") || s.includes("log")) {
          // Found logs
          const logs = v as string[];
          // Check if any look like program logs
          if (logs.some(l => l.startsWith("Program ") || l.includes("Program log") || l.includes("Error"))) {
            return logs;
          }
        }
      }
    } catch {
      // skip
    }
  }

  // Check all own property values recursively
  for (const k of keys) {
    try {
      const v = (err as any)[k];
      if (v && typeof v === "object" && v !== err) {
        const found = findLogsInErrorTree(v, depth + 1);
        if (found) return found;
      }
    } catch {
      // skip
    }
  }

  return null;
}

/**
 * Find a descriptive message string in an error tree, regardless of property name.
 */
function findMessageInErrorTree(err: any, depth: number): string | null {
  if (!err || depth > 6) return null;

  const keys = Object.keys(err);
  for (const k of keys) {
    try {
      const v = (err as any)[k];
      if (typeof v === "string" && v.length > 5 && !v.startsWith("Internal") &&
          !v.startsWith("failed to") && !v.startsWith("error processing") &&
          !v.startsWith("Transaction simulation failed")) {
        // Suspiciously not a generic message — try to recurse deeper first
        // but keep as fallback
      }
      if (typeof v === "string" && (v.includes("custom program error") || v.includes("Error Number") || v.includes("Error Code"))) {
        return v;
      }
    } catch { /* skip */ }
  }

  // Recurse into child objects
  for (const k of keys) {
    try {
      const v = (err as any)[k];
      if (v && typeof v === "object" && v !== err) {
        const found = findMessageInErrorTree(v, depth + 1);
        if (found) return found;
      }
    } catch { /* skip */ }
  }

  return null;
}

/**
 * Extract error info from any error shape by traversing known envelope properties.
 *
 * Known error chains (web3.js 1.x + wallet-adapter):
 *   WalletSendTransactionError (.error) → SendTransactionError (.logs, .transactionMessage)
 *   WalletSendTransactionError (.error) → regular Error (wallet rejected, no logs)
 *   SendTransactionError directly (if caught by user code before wallet wrapping)
 *
 * Also handles minified class names where constructor.name is something like "p" or "te".
 */
function extractNestedError(err: any): { message: string; logs?: string[] } | null {
  // Use dynamic enumeration to handle minified (mangled) property names
  const logs = findLogsInErrorTree(err, 0);
  if (logs) return { message: "", logs };

  const msg = findMessageInErrorTree(err, 0);
  if (msg) return { message: msg };

  return null;
}

export function parseAnchorError(err: unknown): { message: string; code?: number } {
  if (err instanceof Error) {
    const name = err.constructor?.name ?? "Error";
    const msg = err.message;

    // Log full error details for debugging
    if (msg === "Internal error" || name !== "Error") {
      console.error(`[${name}]`, err);
    }

    // Try to extract nested error info (SendTransactionError / WalletSendTransactionError)
    const nested = extractNestedError(err);
    if (nested) {
      // If we have logs, try to parse program error from them
      if (nested.logs && nested.logs.length > 0) {
        const fromLogs = extractProgramErrorFromLogs(nested.logs);
        if (fromLogs) return fromLogs;
      }
      // Check the message itself
      const txMsg = nested.message;
      if (txMsg && txMsg !== "Internal error") {
        const codeMatch = String(txMsg).match(/custom program error:\s*(0x[0-9a-fA-F]+|\d+)/);
        if (codeMatch) {
          const raw = codeMatch[1];
          const code = raw.startsWith("0x") ? parseInt(raw, 16) : parseInt(raw, 10);
          const known = KNOWN_ERRORS[code];
          return {
            message: known ?? `Program error 0x${code.toString(16).toUpperCase()}`,
            code,
          };
        }
        const cleaned = String(txMsg).replace(/^error processing instruction \d+:\s*/i, "");
        return { message: cleaned };
      }
    }

    // Try to extract error code from Anchor's log format in message
    const codeMatch = msg.match(/Error Number:\s*(\d+)/);
    if (codeMatch) {
      const code = parseInt(codeMatch[1], 10);
      const known = KNOWN_ERRORS[code];
      return {
        message: known ?? `Unknown Anchor error (code ${code})`,
        code,
      };
    }

    // Try to extract error code from raw program error in message
    const rawMatch = msg.match(/custom program error:\s*(0x[0-9a-fA-F]+|\d+)/);
    if (rawMatch) {
      const raw = rawMatch[1];
      const code = raw.startsWith("0x") ? parseInt(raw, 16) : parseInt(raw, 10);
      const known = KNOWN_ERRORS[code];
      return {
        message: known ?? `Program error 0x${code.toString(16).toUpperCase()}`,
        code,
      };
    }

    // TransactionExpiredTimeoutError or similar
    if (msg.includes("timed out") || msg.includes("timeout") || msg.includes("cancelled")) {
      return { message: `${msg} — try increasing the amount or checking your wallet` };
    }

    // Try to extract error name from Anchor's log format
    const nameMatch = msg.match(/Error Code:\s*(\w+)/);
    if (nameMatch) {
      return { message: nameMatch[1] };
    }

    // Try to extract program log from simulation error
    const logMatch = msg.match(/Simulation failed:\s*\n([\s\S]+?)(?:\n\n|\n$|$)/);
    if (logMatch) {
      return { message: logMatch[1].trim().split("\n").pop() ?? msg };
    }

    // Last resort: if message is just "Internal error", try err.logs directly
    if (msg === "Internal error" || !msg) {
      // @ts-ignore - some error types expose logs at top level
      const logs = (err as any).logs as string[] | undefined;
      if (logs && logs.length > 0) {
        const fromLogs = extractProgramErrorFromLogs(logs);
        if (fromLogs) return fromLogs;
      }
      // @ts-ignore
      const transactionMessage = (err as any).transactionMessage as string | undefined;
      if (transactionMessage && transactionMessage !== "Internal error") {
        return { message: transactionMessage };
      }
      // Wallet rejected the transaction entirely (no logs, no message)
      // Common causes: wrong network (wallet on mainnet, app on devnet), insufficient funds, user cancelled
      return { message: `Wallet rejected the transaction — ensure your wallet is set to Devnet and has SOL for fees` };
    }

    return { message: msg };
  }

  if (typeof err === "string") return { message: err };
  return { message: JSON.stringify(err) };
}

/**
 * Format a token amount (6 decimal USDC/SYRUP) to a human-readable string.
 */
export function formatTokenAmount(raw: string | number | bigint, decimals = 6): string {
  const n = typeof raw === "string" ? BigInt(raw) : BigInt(raw);
  const divisor = BigInt(10 ** decimals);
  const integer = n / divisor;
  const fraction = n % divisor;
  const padded = fraction.toString().padStart(decimals, "0").slice(0, decimals);
  return `${integer.toLocaleString()}.${padded}`;
}

/**
 * Format raw lamports/u64 to a short human string (e.g. "1,234.56").
 */
export function formatU64(raw: string | number | bigint, decimals = 6): string {
  return formatTokenAmount(raw, decimals);
}
