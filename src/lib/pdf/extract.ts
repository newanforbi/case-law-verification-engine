import { MAX_PDF_BYTES, MAX_PDF_LABEL } from "./limits";
import { MAX_OCR_PAGES, ocrPngPages } from "./ocr";
import { MIN_SUBSTANTIVE_CHARS, textLayerIsUsable } from "./text-layer";

export interface PdfPageText {
  page: number;
  text: string;
}

export type PdfTextSource = "text_layer" | "ocr";

export interface PdfExtraction {
  fileName: string;
  pageCount: number;
  pages: PdfPageText[];
  fullText: string;
  /** True when enough characters were recovered to run citation detection. */
  hasTextLayer: boolean;
  charCount: number;
  /** Where the page text came from. */
  textSource: PdfTextSource;
  ocr?: {
    pagesProcessed: number;
    pagesSkipped: number;
    elapsedMs: number;
  };
}

export interface ExtractPdfOptions {
  /** When false, skip OCR and return the empty text-layer result. Default true. */
  allowOcr?: boolean;
  /** Cap OCR pages (scanned filings past this need splitting). */
  maxOcrPages?: number;
}

/**
 * Load pdf-parse the way Vercel needs it.
 *
 * On serverless, importing PDFParse without the worker shim throws during
 * module init (DOMMatrix / canvas / workerSrc). That surfaces as a Next.js
 * HTML 500 before the route's try/catch can answer in JSON — exactly the
 * "server returned a page instead of a result" the UI shows. Importing
 * `pdf-parse/worker` first registers the canvas factory and worker source.
 */
async function loadPdfParse() {
  const worker = await import("pdf-parse/worker");
  const mod = await import("pdf-parse");
  return { ...mod, CanvasFactory: worker.CanvasFactory };
}

function finalize(
  fileName: string,
  pageCount: number,
  pages: PdfPageText[],
  textSource: PdfTextSource,
  ocr?: PdfExtraction["ocr"],
): PdfExtraction {
  const fullText = pages.map((p) => p.text).join("\n\n");
  const charCount = fullText.replace(/\s+/g, "").length;
  // Text layers must clear the stamp/sparse-page gate (see text-layer.ts).
  // OCR output is body text — a simple char floor is enough.
  const usable =
    textSource === "ocr"
      ? charCount >= MIN_SUBSTANTIVE_CHARS
      : textLayerIsUsable(pages);
  return {
    fileName,
    pageCount,
    pages,
    fullText,
    hasTextLayer: usable,
    charCount,
    textSource,
    ocr,
  };
}

async function ocrFromScreenshots(
  PDFParse: typeof import("pdf-parse").PDFParse,
  CanvasFactory: unknown,
  data: Uint8Array,
  pageCount: number,
  maxOcrPages: number,
): Promise<{ pages: PdfPageText[]; meta: NonNullable<PdfExtraction["ocr"]> }> {
  const started = Date.now();
  const limit = Math.min(pageCount, maxOcrPages);
  const pagesSkipped = Math.max(0, pageCount - limit);

  // Fresh parser — screenshot rendering needs CanvasFactory explicitly.
  const parser = new PDFParse({
    data: Uint8Array.from(data),
    CanvasFactory: CanvasFactory as never,
  });
  try {
    let shots: Awaited<ReturnType<InstanceType<typeof PDFParse>["getScreenshot"]>>;
    try {
      shots = await parser.getScreenshot({
        first: limit,
        scale: 2,
        imageBuffer: true,
        imageDataUrl: false,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`Could not render PDF pages for OCR (${reason}).`);
    }

    const pngPages = (shots.pages || []).map((p) => {
      const png = p.data;
      if (!png || typeof (png as Uint8Array).byteLength !== "number") {
        throw new Error(
          `Screenshot for page ${p.pageNumber} did not include image bytes.`,
        );
      }
      // Copy now — pdf.js may recycle the underlying buffer.
      const copy = Buffer.from(png);
      if (copy.byteLength < 32) {
        throw new Error(
          `Screenshot for page ${p.pageNumber} was empty (${copy.byteLength} bytes).`,
        );
      }
      return { page: p.pageNumber, png: copy };
    });
    if (!pngPages.length) {
      throw new Error("PDF screenshot produced no pages to OCR.");
    }
    const ocrPages = await ocrPngPages(pngPages);
    return {
      pages: ocrPages.map((p) => ({ page: p.page, text: p.text })),
      meta: {
        pagesProcessed: ocrPages.length,
        pagesSkipped,
        elapsedMs: Date.now() - started,
      },
    };
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

export async function extractPdfText(
  data: Uint8Array,
  fileName: string,
  options: ExtractPdfOptions = {},
): Promise<PdfExtraction> {
  if (data.byteLength === 0) {
    throw new Error("PDF file is empty.");
  }
  if (data.byteLength > MAX_PDF_BYTES) {
    throw new Error(`PDF exceeds the ${MAX_PDF_LABEL} upload limit.`);
  }

  const allowOcr = options.allowOcr !== false;
  const maxOcrPages = Math.max(1, options.maxOcrPages ?? MAX_OCR_PAGES);

  let PDFParse: typeof import("pdf-parse").PDFParse;
  let CanvasFactory: unknown;
  try {
    ({ PDFParse, CanvasFactory } = await loadPdfParse());
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `PDF engine failed to start on this server (${reason}). Try again, or paste the citations instead.`,
    );
  }

  // Copy — pdf.js may transfer the underlying ArrayBuffer to a worker.
  const copy = Uint8Array.from(data);
  const parser = new PDFParse({ data: copy, CanvasFactory: CanvasFactory as never });
  let pageCount = 0;
  let textPages: PdfPageText[] = [];
  try {
    const result = await parser.getText();
    pageCount = result.total || (result.pages || []).length;
    textPages = (result.pages || []).map((p) => ({
      page: p.num,
      text: (p.text || "").replace(/\u00a0/g, " "),
    }));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not read that PDF (${reason}).`);
  } finally {
    await parser.destroy().catch(() => undefined);
  }

  const textLayer = finalize(fileName, pageCount, textPages, "text_layer");
  // Stamp-only PACER/ECF layers (headers, no body) look non-empty by raw
  // character count — still fall through to OCR when the layer is unusable.
  if (textLayer.hasTextLayer || !allowOcr) {
    return textLayer;
  }

  // Image-only / scanned / stamp-only filing: render pages and OCR them.
  try {
    const { pages, meta } = await ocrFromScreenshots(
      PDFParse,
      CanvasFactory,
      data,
      pageCount || 1,
      maxOcrPages,
    );
    return finalize(fileName, pageCount || pages.length, pages, "ocr", meta);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    // Avoid "OCR failed (OCR failed on page…)" doubling from inner throws.
    const detail = /OCR failed/i.test(reason) ? reason : `OCR failed (${reason})`;
    throw new Error(
      `This PDF has little or no extractable text, and ${detail}. Try a text-based export, or paste the citations.`,
    );
  }
}
