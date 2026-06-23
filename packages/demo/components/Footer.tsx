"use client";

export default function Footer() {
  return (
    <footer className="fixed bottom-0 left-0 md:left-64 right-0 h-10 border-t border-outline-variant flex items-center justify-start px-margin-desktop z-40 bg-surface-container-lowest text-on-surface-variant font-label-sm text-label-sm">
      <div className="font-label-sm text-label-sm uppercase tracking-widest text-on-surface-variant whitespace-nowrap overflow-hidden text-ellipsis">
        © 2026 Solana-Yield Adapter
      </div>
      <div className="flex gap-4 md:gap-6 w-full md:w-auto justify-start md:justify-start ml-4">
        <span className="hover:text-primary transition-colors cursor-default">Network: Devnet</span>
        <span className="hover:text-primary transition-colors cursor-default">Total Adapters: 6</span>
        <span className="hover:text-primary transition-colors cursor-default">Interface Coverage: 100%</span>
      </div>
    </footer>
  );
}
