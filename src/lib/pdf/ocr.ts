/**
 * OCR for scanned / image-only PDFs.
 *
 * pdf-parse gives us page screenshots; tesseract.js reads the words. Kept in
 * its own module so the text-layer path never pays for worker startup.
 *
 * Vercel note: do not path.join() from a package root resolve — on serverless
 * that has produced `path` TypeErrors when the resolved root was wrong. Resolve
 * the worker/core files directly, and feed recognize() a real filesystem path
 * (temp PNG) rather than a bare Uint8Array, which loadImage() only treats as
 * bytes when it is a Node Buffer.
 */
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWorker, type Worker } from "tesseract.js";

const require = createRequire(import.meta.url);

/** Soft ceiling: OCR is slow and memory-heavy on serverless. */
export const MAX_OCR_PAGES = 12;

function tesseractPaths() {
  return {
    // Resolve the files themselves — more reliable than join(packageRoot, …)
    // inside the Vercel function filesystem layout.
    workerPath: require.resolve("tesseract.js/src/worker-script/node/index.js"),
    corePath: require.resolve("tesseract.js-core/tesseract-core-simd-lstm.wasm.js"),
    cachePath: path.join(tmpdir(), "tesseract-cache"),
    // Explicit CDN so lang data does not depend on a local traineddata file.
    langPath: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int",
  };
}

let sharedWorker: Promise<Worker> | null = null;

async function getWorker(): Promise<Worker> {
  sharedWorker ??= (async () => {
    const paths = tesseractPaths();
    await mkdir(paths.cachePath, { recursive: true });
    return createWorker("eng", 1, {
      workerPath: paths.workerPath,
      corePath: paths.corePath,
      cachePath: paths.cachePath,
      langPath: paths.langPath,
      gzip: true,
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

function asPngBuffer(png: Uint8Array | Buffer): Buffer {
  if (Buffer.isBuffer(png)) {
    if (!png.byteLength) throw new Error("OCR received an empty page image.");
    return png;
  }
  if (png instanceof Uint8Array) {
    if (!png.byteLength) throw new Error("OCR received an empty page image.");
    // Copy into a standalone Buffer — transferable/views from pdf.js can be
    // detached by the time tesseract's worker reads them.
    return Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  }
  throw new Error(
    `OCR expected PNG bytes, got ${Object.prototype.toString.call(png)}.`,
  );
}

export async function ocrPngBuffer(png: Uint8Array | Buffer): Promise<string> {
  const buf = asPngBuffer(png);
  const dir = path.join(tmpdir(), "citeproof-ocr");
  await mkdir(dir, { recursive: true });
  const file = path.join(
    dir,
    `${Date.now()}-${randomBytes(4).toString("hex")}.png`,
  );

  try {
    await writeFile(file, buf);
    const worker = await getWorker();
    // Pass a filesystem path (string). tesseract's Node loadImage() only
    // treats Buffers as bytes; other typed arrays can fall through into
    // fs.readFile with a non-string and throw ERR_INVALID_ARG_TYPE.
    const { data } = await worker.recognize(file);
    return (data.text || "").replace(/\u00a0/g, " ").trim();
  } finally {
    await unlink(file).catch(() => undefined);
  }
}

export async function ocrPngPages(
  pages: Array<{ page: number; png: Uint8Array | Buffer }>,
): Promise<Array<{ page: number; text: string }>> {
  const out: Array<{ page: number; text: string }> = [];
  for (const p of pages) {
    try {
      const text = await ocrPngBuffer(p.png);
      out.push({ page: p.page, text });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`OCR failed on page ${p.page}: ${reason}`);
    }
  }
  return out;
}
