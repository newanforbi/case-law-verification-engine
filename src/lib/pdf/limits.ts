/**
 * PDF size limits.
 *
 * Product ceiling (MAX_PDF_*) is what Citeproof will accept once the file is
 * in hand. DIRECT_BODY_MAX_* is the Vercel Functions request-body wall — above
 * that the PDF must arrive via Blob URL, not multipart.
 */

export const MAX_PDF_BYTES = 40 * 1024 * 1024;
export const MAX_PDF_LABEL = "40 MB";

/** Stay under Vercel's ~4.5 MB body cap (multipart overhead included). */
export const DIRECT_BODY_MAX_BYTES = 4 * 1024 * 1024;
export const DIRECT_BODY_MAX_LABEL = "4 MB";

export function describeBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
