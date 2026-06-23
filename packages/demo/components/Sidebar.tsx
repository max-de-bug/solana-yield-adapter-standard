"use client";

export default function Sidebar() {
  return (
    <aside className="fixed left-0 top-16 h-[calc(100vh-64px)] w-64 border-r border-outline-variant flex flex-col py-6 bg-surface-container-low z-30 hidden md:flex">
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
