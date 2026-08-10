/**
 * OCR for scanned / image-only PDFs.
 *
 * pdf-parse gives us page screenshots; tesseract.js reads the words. Kept in
 * its own module so the text-layer path never pays for worker startup.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { createWorker, type Worker } from "tesseract.js";

const require = createRequire(import.meta.url);

/** Soft ceiling: OCR is slow and memory-heavy on serverless. */
export const MAX_OCR_PAGES = 12;

function tesseractPaths() {
  const tessRoot = path.dirname(require.resolve("tesseract.js/package.json"));
  const coreRoot = path.dirname(require.resolve("tesseract.js-core/package.json"));
  return {
    workerPath: path.join(tessRoot, "src/worker-script/node/index.js"),
    // SIMD + LSTM is the default quality path; falls back inside the package
    // when the host lacks SIMD.
    corePath: path.join(coreRoot, "tesseract-core-simd-lstm.wasm.js"),
    cachePath: "/tmp/tesseract-cache",
  };
}

let sharedWorker: Promise<Worker> | null = null;

async function getWorker(): Promise<Worker> {
  sharedWorker ??= (async () => {
    const paths = tesseractPaths();
    return createWorker("eng", 1, {
      workerPath: paths.workerPath,
      corePath: paths.corePath,
      cachePath: paths.cachePath,
    });
  })();
  return sharedWorker;
}

/** Release the OCR worker (tests / one-shot scripts). Safe to call when idle. */
export async function terminateOcrWorker(): Promise<void> {
  if (!sharedWorker) return;
  try {
    const worker = await sharedWorker;
    await worker.terminate();
  } catch {
    // ignore — worker may already be gone
  } finally {
    sharedWorker = null;
  }
}

export async function ocrPngBuffer(png: Uint8Array | Buffer): Promise<string> {
  const worker = await getWorker();
  const { data } = await worker.recognize(Buffer.from(png));
  return (data.text || "").replace(/\u00a0/g, " ").trim();
}

export async function ocrPngPages(
  pages: Array<{ page: number; png: Uint8Array | Buffer }>,
): Promise<Array<{ page: number; text: string }>> {
  const out: Array<{ page: number; text: string }> = [];
  for (const p of pages) {
    const text = await ocrPngBuffer(p.png);
    out.push({ page: p.page, text });
  }
  return out;
}
