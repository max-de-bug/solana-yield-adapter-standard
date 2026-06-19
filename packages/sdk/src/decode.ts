import { PublicKey } from "@solana/web3.js";
import { createHash } from "crypto";

/**
 * Low-level Borsh reader for decoding Anchor on-chain accounts.
 *
 * Borsh uses little-endian encoding for all multi-byte integers.
 * Strings are length-prefixed (4 bytes LE length + UTF-8 bytes). */
class BorshReader {
  private offset: number;
  constructor(private buf: Buffer) {
    this.offset = 0;
  }

  private ensure(n: number): void {
    if (this.offset + n > this.buf.length) {
      throw new RangeError(
        `BorshReader: wanted ${n} bytes at offset ${this.offset}, buffer length ${this.buf.length}`
      );
    }
  }

  readU8(): number {
    this.ensure(1);
    const v = this.buf.readUInt8(this.offset);
    this.offset += 1;
    return v;
  }

  readI64(): bigint {
    this.ensure(8);
    const v = this.buf.readBigInt64LE(this.offset);
    this.offset += 8;
    return v;
  }

  readU64(): bigint {
    this.ensure(8);
    const v = this.buf.readBigUInt64LE(this.offset);
    this.offset += 8;
    return v;
  }

  readU128(): bigint {
    this.ensure(16);
    const lo = this.buf.readBigUInt64LE(this.offset);
    const hi = this.buf.readBigUInt64LE(this.offset + 8);
    this.offset += 16;
    return (hi << BigInt(64)) | lo;
  }

  readPubkey(): PublicKey {
    this.ensure(32);
    const pk = new PublicKey(this.buf.subarray(this.offset, this.offset + 32));
    this.offset += 32;
    return pk;
  }

  readString(): string {
    const len = Number(this.readU32());
    this.ensure(len);
    const s = this.buf.toString("utf8", this.offset, this.offset + len);
    this.offset += len;
    return s;
  }

  readU32(): bigint {
    this.ensure(4);
    const v = this.buf.readUInt32LE(this.offset);
    this.offset += 4;
    return BigInt(v);
  }

  skip(n: number): void {
    this.ensure(n);
    this.offset += n;
  }

  remaining(): Buffer {
    return this.buf.subarray(this.offset);
  }
}

/** Computes the Anchor 8-byte discriminator for a given account struct name:
 *  `SHA256("account:<name>")[..8]` */
export function anchorDiscriminator(name: string): Buffer {
  return createHash("sha256")
    .update(`account:${name}`)
    .digest()
    .subarray(0, 8);
}

/** Known 8-byte discriminator for the canonical `AdapterPosition` struct
 *  (shared by all adapters via `define_adapter_position!()`). */
export const ADAPTER_POSITION_DISCRIMINATOR = anchorDiscriminator("AdapterPosition");

/** Decoded representation of the canonical `AdapterPosition` account.
 *
 * Layout (Borsh, 113 bytes total):
 *   [0..8)    discriminator  — SHA256("account:AdapterPosition")[..8]
 *   [8..40)   owner          — Pubkey (32 bytes)
 *   [40..72)  adapter_program_id  — Pubkey (32 bytes)
 *   [72..80)  deposited_amount     — u64 LE (8 bytes)
 *   [80..88)  withdrawn_amount     — u64 LE (8 bytes)
 *   [88..96)  receipt_token_balance — u64 LE (8 bytes)
 *   [96..104) last_updated        — i64 LE (8 bytes)
 *   [104..112) last_withdraw_request — i64 LE (8 bytes)
 *   [112..113) bump               — u8 (1 byte) */
export interface DecodedAdapterPosition {
  owner: PublicKey;
  adapterProgramId: PublicKey;
  depositedAmount: bigint;
  withdrawnAmount: bigint;
  receiptTokenBalance: bigint;
  lastUpdated: bigint;
  lastWithdrawRequest: bigint;
  bump: number;
}

/** Decodes raw on-chain account data into a `DecodedAdapterPosition`.
 *
 * @param data - Raw account bytes (including 8-byte discriminator)
 * @param discriminator - Expected 8-byte discriminator (defaults to `ADAPTER_POSITION_DISCRIMINATOR`)
 * @throws `RangeError` if data is too short or discriminator does not match */
export function decodePosition(
  data: Buffer,
  discriminator: Buffer = ADAPTER_POSITION_DISCRIMINATOR
): DecodedAdapterPosition {
  const reader = new BorshReader(data);

  const actualDiscriminator = data.subarray(0, 8);
  if (!actualDiscriminator.equals(discriminator)) {
    throw new Error(
      `Discriminator mismatch: expected ${discriminator.toString("hex")}, got ${actualDiscriminator.toString("hex")}`
    );
  }

  reader.skip(8);
  return {
    owner: reader.readPubkey(),
    adapterProgramId: reader.readPubkey(),
    depositedAmount: reader.readU64(),
    withdrawnAmount: reader.readU64(),
    receiptTokenBalance: reader.readU64(),
    lastUpdated: reader.readI64(),
    lastWithdrawRequest: reader.readI64(),
    bump: reader.readU8(),
  };
}

/** Known 8-byte discriminator for the `RegistryState` struct. */
export const REGISTRY_STATE_DISCRIMINATOR = anchorDiscriminator("RegistryState");

/** Decoded representation of the registry singleton state account. */
export interface DecodedRegistryState {
  authority: PublicKey;
  guardian: PublicKey;
  pendingAuthority: PublicKey;
  totalProposed: bigint;
  totalApproved: bigint;
}

/** Known 8-byte discriminator for the `AdapterEntry` struct. */
export const ADAPTER_ENTRY_DISCRIMINATOR = anchorDiscriminator("AdapterEntry");

/** Decoded representation of a single adapter entry in the registry. */
export interface DecodedAdapterEntry {
  proposer: PublicKey;
  adapterProgramId: PublicKey;
  underlyingMint: PublicKey;
  name: string;
  status: Record<string, unknown>;
  metadataUri: string;
  vaultStateSeed: string;
  vaultAuthoritySeed: string;
  proposedAt: bigint;
  approvedAt: bigint;
  revokedAt: bigint;
}

/** Decodes raw on-chain account data into a `DecodedAdapterEntry`.
 *
 * @throws `RangeError` if data is too short or discriminator does not match */
export function decodeAdapterEntry(
  data: Buffer,
  discriminator: Buffer = ADAPTER_ENTRY_DISCRIMINATOR
): DecodedAdapterEntry {
  const actualDiscriminator = data.subarray(0, 8);
  if (!actualDiscriminator.equals(discriminator)) {
    throw new Error(
      `Discriminator mismatch for AdapterEntry: expected ${discriminator.toString("hex")}, got ${actualDiscriminator.toString("hex")}`
    );
  }
  const reader = new BorshReader(data);
  reader.skip(8);

  return {
    proposer: reader.readPubkey(),
    adapterProgramId: reader.readPubkey(),
    underlyingMint: reader.readPubkey(),
    name: reader.readString(),
    status: { proposed: {} }, // simplified — Anchor enums use unit variant encoding
    metadataUri: reader.readString(),
    vaultStateSeed: reader.readString(),
    vaultAuthoritySeed: reader.readString(),
    proposedAt: reader.readI64(),
    approvedAt: reader.readI64(),
    revokedAt: reader.readI64(),
  };
}
