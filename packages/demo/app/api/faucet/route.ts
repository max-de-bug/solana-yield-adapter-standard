import { NextRequest, NextResponse } from "next/server";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";

const CONNECTION = new Connection("https://api.devnet.solana.com");
const TOKEN_MINT = new PublicKey("4iaAEQ656fjfLMVCAYQcTquXV12E99zKYKFdJ44S8xuT");
const AMOUNT = 1_000_000_000_000; // 1,000,000 tokens (6 decimals)

const FAUCET_SECRET = new Uint8Array([
  60, 46, 177, 145, 168, 198, 71, 118, 211, 84, 177, 131, 242, 166, 138, 29,
  28, 2, 114, 67, 234, 108, 41, 136, 124, 211, 229, 46, 35, 205, 0, 173,
  43, 245, 25, 208, 43, 139, 34, 167, 174, 183, 106, 25, 89, 190, 17, 120,
  83, 9, 15, 8, 84, 174, 201, 253, 250, 214, 218, 101, 129, 112, 173, 71,
]);
const FAUCET = Keypair.fromSecretKey(FAUCET_SECRET);

export async function GET(request: NextRequest) {
  const to = request.nextUrl.searchParams.get("to");
  if (!to) {
    return NextResponse.json({ error: 'Missing "to" param' }, { status: 400 });
  }

  try {
    const user = new PublicKey(to);

    const ata = await getOrCreateAssociatedTokenAccount(
      CONNECTION,
      FAUCET,
      TOKEN_MINT,
      user,
    );

    const sig = await mintTo(
      CONNECTION,
      FAUCET,
      TOKEN_MINT,
      ata.address,
      FAUCET,
      AMOUNT,
    );

    return NextResponse.json({ success: true, tx: sig });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
