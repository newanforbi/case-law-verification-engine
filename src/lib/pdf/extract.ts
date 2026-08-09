import { PDFParse } from "pdf-parse";

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
  } finally {
    // PDFParse may hold worker resources; destroy if available.
    const maybe = parser as unknown as { destroy?: () => Promise<void> };
    if (typeof maybe.destroy === "function") {
      await maybe.destroy().catch(() => undefined);
    }
  }
}
