import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep pdf.js out of the serverless bundle; load from node_modules at runtime.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
