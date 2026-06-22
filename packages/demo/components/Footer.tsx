export default function Footer() {
  return (
    <footer className="mt-12 border-t border-[#2a2d35] pt-6 pb-4">
      <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:justify-between">
        <div className="flex items-center gap-2 text-xs text-muted">
          <span>Built with</span>
          <a href="https://solana.com" target="_blank" rel="noreferrer" className="text-white underline-offset-2 hover:underline">Solana</a>
          <span>·</span>
          <a href="https://nextjs.org" target="_blank" rel="noreferrer" className="text-white underline-offset-2 hover:underline">Next.js</a>
          <span>·</span>
          <a href="https://vercel.com" target="_blank" rel="noreferrer" className="text-white underline-offset-2 hover:underline">Vercel</a>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted">
          <a href="https://github.com/max-de-bug/solana-yield-adapter-standard" target="_blank" rel="noreferrer" className="underline-offset-2 hover:text-white hover:underline">
            GitHub
          </a>
          <a href="https://syas.mintlify.app" target="_blank" rel="noreferrer" className="underline-offset-2 hover:text-white hover:underline">
            Documentation
          </a>
          <a href="https://solana-yield-adapter.vercel.app" target="_blank" rel="noreferrer" className="underline-offset-2 hover:text-white hover:underline">
            Live Demo
          </a>
        </div>
      </div>
    </footer>
  );
}
