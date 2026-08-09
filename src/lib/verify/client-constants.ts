/** Client-safe constants (no Node fetch / CAP / CourtListener I/O). */

/**
 * Upload ceiling, enforced on both sides.
 *
 * Vercel Functions reject a request body over 4.5 MB before the route ever
 * runs, and what comes back is an HTML error page rather than our JSON. Held
 * a little under that so the refusal is ours, with a message that names the
 * actual size, instead of a parse error against someone else's error page.
 */
export const MAX_PDF_BYTES = 4 * 1024 * 1024;
export const MAX_PDF_LABEL = "4 MB";

export function describeBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export const CONTROLS = {
  positive: "Richardson v. McKnight, 521 U.S. 399 (1997)",
  negative: "In re Leman, 66 Cal.App.5th 200",
} as const;

export const EXAMPLES = [
  CONTROLS.positive,
  CONTROLS.negative,
  "Stump v. Sparkman, 435 U.S. 349 (1978)",
  "In re Hudson, 1 Cal.App.4th 1 (2006)",
  "In re Hudson, 143 Cal.App.4th 1 (2006)",
  "Swift v. California, 384 F.3d 1184",
] as const;
