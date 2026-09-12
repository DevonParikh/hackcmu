import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Loaded with require() at runtime instead of bundled: native bits and dual-package quirks.
  serverExternalPackages: ["mongodb", "@solana/web3.js", "@solana/spl-token", "cheerio"],
};

export default nextConfig;
