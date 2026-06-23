import type { Metadata } from "next";
import Providers from "./providers";
import "./globals.css";

const title = "Solana-Yield Adapter — Playground";
const description =
  "Interactive demo for the Solana Yield Adapter Standard. " +
  "Connect a wallet and deposit, query, and withdraw across 6 yield protocols through a unified interface on devnet.";

export const metadata: Metadata = {
  title,
  description,
  icons: [{ rel: "icon", url: "/favicon.svg", type: "image/svg+xml" }],
  openGraph: {
    title,
    description,
    url: "https://solana-yield-adapter-standard.vercel.app",
    siteName: "Solana Yield Adapter Standard",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
