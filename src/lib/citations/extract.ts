/**
 * Citation extractor: reporter/Westlaw patterns + case-name pairing.
 *
 * Focus: case-law authorities for verification. Statutes/rules are catalogued
 * but not sent to the CourtListener/CAP existence probe.
 */

import { extractQuotedPassages } from "@/lib/verify/quotes";

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

/** One authority queued for verification, with nearby quoted language if any. */
export interface VerifyItem {
  citation: string;
  /** Passages quoted in the filing near this authority. */
  passages: string[];
}

export interface CitationExtractionResult {
  citations: ExtractedCitation[];
  /** Deduped case-law strings suitable for the verify engine (authority preferred). */
  verifyQueue: string[];
  /** Same queue, with quoted passages harvested from surrounding context. */
  verifyItems: VerifyItem[];
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
    // Keep L.R. forms tight: a bare `L.?R.?` plus `\s*` will walk the whole
    // filing looking for a later digit and hang real pleadings for minutes.
    "rule_local",
    String.raw`\b(?:Civil\s+L\.R\.?|ADR\s+L\.R\.?|Local\s+Rules?|L\.R\.)[^\S\n]*[\d]+[\-–.\d]*[A-Za-z0-9()]*`,
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

const COMPILED = PATTERNS.map(([kind, rx, flags]) => {
  // Always global — a non-global /i pattern makes exec() return the same first
  // match forever and hangs the scan whenever that kind appears in a filing.
  const mode = flags?.includes("g") ? flags : `${flags || ""}g`;
  return { kind, rx: new RegExp(rx, mode) };
});


const SUFFIX = String.raw`(?:Jr|Sr|II|III|IV|Inc|LLC|L\.L\.C|Corp|Co|Ltd|N\.A|P\.C|LLP)\.?`;
const WORD = String.raw`[A-Z][A-Za-z'’.\-]*`;
// Horizontal whitespace only — do not let all-caps headers on the prior
// line glue onto the next caption (e.g. "AUTHORITIES\nSee Richardson v. …").
const HS = String.raw`[^\S\n]`;
/** Soft space inside a party name — one line break is common in pleadings. */
const PS = String.raw`(?:[^\S\n]|\n)`;
const PARTY =
  `${WORD}(?:${PS}+(?:of|for|the|and|&|de|del|los|en)${PS}+)?` +
  `(?:${PS}*${WORD}){0,6}` +
  `(?:,${HS}*${SUFFIX})?`;

const CASE_NAME = new RegExp(
  // Keep "In re" on horizontal space so a prior all-caps header cannot glue on.
  // Party v. Party may wrap once across a line break in pleadings.
  `\\b(?:In${HS}+re${HS}+${WORD}(?:${HS}+${WORD}){0,4}|${PARTY}${PS}+v\\.?${PS}+${PARTY})`,
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
const PAIR_WINDOW = 160;
/** Short window for UI occurrence snippets. */
const CONTEXT_CHARS = 120;
/**
 * Quote harvest is biased forward: filings usually put the quoted language
 * immediately after the cite. A wide lookbehind steals the previous cite's
 * quote and attributes it to the next authority.
 */
const QUOTE_HARVEST_BEFORE = 40;
const QUOTE_HARVEST_AFTER = 280;

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
): { reporter: string; year: string | null; pinPage: string | null } | null {
  const tail = text.slice(nameEnd, nameEnd + PAIR_WINDOW);
  REPORTER_RX.lastIndex = 0;
  const rep = REPORTER_RX.exec(tail);
  if (!rep) return null;

  CASE_NAME.lastIndex = 0;
  const nxt = CASE_NAME.exec(tail);
  if (nxt && nxt.index < rep.index) return null;

  let year: string | null = null;
  const lead = tail.slice(0, rep.index);
  const after = tail.slice(rep.index + rep[0].length, rep.index + rep[0].length + 28);
  const ym = YEAR_RX.exec(lead) || YEAR_RX.exec(after);
  if (ym) year = ym[0].replace(/[()]/g, "");

  // `521 U.S. 399, 404` — keep the pin so support checking can see the page.
  let pinPage: string | null = null;
  const pinM = /^\s*,\s*(\d{1,5})\b/.exec(after);
  if (pinM) pinPage = pinM[1];

  return {
    reporter: tidy(rep[0]),
    year,
    pinPage,
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
    let guard = 0;
    while ((m = rx.exec(text))) {
      guard += 1;
      if (guard > 5000) {
        throw new Error(`Citation scan runaway on ${kind} (page ${page})`);
      }
      const start = m.index;
      const end = start + m[0].length;
      // Zero-width / stuck lastIndex — advance manually and continue.
      if (end <= start) {
        rx.lastIndex = start + 1;
        continue;
      }
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
  let nameGuard = 0;
  while ((nm = CASE_NAME.exec(text))) {
    nameGuard += 1;
    if (nameGuard > 5000) {
      throw new Error(`Case-name scan runaway (page ${page})`);
    }
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
      if (paired.pinPage) full += `, ${paired.pinPage}`;
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

function harvestPassages(
  citations: ExtractedCitation[],
  cite: string,
  pageTextByPage: Map<number, string>,
): string[] {
  const key = normalizeKey(cite);
  const passages: string[] = [];
  const seen = new Set<string>();

  for (const c of citations) {
    if (c.kind !== "authority") continue;
    const ck = normalizeKey(c.citation);
    // Exact / near-exact only — do not let a short reporter pin inherit every
    // quote on the page.
    if (ck !== key && !key.startsWith(ck) && !ck.startsWith(key)) continue;

    const pageText = pageTextByPage.get(c.page) || "";
    const window = pageText
      ? tidy(
          pageText.slice(
            Math.max(0, c.start - QUOTE_HARVEST_BEFORE),
            Math.min(pageText.length, c.end + QUOTE_HARVEST_AFTER),
          ),
        )
      : c.context;

    for (const passage of extractQuotedPassages(window)) {
      const pk = normalizeKey(passage);
      // Skip crumbs — matchPassage treats short absences as indeterminate anyway.
      if (!pk || pk.length < 16 || seen.has(pk)) continue;
      seen.add(pk);
      passages.push(passage);
      if (passages.length >= 3) return passages;
    }
  }

  return passages;
}

/** Build a verify queue: prefer paired authorities, then bare reporters / WL. */
export function buildVerifyQueue(
  citations: ExtractedCitation[],
  limit = 40,
  pageTextByPage: Map<number, string> = new Map(),
): { queue: string[]; items: VerifyItem[] } {
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

  const sliced = queue.slice(0, limit);
  const items = sliced.map((citation) => ({
    citation,
    passages: harvestPassages(citations, citation, pageTextByPage),
  }));
  return { queue: sliced, items };
}

export function extractCitationsFromPages(
  pages: Array<{ page: number; text: string }>,
  options: { verifyLimit?: number } = {},
): CitationExtractionResult {
  const citations: ExtractedCitation[] = [];
  const pageTextByPage = new Map<number, string>();
  for (const p of pages) {
    if (!p.text?.trim()) continue;
    pageTextByPage.set(p.page, p.text);
    citations.push(...scanPage(p.text, p.page));
  }

  const countsByKind: Record<string, number> = {};
  for (const c of citations) {
    countsByKind[c.kind] = (countsByKind[c.kind] || 0) + 1;
  }

  const built = buildVerifyQueue(
    citations,
    options.verifyLimit ?? 40,
    pageTextByPage,
  );

  return {
    citations,
    verifyQueue: built.queue,
    verifyItems: built.items,
    countsByKind,
  };
}

export function extractCitationsFromText(
  text: string,
  options: { verifyLimit?: number } = {},
): CitationExtractionResult {
  return extractCitationsFromPages([{ page: 1, text }], options);
}
