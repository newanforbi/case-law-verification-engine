/**
 * Quote and pin-cite checking: does the opinion actually say the thing.
 *
 * Existence checking catches the invented case. It does not catch the failure
 * that more often reaches a filing — a real case cited for language it does
 * not contain — and that is what this module is for.
 *
 * The whole file is pure. Retrieval lives in opinion.ts, so the matching
 * rules, which are where the subtlety is, can be tested without a network.
 */

export type QuoteMatch =
  /** Present as written, once whitespace and quote glyphs are normalized. */
  | "VERBATIM"
  /** Present, but only after standard quoting conventions are undone. */
  | "ALTERED"
  /** The opinion text was searched in full and does not contain it. */
  | "ABSENT"
  /** Too short to conclude anything from its absence. */
  | "INDETERMINATE";

export interface QuoteFinding {
  passage: string;
  match: QuoteMatch;
  /** What had to be normalized away, when the match was not verbatim. */
  note?: string;
}

export interface PinCite {
  firstPage: string;
  pinPage: string;
}

/**
 * Below this many normalized characters, a passage's absence says more about
 * formatting noise than about the quote, so it is reported as indeterminate
 * rather than as a miss.
 */
const MIN_CONCLUSIVE_LENGTH = 16;

/** Bracketed asides a writer adds; they are not in the opinion and must go. */
const EDITORIAL_BRACKET =
  /\[(?:sic|emphasis (?:added|in original|omitted)|citations? omitted|internal quotation marks omitted|alterations? in original|quoting[^\]]*)\]/gi;

const ELLIPSIS = /(?:\.\s*){3,}|…/g;

/** The same pattern without /g: .test() on a global regex carries lastIndex. */
const HAS_ELLIPSIS = new RegExp(ELLIPSIS.source);

/** Curly quotes, dashes, and runs of whitespace differ by typesetting alone. */
function normalizeTypography(s: string): string {
  return s
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Everything above, plus the conventions a quoting lawyer legitimately uses. */
function normalizeForAltered(s: string): string {
  return normalizeTypography(s)
    .replace(EDITORIAL_BRACKET, " ")
    // [T]he -> The: a bracketed substitution stands for the original letters,
    // so unwrapping it and folding case puts both sides on the same footing.
    .replace(/\[([^\]]{1,40})\]/g, "$1")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Quoted passages in a line, straight or curly, longest run wins. */
export function extractQuotedPassages(line: string): string[] {
  const out: string[] = [];
  const patterns = [/"([^"]{4,})"/g, /“([^”]{4,})”/g];
  for (const re of patterns) {
    for (const m of line.matchAll(re)) {
      const passage = m[1].trim();
      if (passage) out.push(passage);
    }
  }
  return out;
}

/**
 * The pin page in `521 U.S. 399, 404` — the page the proposition is actually
 * being attributed to, as opposed to where the case begins.
 */
export function parsePinCite(citation: string, firstPage: string): PinCite | null {
  const escaped = firstPage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`\\b${escaped}\\s*,\\s*(\\d+)`).exec(citation);
  if (!m) return null;
  if (m[1] === firstPage) return null;
  return { firstPage, pinPage: m[1] };
}

/** Ordered containment: every segment between ellipses, in sequence. */
function containsSegments(haystack: string, segments: string[]): boolean {
  let from = 0;
  for (const seg of segments) {
    if (!seg) continue;
    const at = haystack.indexOf(seg, from);
    if (at === -1) return false;
    from = at + seg.length;
  }
  return true;
}

function segmentsOf(passage: string, normalize: (s: string) => string): string[] {
  return passage
    .split(ELLIPSIS)
    .map((part) => normalize(part))
    .filter(Boolean);
}

/**
 * Look for one passage in an opinion.
 *
 * Verbatim and altered are kept apart deliberately. A quote that only matches
 * after brackets and ellipses are undone is still a fair quote, but it is a
 * different fact about the filing than one that matches as written, and only
 * the reader can say whether the alteration changed the meaning.
 */
export function matchPassage(passage: string, opinionText: string): QuoteFinding {
  const elided = HAS_ELLIPSIS.test(passage);

  // An elided passage is never verbatim, however exactly its fragments match.
  // What an ellipsis removes is unbounded, and the classic misquote elides a
  // "not" — so the reader is told material is missing and sent to the original.
  if (!elided) {
    const strictHay = normalizeTypography(opinionText);
    const strictSegs = segmentsOf(passage, normalizeTypography);
    if (strictSegs.length && containsSegments(strictHay, strictSegs)) {
      return { passage, match: "VERBATIM" };
    }
  }

  const looseHay = normalizeForAltered(opinionText);
  const looseSegs = segmentsOf(passage, normalizeForAltered);
  const looseLength = looseSegs.join(" ").length;

  if (looseSegs.length && containsSegments(looseHay, looseSegs)) {
    const reasons: string[] = [];
    if (elided) reasons.push("elision");
    if (/\[[^\]]+\]/.test(passage)) reasons.push("bracketed alteration");
    if (!reasons.length) reasons.push("punctuation or capitalization");
    return {
      passage,
      match: "ALTERED",
      note: `Found after normalizing ${reasons.join(" and ")} — read the original before relying on the wording.`,
    };
  }

  if (looseLength < MIN_CONCLUSIVE_LENGTH) {
    return {
      passage,
      match: "INDETERMINATE",
      note: "Too short for its absence to mean anything.",
    };
  }

  return { passage, match: "ABSENT" };
}

/** Page markers an opinion carries, as star pagination or CAP page labels. */
export function pageLabelsIn(text: string): Set<string> {
  const labels = new Set<string>();
  for (const m of text.matchAll(/\*(\d{1,5})\b/g)) labels.add(m[1]);
  for (const m of text.matchAll(/data-label="(\d{1,5})"/g)) labels.add(m[1]);
  for (const m of text.matchAll(/\bid="p(\d{1,5})"/g)) labels.add(m[1]);
  return labels;
}
