import { PublicKey } from "@solana/web3.js";

export const PROGRAM_IDS = {
  registry: new PublicKey("8TAhAne1z4chGzuP9EeXFuYsqyGHzACWuD7sURS3ydAq"),
  dispatcher: new PublicKey("8u4YFQiTCR5n5dijVoinXyZ962ngVmFuWKELDUjVCqAR"),
  kamino: new PublicKey("BQMHrbTGx9ruKQN54XzMajLq769ax3e33YJ5FMkowrg9"),
  marginfi: new PublicKey("LtccLreoDVj2vurvsWpvfC8PvYTnUpTaxz6P9pDg5Y2"),
  jupiter: new PublicKey("8QdkGAkLvpN7JPxf3dgKFUXVGPS2LWW4BumbNkVkXkux"),
  maple: new PublicKey("GRyFctNGZFhHnpHFyyB8xtYdVtC58ZuwyC63PrEy3Vrk"),
  drift: new PublicKey("2zMNZcFzAx9bFNchTWDqiJGt5H3bCDgo8PW1TTskwcLJ"),
  template: new PublicKey("jbLUHXvc9P26MpQdGXht4aKnbn68i2GijxsFX6RXahV"),
} as const;

export const USDC_MINT = new PublicKey("4iaAEQ656fjfLMVCAYQcTquXV12E99zKYKFdJ44S8xuT");
export const SYRUP_USDC_MINT = new PublicKey("4iaAEQ656fjfLMVCAYQcTquXV12E99zKYKFdJ44S8xuT");
export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

export type AdapterName = keyof typeof PROGRAM_IDS;

export const DEPLOYED_ADAPTERS: Set<AdapterName> = new Set(["kamino", "marginfi", "jupiter", "maple", "drift", "template"]);
