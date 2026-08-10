/**
 * Filing formats Citeproof accepts for citation extract → verify.
 */

export type FilingFormat = "pdf" | "docx";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function filingFormatFromName(
  fileName: string,
  mimeType?: string,
): FilingFormat | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf") || mimeType === "application/pdf" || mimeType === "application/x-pdf") {
    return "pdf";
  }
  if (lower.endsWith(".docx") || mimeType === DOCX_MIME) {
    return "docx";
  }
  return null;
}

export function isAcceptedFiling(fileName: string, mimeType?: string): boolean {
  return filingFormatFromName(fileName, mimeType) !== null;
}

export function contentTypeForFormat(format: FilingFormat): string {
  return format === "docx" ? DOCX_MIME : "application/pdf";
}

export function allowedUploadContentTypes(): string[] {
  return [
    "application/pdf",
    "application/x-pdf",
    DOCX_MIME,
  ];
}

export function ensureFilingExtension(
  name: string,
  format: FilingFormat,
): string {
  const base = name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
  const trimmed = base.slice(0, 80) || (format === "docx" ? "filing.docx" : "filing.pdf");
  const ext = format === "docx" ? ".docx" : ".pdf";
  return trimmed.toLowerCase().endsWith(ext) ? trimmed : `${trimmed}${ext}`;
}
