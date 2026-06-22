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
export function parseAnchorError(err: unknown): { message: string; code?: number } {
  if (err instanceof Error) {
    const name = err.constructor?.name ?? "Error";
    const msg = err.message;

    // Log full error details for debugging
    if (msg === "Internal error" || name !== "Error") {
      console.error(`[${name}]`, err);
    }

    // Try to extract program logs from SendTransactionError (has transactionMessage)
    const sendTxErr = err as any;
    if (sendTxErr.transactionMessage) {
      const txMsg = String(sendTxErr.transactionMessage);
      // Check if it's a program error in the transaction message
      const codeMatch = txMsg.match(/custom program error:\s*(0x[0-9a-fA-F]+|\d+)/);
      if (codeMatch) {
        const raw = codeMatch[1];
        const code = raw.startsWith("0x") ? parseInt(raw, 16) : parseInt(raw, 10);
        const known = KNOWN_ERRORS[code];
        return {
          message: known ?? `Program error 0x${code.toString(16).toUpperCase()}`,
          code,
        };
      }
      // Show the raw transaction message
      const cleaned = txMsg.replace(/^error processing instruction \d+:\s*/i, "");
      return { message: cleaned };
    }

    // TransactionExpiredTimeoutError or similar
    if (msg.includes("timed out") || msg.includes("timeout") || msg.includes("cancelled")) {
      return { message: `${msg} — try increasing the amount or checking your wallet` };
    }

    // Try to extract error code from Anchor's log format
    const codeMatch = msg.match(/Error Number:\s*(\d+)/);
    if (codeMatch) {
      const code = parseInt(codeMatch[1], 10);
      const known = KNOWN_ERRORS[code];
      return {
        message: known ?? `Unknown Anchor error (code ${code})`,
        code,
      };
    }

    // Try to extract error code from raw program error
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

    // Last resort: show the constructor name and message
    if (msg === "Internal error" || !msg) {
      return { message: `${name}: ${msg || "no details"}` };
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
