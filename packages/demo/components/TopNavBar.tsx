"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export default function TopNavBar() {
  return (
    <nav className="fixed top-0 w-full h-16 border-b border-outline-variant flex justify-between items-center px-margin-mobile md:px-margin-desktop z-50 bg-surface">
      <div className="flex items-center gap-8">
        <a className="font-headline-md text-headline-md font-bold text-primary flex items-center gap-2" href="#">
          <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>account_balance</span>
          Solana-Yield Adapter
        </a>
        <div className="hidden md:flex gap-6 h-full items-center">
          <a className="text-on-surface-variant font-medium hover:text-primary transition-colors duration-200" href="https://solana-yield-adapter-standard.vercel.app">Explorer</a>
          <a className="text-on-surface-variant font-medium hover:text-primary transition-colors duration-200" href="https://github.com/anomalyco/solana-yield-adapter-standard">GitHub</a>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <WalletMultiButton />
      </div>
    </nav>
  );
}
