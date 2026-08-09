/**
 * Citation extractor adapted from litigation-portfolio PR #493
 * (build-citation-index.py): reporter/Westlaw patterns + case-name pairing.
 *
 * Focus: case-law authorities for verification. Statutes/rules are catalogued
 * but not sent to the CourtListener/CAP existence probe.
 */

export type CiteKind =
  | "authority"
  | "case_reporter"
  | "case_westlaw"
  | "case_name"
  | "statute_federal"
  | "statute_state"
  | "regulation_federal"
  | "regulation_state"
  | "rule_federal"
  | "rule_state"
  | "rule_local"
  | "constitutional"
  | "section_shorthand";

export interface ExtractedCitation {
  kind: CiteKind;
  citation: string;
  page: number;
  context: string;
  start: number;
  end: number;
}

export interface CitationExtractionResult {
  citations: ExtractedCitation[];
  /** Deduped case-law strings suitable for the verify engine (authority preferred). */
  verifyQueue: string[];
  countsByKind: Record<string, number>;
}

const REPORTERS = [
  String.raw`U\.?\s?S\.?`,
  String.raw`S\.?\s?Ct\.?`,
  String.raw`L\.?\s?Ed\.?(?:\s?2d)?`,
  String.raw`F\.?\s?(?:2d|3d|4th)`,
  String.raw`F\.?\s?Supp\.?(?:\s?2d|\s?3d)?`,
  String.raw`F\.?\s?App'?x`,
  String.raw`F\.?R\.?D\.?`,
  String.raw`Cal\.?\s?(?:2d|3d|4th|5th)`,
  String.raw`Cal\.?\s?App\.?\s?(?:2d|3d|4th|5th)?`,
  String.raw`Cal\.?\s?Rptr\.?(?:\s?2d|\s?3d)?`,
  String.raw`P\.?\s?(?:2d|3d)`,
  String.raw`Cal\.?\s?App\.?\s?Supp\.?`,
  String.raw`M\.?\s?J\.?`,
];
const REPORTER_ALT = REPORTERS.join("|");
const WESTLAW_CITE = String.raw`\b(?:19|20)\d{2}\s+WL\s+\d{4,}`;

const PATTERNS: Array<[CiteKind, string, string?]> = [
  [
    "statute_federal",
    String.raw`\b\d{1,2}\s+U\.?\s?S\.?\s?C\.?\s*§{1,2}\s*\d+[A-Za-z0-9()\-–.]*`,
  ],
  [
    "regulation_federal",
    String.raw`\b\d{1,2}\s+C\.?\s?F\.?\s?R\.?\s*§{1,2}\s*[\d.]+[A-Za-z0-9()\-–.]*`,
  ],
  [
    "regulation_state",
    String.raw`\b\d{1,2}\s+(?:C\.?\s?C\.?\s?R\.?|Cal\.\s?Code\s?Regs\.?)[^§\n]{0,24}§{1,2}\s*[\d.]+[A-Za-z0-9()\-–.]*`,
  ],
  ["case_reporter", String.raw`\b\d{1,4}\s+(?:${REPORTER_ALT})\s+\d{1,4}`],
  [
    "statute_state",
    String.raw`\b(?:Penal|Civil|Government|Vehicle|Evidence|Labor|Welfare\s+(?:and|&)\s+Institutions|` +
      String.raw`Health\s+(?:and|&)\s+Safety|Business\s+(?:and|&)\s+Professions|Code\s+of\s+Civil\s+Procedure|` +
      String.raw`Civ\.\s?Proc\.|C\.C\.P\.|CCP|Pen\.|Civ\.|Gov(?:'t|t)?\.|Veh\.|Evid\.|Lab\.|W(?:elf)?\.?\s?&\s?I\.?)` +
      String.raw`[^§\n]{0,20}(?:Code)?[^§\n]{0,12}§{1,2}\s*[\d.]+[A-Za-z0-9()\-–.]*`,
  ],
  ["section_shorthand", String.raw`§{1,2}\s*\d[\d.]*[A-Za-z0-9()\-–.]*`],
  [
    "rule_federal",
    String.raw`\b(?:F\.?R\.?C\.?P\.?|Fed\.?\s?R\.?\s?Civ\.?\s?P\.?|Fed\.?\s?R\.?\s?Evid\.?|` +
      String.raw`Federal\s+Rules?\s+of\s+Civil\s+Procedure)[^\n]{0,6}\s*\d+[A-Za-z0-9()\-–.]*`,
    "i",
  ],
  [
    "rule_local",
    String.raw`\b(?:Civil\s+L\.?R\.?|ADR\s+L\.?R\.?|Local\s+Rule|L\.?R\.?)\s*[\d]+[\-–.\d]*[A-Za-z0-9()]*`,
    "i",
  ],
  [
    "rule_state",
    String.raw`\b(?:California\s+Rules?\s+of\s+Court|Cal\.?\s?Rules?\s+of\s+Court|CRC)[^\n]{0,10}` +
      String.raw`\s*(?:rule\s*)?[\d.]+[A-Za-z0-9()\-–.]*`,
    "i",
  ],
  ["case_westlaw", WESTLAW_CITE],
  [
    "constitutional",
    String.raw`\b(?:First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth|Eleventh|Fourteenth)\s+Amendment`,
  ],
];

const COMPILED = PATTERNS.map(([kind, rx, flags]) => ({
  kind,
  rx: new RegExp(rx, flags || "g"),
}));

const SUFFIX = String.raw`(?:Jr|Sr|II|III|IV|Inc|LLC|L\.L\.C|Corp|Co|Ltd|N\.A|P\.C|LLP)\.?`;
const WORD = String.raw`[A-Z][A-Za-z'’.\-]*`;
// Horizontal whitespace only — do not let all-caps headers on the prior
// line glue onto the next caption (e.g. "AUTHORITIES\nSee Richardson v. …").
const HS = String.raw`[^\S\n]`;
const PARTY =
  `${WORD}(?:${HS}+(?:of|for|the|and|&|de|del|los|en)${HS}+)?` +
  `(?:${HS}*${WORD}){0,5}` +
  `(?:,${HS}*${SUFFIX})?`;

const CASE_NAME = new RegExp(
  `\\b(?:In${HS}+re${HS}+${WORD}(?:${HS}+${WORD}){0,4}|${PARTY}${HS}+v\\.?${HS}+${PARTY})`,
  "g",
);

const SIGNAL_PREFIX =
  /^(?:See(?:\s+also)?|Compare|Cf\.?|But\s+see|Accord|Contra|Under)\s+/i;

const LEADING_JUNK = new RegExp(`^(?:${SUFFIX})\\b`, "i");
const REPORTER_RX = new RegExp(
  `\\b\\d{1,4}\\s+(?:${REPORTER_ALT})\\s+\\d{1,4}|${WESTLAW_CITE}`,
  "g",
);
const YEAR_RX = /\((?:19|20)\d{2}\)/;
const PAIR_WINDOW = 140;
const CONTEXT_CHARS = 120;

function overlaps(
  claimed: Array<[number, number]>,
  a: number,
  b: number,
): boolean {
  return claimed.some(([s, e]) => !(b <= s || a >= e));
}

function tidy(raw: string): string {
  let s = raw.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  while (s && ".,;:)".includes(s[s.length - 1]!)) {
    if (s.endsWith(")") && (s.match(/\(/g) || []).length >= (s.match(/\)/g) || []).length) {
      break;
    }
    s = s.slice(0, -1);
  }
  return s;
}

function pairAuthority(
  text: string,
  nameEnd: number,
): { reporter: string; year: string | null } | null {
  const tail = text.slice(nameEnd, nameEnd + PAIR_WINDOW);
  REPORTER_RX.lastIndex = 0;
  const rep = REPORTER_RX.exec(tail);
  if (!rep) return null;

  CASE_NAME.lastIndex = 0;
  const nxt = CASE_NAME.exec(tail);
  if (nxt && nxt.index < rep.index) return null;

  let year: string | null = null;
  const lead = tail.slice(0, rep.index);
  const after = tail.slice(rep.index + rep[0].length, rep.index + rep[0].length + 24);
  const ym = YEAR_RX.exec(lead) || YEAR_RX.exec(after);
  if (ym) year = ym[0].replace(/[()]/g, "");

  return {
    reporter: tidy(rep[0]),
    year,
  };
}

function contextAround(text: string, start: number, end: number): string {
  const a = Math.max(0, start - CONTEXT_CHARS);
  const b = Math.min(text.length, end + CONTEXT_CHARS);
  return tidy(text.slice(a, b));
}

function scanPage(text: string, page: number): ExtractedCitation[] {
  const claimed: Array<[number, number]> = [];
  const out: ExtractedCitation[] = [];

  for (const { kind, rx } of COMPILED) {
    rx.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(text))) {
      const start = m.index;
      const end = start + m[0].length;
      if (overlaps(claimed, start, end)) continue;
      claimed.push([start, end]);
      out.push({
        kind,
        citation: tidy(m[0]),
        page,
        context: contextAround(text, start, end),
        start,
        end,
      });
    }
  }

  CASE_NAME.lastIndex = 0;
  let nm: RegExpExecArray | null;
  while ((nm = CASE_NAME.exec(text))) {
    const raw = nm[0];
    if (LEADING_JUNK.test(raw)) continue;
    const start = nm.index;
    const end = start + raw.length;
    if (overlaps(claimed, start, end)) continue;

    const name = tidy(raw.replace(SIGNAL_PREFIX, ""));
    if (!name) continue;

    const paired = pairAuthority(text, end);
    if (paired) {
      let full = `${name}, ${paired.reporter}`;
      if (paired.year) full += ` (${paired.year})`;
      out.push({
        kind: "authority",
        citation: full,
        page,
        context: contextAround(text, start, end + PAIR_WINDOW),
        start,
        end,
      });
    }
    out.push({
      kind: "case_name",
      citation: name,
      page,
      context: contextAround(text, start, end),
      start,
      end,
    });
    claimed.push([start, end]);
  }

  return out;
}

function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Build a verify queue: prefer paired authorities, then bare reporters / WL. */
export function buildVerifyQueue(
  citations: ExtractedCitation[],
  limit = 40,
): string[] {
  const authorities = citations.filter((c) => c.kind === "authority");
  const reporters = citations.filter(
    (c) => c.kind === "case_reporter" || c.kind === "case_westlaw",
  );

  const seen = new Set<string>();
  const queue: string[] = [];

  const push = (cite: string) => {
    const key = normalizeKey(cite);
    if (!key || seen.has(key)) return;
    // Skip if a longer authority already covers this reporter pin.
    for (const existing of seen) {
      if (existing.includes(key) || key.includes(existing)) {
        // Prefer keeping the longer (usually name+pin) entry.
        if (existing.length >= key.length) return;
      }
    }
    seen.add(key);
    queue.push(cite);
  };

  for (const c of authorities) push(c.citation);

  // Bare reporter/WL only if not already subsumed by an authority.
  for (const c of reporters) {
    const key = normalizeKey(c.citation);
    const covered = [...seen].some((s) => s.includes(key));
    if (!covered) push(c.citation);
  }

  return queue.slice(0, limit);
}

export function extractCitationsFromPages(
  pages: Array<{ page: number; text: string }>,
  options: { verifyLimit?: number } = {},
): CitationExtractionResult {
  const citations: ExtractedCitation[] = [];
  for (const p of pages) {
    if (!p.text?.trim()) continue;
    citations.push(...scanPage(p.text, p.page));
  }

  const countsByKind: Record<string, number> = {};
  for (const c of citations) {
    countsByKind[c.kind] = (countsByKind[c.kind] || 0) + 1;
  }

  return {
    citations,
    verifyQueue: buildVerifyQueue(citations, options.verifyLimit ?? 40),
    countsByKind,
  };
}

export function extractCitationsFromText(
  text: string,
  options: { verifyLimit?: number } = {},
): CitationExtractionResult {
  return extractCitationsFromPages([{ page: 1, text }], options);
}
