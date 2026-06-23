"use client";

export default function Sidebar() {
  return (
    <aside className="fixed left-0 top-16 h-[calc(100vh-64px)] w-64 border-r border-outline-variant flex flex-col py-6 bg-surface-container-low z-40 hidden md:flex">
      <div className="px-6 mb-8 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center border border-outline-variant">
          <span className="material-symbols-outlined text-primary">hub</span>
        </div>
        <div>
          <h2 className="font-label-md text-label-md text-primary font-bold">SOL Yield</h2>
          <p className="font-label-sm text-label-sm text-on-surface-variant">v2.4.0-stable</p>
        </div>
      </div>
      <nav className="flex-1 flex flex-col gap-1">
        <div className="flex items-center gap-3 px-6 py-3 bg-surface-container-highest text-primary border-r-2 border-primary font-label-md text-label-md">
          <span className="material-symbols-outlined">terminal</span>
          Playground
        </div>
      </nav>
      <div className="flex flex-col gap-1 border-t border-outline-variant pt-4">
        <a
          href="https://github.com/max-de-bug/solana-yield-adapter-standard"
          target="_blank"
          rel="noreferrer"
          className="text-on-surface-variant hover:bg-surface-container-high hover:text-primary transition-all flex items-center gap-3 px-6 py-2 cursor-pointer active:opacity-80 font-label-md text-label-md"
        >
          <span className="material-symbols-outlined">code</span>
          GitHub
        </a>
        <a
          href="https://syas.mintlify.app"
          target="_blank"
          rel="noreferrer"
          className="text-on-surface-variant hover:bg-surface-container-high hover:text-primary transition-all flex items-center gap-3 px-6 py-2 cursor-pointer active:opacity-80 font-label-md text-label-md"
        >
          <span className="material-symbols-outlined">description</span>
          Docs
        </a>
      </div>
    </aside>
  );
}
