"use client";

interface SidebarProps {
  activeView: string;
  onViewChange: (view: string) => void;
}

const NAV_ITEMS = [
  { id: "playground", label: "Playground", icon: "terminal" },
  { id: "registry", label: "Registry", icon: "description" },
  { id: "dispatcher", label: "Dispatcher", icon: "alt_route" },
  { id: "log", label: "Transaction Log", icon: "list_alt" },
];

const BOTTOM_ITEMS = [
  { id: "settings", label: "Settings", icon: "settings" },
  { id: "support", label: "Support", icon: "help_outline" },
];

export default function Sidebar({ activeView, onViewChange }: SidebarProps) {
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
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => onViewChange(item.id)}
            className={`flex items-center gap-3 px-6 py-3 cursor-pointer active:opacity-80 transition-all font-label-md text-label-md ${
              activeView === item.id
                ? "bg-surface-container-highest text-primary border-r-2 border-primary"
                : "text-on-surface-variant hover:bg-surface-container-high hover:text-primary"
            }`}
          >
            <span className="material-symbols-outlined">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>
      <div className="flex flex-col gap-1 border-t border-outline-variant pt-4">
        {BOTTOM_ITEMS.map((item) => (
          <button
            key={item.id}
            className="text-on-surface-variant hover:bg-surface-container-high hover:text-primary transition-all flex items-center gap-3 px-6 py-2 cursor-pointer active:opacity-80 font-label-md text-label-md"
          >
            <span className="material-symbols-outlined">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </div>
    </aside>
  );
}
