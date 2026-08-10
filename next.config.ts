import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep pdf.js + native canvas + tesseract out of the serverless bundle; load
  // at runtime. @napi-rs/canvas must be listed or Vercel omits the platform
  // binary and /api/verify-pdf crashes during module init with an HTML 500.
  serverExternalPackages: [
    "pdf-parse",
    "pdfjs-dist",
    "@napi-rs/canvas",
    "tesseract.js",
    "tesseract.js-core",
  ],
  // Ensure canvas binaries, pdf-parse workers, and tesseract WASM land in the
  // verify-pdf lambda so OCR works on scanned filings.
  outputFileTracingIncludes: {
    "/api/verify-pdf": [
      "./node_modules/@napi-rs/canvas-linux-x64-gnu/**/*",
      "./node_modules/@napi-rs/canvas-linux-x64-musl/**/*",
      "./node_modules/pdf-parse/dist/**/*",
      "./node_modules/tesseract.js/**/*",
      "./node_modules/tesseract.js-core/**/*",
    ],
  },
};

export default nextConfig;
