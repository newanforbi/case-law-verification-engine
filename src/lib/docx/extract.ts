/**
 * Extract plain text from a .docx Word filing for citation detection.
 *
 * Word is the primary drafting format for most users — no OCR path needed.
 * Page breaks are uncommon in raw text; we split on form feeds when present
 * and otherwise treat the document as a single page of body text.
 */
import mammoth from "mammoth";
import type { PdfExtraction, PdfPageText } from "@/lib/pdf/extract";
import { MAX_PDF_BYTES, MAX_PDF_LABEL } from "@/lib/pdf/limits";
import { MIN_SUBSTANTIVE_CHARS } from "@/lib/pdf/text-layer";

function pagesFromDocxText(text: string): PdfPageText[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ");
  const chunks = normalized.includes("\f")
    ? normalized.split(/\f+/)
    : [normalized];
  const pages: PdfPageText[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const body = chunks[i]!.trim();
    if (!body && chunks.length > 1) continue;
    pages.push({ page: pages.length + 1, text: body });
  }
  return pages.length ? pages : [{ page: 1, text: "" }];
}

export async function extractDocxText(
  data: Uint8Array,
  fileName: string,
): Promise<PdfExtraction> {
  if (data.byteLength === 0) {
    throw new Error("Word file is empty.");
  }
  if (data.byteLength > MAX_PDF_BYTES) {
    throw new Error(`Word file exceeds the ${MAX_PDF_LABEL} upload limit.`);
  }
  if (!fileName.toLowerCase().endsWith(".docx")) {
    throw new Error("Only .docx Word files are supported (not legacy .doc).");
  }

  let value: string;
  try {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(data) });
    value = result.value || "";
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not read that Word document (${reason}).`);
  }

  const pages = pagesFromDocxText(value);
  const fullText = pages.map((p) => p.text).join("\n\n");
  const charCount = fullText.replace(/\s+/g, "").length;

  return {
    fileName,
    pageCount: pages.length,
    pages,
    fullText,
    hasTextLayer: charCount >= MIN_SUBSTANTIVE_CHARS,
    charCount,
    textSource: "docx",
  };
}
