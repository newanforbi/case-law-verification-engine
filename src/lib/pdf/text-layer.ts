/**
 * Decide whether a PDF text layer is worth citation extraction, or whether
 * we should fall through to OCR.
 *
 * Scanned PACER/ECF filings often have a selectable stamp on every page
 * ("Case 2:26-cv-… Document 1 Filed … Page N of M") while the pleading body
 * is image-only. Counting raw characters treats those as "has text" and skips
 * OCR — yielding zero citations. Strip known stamps and reject sparse,
 * near-duplicate page layers before trusting the text layer.
 */

export const MIN_SUBSTANTIVE_CHARS = 40;

/** Below this median (after boilerplate strip), multi-page layers look stamp-only. */
export const MIN_MEDIAN_SUBSTANTIVE_CHARS_PER_PAGE = 120;

/** Raw chars/page at or below this, with near-duplicate pages → OCR. */
const SPARSE_RAW_CHARS_PER_PAGE = 100;

export interface TextLayerPage {
  text: string;
}

/** CM/ECF / pdf-parse chrome that is not pleading body. */
export function stripFilingBoilerplate(text: string): string {
  return text
    .replace(
      /Case\s+\d+:\d+-[a-z]{2,}-\d+[A-Za-z0-9-]*\s+Document\s+\d+\s+Filed\s+\d{1,2}\/\d{1,2}\/\d{2,4}\s+Page\s+\d+\s+of\s+\d+/gi,
      " ",
    )
    .replace(/--\s*\d+\s+of\s+\d+\s*--/g, " ")
    .replace(/\bPage\s+\d+\s+of\s+\d+\b/gi, " ");
}

export function substantiveCharCount(text: string): number {
  return stripFilingBoilerplate(text).replace(/\s+/g, "").length;
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** Normalize stamps so "Page 1 of 50" ≈ "Page 2 of 50" for uniqueness checks. */
function normalizePageFingerprint(text: string): string {
  return stripFilingBoilerplate(text)
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * True when the text layer has enough non-boilerplate content to run
 * citation detection without OCR.
 */
export function textLayerIsUsable(pages: TextLayerPage[]): boolean {
  if (!pages.length) return false;

  const substantivePerPage = pages.map((p) => substantiveCharCount(p.text));
  const substantiveTotal = substantivePerPage.reduce((a, b) => a + b, 0);
  if (substantiveTotal < MIN_SUBSTANTIVE_CHARS) return false;

  if (pages.length >= 2) {
    const med = median(substantivePerPage);
    if (med < MIN_MEDIAN_SUBSTANTIVE_CHARS_PER_PAGE) {
      // Allow sparse later pages when early pages already carry a real body
      // (e.g. short motion + scanned exhibits).
      const richPages = substantivePerPage.filter(
        (n) => n >= MIN_MEDIAN_SUBSTANTIVE_CHARS_PER_PAGE,
      ).length;
      if (richPages === 0 || substantiveTotal < MIN_MEDIAN_SUBSTANTIVE_CHARS_PER_PAGE) {
        return false;
      }
    }
  }

  // Unknown stamp formats: many short, near-identical pages → OCR.
  if (pages.length >= 5) {
    const rawPerPage = pages.map((p) => p.text.replace(/\s+/g, "").length);
    const rawMedian = median(rawPerPage);
    const fingerprints = new Set(pages.map((p) => normalizePageFingerprint(p.text)));
    if (rawMedian <= SPARSE_RAW_CHARS_PER_PAGE && fingerprints.size <= 2) {
      return false;
    }
  }

  return true;
}
