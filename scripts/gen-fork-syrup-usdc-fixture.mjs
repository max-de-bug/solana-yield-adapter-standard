import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PublicKey } from "@solana/web3.js";
import {
  AccountLayout,
  AccountState,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey as PK } from "@solana/web3.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.join(__dirname, "..");
const fixtureDir = path.join(projectDir, "tests", "fixtures");

const walletPubkey = new PublicKey(process.argv[2]);
const syrupUsdcMint = new PublicKey(
  process.argv[3] ?? "AvZZF1YaZDziPY2RCK4oJrRVrbN3mTD9NL24hPeaZeUj"
);
const amount = BigInt(process.argv[4] ?? "10000000000");

const ata = PublicKey.findProgramAddressSync(
  [
    walletPubkey.toBuffer(),
    TOKEN_PROGRAM_ID.toBuffer(),
    syrupUsdcMint.toBuffer(),
  ],
  new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
)[0];

const data = Buffer.alloc(165);
AccountLayout.encode(
  {
    mint: syrupUsdcMint,
    owner: walletPubkey,
    amount,
    delegateOption: 0,
    delegate: PK.default,
    state: AccountState.Initialized,
    isNativeOption: 0,
    isNative: 0n,
    delegatedAmount: 0n,
    closeAuthorityOption: 0,
    closeAuthority: PK.default,
  },
  data
);

const accountEntry = {
  pubkey: ata.toBase58(),
  account: {
    lamports: 2_039_280,
    data: [data.toString("base64"), "base64"],
    owner: TOKEN_PROGRAM_ID.toBase58(),
    executable: false,
    rentEpoch: 1844674407370955167,
    space: data.length,
  },
};

fs.mkdirSync(fixtureDir, { recursive: true });
const outPath = path.join(fixtureDir, "fork-syrup-usdc-ata.json");
fs.writeFileSync(outPath, JSON.stringify(accountEntry, null, 2));
console.log("Wrote", outPath);
console.log("ATA:", ata.toBase58());
