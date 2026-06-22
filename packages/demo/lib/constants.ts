import { PublicKey } from "@solana/web3.js";

export const PROGRAM_IDS = {
  registry: new PublicKey("3DQGCPAjHcoT7uf9MJDM5ZTL7GEvTKU3MXFzzrHvqSWt"),
  dispatcher: new PublicKey("HUGWpAwFyeWrnH7f9pfWX93puZdC2ud4MYZQT8FtEBvH"),
  kamino: new PublicKey("AjvTbsYhcEehGTSx7yvF4qSiQLWyfeqe3PRhHVyZB3Xe"),
  marginfi: new PublicKey("5yQiba9TNit1FJx3KqXY5nJM3zuQTreqBFWfeGohBqat"),
  jupiter: new PublicKey("AwpaZYbeNe3vD17JuGMjsv73b3JuqM3eEoqEVnQk9NMo"),
  maple: new PublicKey("GohmCi1aDJAfSg4Sp4rELDwku8ptUs8qafF5aju6p5gz"),
  drift: new PublicKey("4FyuKY2HeXemKoDYoPo1J2xPoeY29YJj7tF7PJLjhS91"),
  template: new PublicKey("jbLUHXvc9P26MpQdGXht4aKnbn68i2GijxsFX6RXahV"),
} as const;

export const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
export const SYRUP_USDC_MINT = new PublicKey("AvZZF1YaZDziPY2RCK4oJrRVrbN3mTD9NL24hPeaZeUj");
export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

export type AdapterName = keyof typeof PROGRAM_IDS;

export const DEPLOYED_ADAPTERS: Set<AdapterName> = new Set(["kamino"]);
