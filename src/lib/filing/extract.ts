/**
 * Format-dispatching filing extract: PDF (text layer / OCR) or Word .docx.
 */
import { extractDocxText } from "@/lib/docx/extract";
import { extractPdfText, type PdfExtraction } from "@/lib/pdf/extract";
import { filingFormatFromName, type FilingFormat } from "./kinds";

export type FilingExtraction = PdfExtraction & {
  format: FilingFormat;
};

export async function extractFilingText(
  data: Uint8Array,
  fileName: string,
): Promise<FilingExtraction> {
  const format = filingFormatFromName(fileName);
  if (!format) {
    throw Object.assign(
      new Error("Only PDF and Word (.docx) uploads are supported."),
      { status: 400 },
    );
  }
  if (format === "docx") {
    const extracted = await extractDocxText(data, fileName);
    return { ...extracted, format };
  }
  const extracted = await extractPdfText(data, fileName);
  return { ...extracted, format };
}
