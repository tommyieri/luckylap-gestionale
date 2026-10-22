import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  turbopack: { root: process.cwd() },
  // I cinque lookbook Partner viaggiano con la route che li serve ai membri (00-sequenza §5, 02-2).
  outputFileTracingIncludes: {
    "/partner/lookbook/\\[code\\]": ["./data/partner-lookbooks/*.pdf"],
  },
};

export default config;
