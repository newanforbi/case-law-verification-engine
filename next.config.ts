import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep pdf.js + native canvas out of the serverless bundle; load at runtime.
  // @napi-rs/canvas must be listed or Vercel omits the platform binary and
  // /api/verify-pdf crashes during module init with an HTML 500.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "@napi-rs/canvas"],
  // Ensure the linux canvas binaries are traced into the verify-pdf lambda.
  outputFileTracingIncludes: {
    "/api/verify-pdf": [
      "./node_modules/@napi-rs/canvas-linux-x64-gnu/**/*",
      "./node_modules/@napi-rs/canvas-linux-x64-musl/**/*",
      "./node_modules/pdf-parse/dist/**/*",
    ],
  },
};

export default nextConfig;
