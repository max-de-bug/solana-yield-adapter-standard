import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@solana/wallet-adapter-react",
    "@solana/wallet-adapter-react-ui",
    "@solana/wallet-adapter-base",
    "@solana/wallet-adapter-wallets",
    "@solana/web3.js",
  ],
  serverExternalPackages: ["pino-pretty"],
  // CSP headers required for Phantom/Solflare wallet wasm execution on Vercel
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://api.devnet.solana.com https://*.solana.com wss://*.solana.com; img-src 'self' data:; font-src 'self' data:; worker-src 'self' blob:; frame-src 'self'",
          },
        ],
      },
    ];
  },
  webpack: (config) => {
    config.resolve.fallback = { fs: false, path: false, os: false, crypto: false };
    config.resolve.alias = {
      ...config.resolve.alias,
      "@project-serum/anchor": "@anchor-lang/core",
    };
    config.ignoreWarnings = [
      { module: /ox\/_esm\/tempo/ },
      { module: /pino\/lib\/tools\.js/ },
    ];
    return config;
  },
};

export default nextConfig;
