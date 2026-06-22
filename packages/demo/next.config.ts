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
