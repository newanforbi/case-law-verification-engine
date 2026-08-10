export interface PdfPageText {
  page: number;
  text: string;
}

export interface PdfExtraction {
  fileName: string;
  pageCount: number;
  pages: PdfPageText[];
  fullText: string;
  hasTextLayer: boolean;
  charCount: number;
}

// Vercel Functions reject request bodies over 4.5 MB. Stay under that with
// headroom for multipart form overhead.
const MAX_BYTES = 4 * 1024 * 1024;

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
  await import("pdf-parse/worker");
  const mod = await import("pdf-parse");
  return mod;
}

export async function extractPdfText(
  data: Uint8Array,
  fileName: string,
): Promise<PdfExtraction> {
  if (data.byteLength === 0) {
    throw new Error("PDF file is empty.");
  }
  if (data.byteLength > MAX_BYTES) {
    throw new Error(
      "PDF exceeds the 4 MB upload limit (Vercel request body cap is 4.5 MB).",
    );
  }

  let PDFParse: typeof import("pdf-parse").PDFParse;
  try {
    ({ PDFParse } = await loadPdfParse());
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `PDF engine failed to start on this server (${reason}). Try again, or paste the citations instead.`,
    );
  }

  // Copy — pdf.js may transfer the underlying ArrayBuffer to a worker.
  const copy = Uint8Array.from(data);
  const parser = new PDFParse({ data: copy });
  try {
    const result = await parser.getText();
    const pages: PdfPageText[] = (result.pages || []).map((p) => ({
      page: p.num,
      text: (p.text || "").replace(/\u00a0/g, " "),
    }));
    const fullText = pages.map((p) => p.text).join("\n\n");
    const charCount = fullText.replace(/\s+/g, "").length;
    return {
      fileName,
      pageCount: result.total || pages.length,
      pages,
      fullText,
      hasTextLayer: charCount >= 40,
      charCount,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not read that PDF (${reason}).`);
  } finally {
    // PDFParse may hold worker resources; destroy if available.
    const maybe = parser as unknown as { destroy?: () => Promise<void> };
    if (typeof maybe.destroy === "function") {
      await maybe.destroy().catch(() => undefined);
    }
  }
}
