"use client";

export default function Footer() {
  return (
    <footer className="fixed bottom-0 right-0 left-0 md:left-64 h-10 border-t border-outline-variant flex items-center justify-between px-margin-desktop w-full z-40 bg-surface-container-lowest text-on-surface-variant font-label-sm text-label-sm">
      <div className="font-label-sm text-label-sm uppercase tracking-widest text-on-surface-variant opacity-50 hidden md:block">
        © 2024 Solana-Yield Adapter. System Operational.
      </div>
      <div className="flex gap-6 w-full md:w-auto justify-between md:justify-end">
        <span className="hover:text-primary transition-colors cursor-default">Network: Devnet</span>
        <span className="hover:text-primary transition-colors cursor-default">Total Adapters: 6</span>
        <span className="hover:text-primary transition-colors cursor-default">Interface Coverage: 100%</span>
      </div>
    </footer>
  );
}
