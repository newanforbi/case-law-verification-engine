/**
 * Citation extractor: reporter/Westlaw patterns + case-name pairing.
 *
 * Focus: case-law authorities for verification. Statutes are queued separately
 * for LII / LegInfo probes and never enter the CourtListener/CAP case queue.
 */

import { extractQuotedPassages } from "@/lib/verify/quotes";
import type { Proposition, PropositionRole } from "@/lib/verify/types";

export type { Proposition, PropositionRole };

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
  /** Prose propositions the filing attributes to (or aims at) this authority. */
  propositions: Proposition[];
}

/** One statute queued for a free-code probe (LII / LegInfo), not CL/CAP. */
export interface StatuteItem {
  citation: string;
  kind: "statute_federal" | "statute_state";
  page?: number;
}

export interface CitationExtractionResult {
  citations: ExtractedCitation[];
  /** Deduped case-law strings suitable for the verify engine (authority preferred). */
  verifyQueue: string[];
  /** Same queue, with quoted passages harvested from surrounding context. */
  verifyItems: VerifyItem[];
  /** Deduped statute cites for optional LII / LegInfo probes. */
  statuteQueue: string[];
  statuteItems: StatuteItem[];
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
 * Quote harvest is forward-only from the authority span. Filings put the
 * quoted language after the cite; a lookbehind steals the previous cite's
 * trailing parenthetical and attributes it to the next authority. The forward
 * window is wide enough for a signal + parenthetical quote on the next line,
 * and is clipped at the next authority on the same page.
 */
const QUOTE_HARVEST_AFTER = 420;
/** Look back for the rule-sentence that the cite is offered to support. */
const PROP_HARVEST_BEFORE = 320;
const PROP_HARVEST_AFTER = 220;
const MAX_PROPOSITIONS = 3;

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
): {
  reporter: string;
  year: string | null;
  pinPage: string | null;
  /** Absolute end index covering reporter, pin page, and year. */
  end: number;
} | null {
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

  let relativeEnd = rep.index + rep[0].length;
  if (pinM) relativeEnd = Math.max(relativeEnd, rep.index + rep[0].length + pinM[0].length);
  if (ym && ym.index >= rep.index) {
    relativeEnd = Math.max(relativeEnd, ym.index + ym[0].length);
  } else if (ym) {
    // Year before reporter is already inside the name→reporter gap.
  }
  // Include a trailing year immediately after the pin when present.
  const yearAfter = /^\s*\((?:19|20)\d{2}\)/.exec(tail.slice(relativeEnd));
  if (yearAfter) relativeEnd += yearAfter[0].length;

  return {
    reporter: tidy(rep[0]),
    year,
    pinPage,
    end: nameEnd + relativeEnd,
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
      // end covers the pin (not just the caption) so quote harvest can clip
      // neighboring authorities without leaving this cite's quote in the next
      // cite's lookbehind window.
      out.push({
        kind: "authority",
        citation: full,
        page,
        context: contextAround(text, start, paired.end),
        start,
        end: paired.end,
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

function nextAuthorityStart(
  citations: ExtractedCitation[],
  current: ExtractedCitation,
): number | null {
  let best: number | null = null;
  for (const other of citations) {
    if (other.kind !== "authority") continue;
    if (other.page !== current.page) continue;
    if (other.start <= current.start) continue;
    if (best === null || other.start < best) best = other.start;
  }
  return best;
}

function previousAuthorityEnd(
  citations: ExtractedCitation[],
  current: ExtractedCitation,
): number | null {
  let best: number | null = null;
  for (const other of citations) {
    if (other.kind !== "authority") continue;
    if (other.page !== current.page) continue;
    if (other.end > current.start) continue;
    if (best === null || other.end > best) best = other.end;
  }
  return best;
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
    // From this authority through the gap before the next one — never back
    // into the previous authority's trailing quote.
    const nextStart = nextAuthorityStart(citations, c);
    const softStart = c.start;
    const softEnd = Math.min(
      pageText.length,
      c.end + QUOTE_HARVEST_AFTER,
      nextStart ?? Number.POSITIVE_INFINITY,
    );
    const window = pageText
      ? tidy(pageText.slice(softStart, softEnd))
      : c.context;

    for (const passage of extractQuotedPassages(window)) {
      const pk = normalizeKey(passage);
      // Skip crumbs — matchPassage treats short absences as indeterminate anyway.
      if (!pk || pk.length < 16 || seen.has(pk)) continue;
      seen.add(pk);
      passages.push(passage);
      if (passages.length >= 4) return passages;
    }

    // Em-dash / signal attribution without wrapping quotes still sometimes
    // carries a quoted clause further down the same sentence.
    const dashWindow = window.replace(/[—–]/g, " — ");
    if (dashWindow !== window) {
      for (const passage of extractQuotedPassages(dashWindow)) {
        const pk = normalizeKey(passage);
        if (!pk || pk.length < 16 || seen.has(pk)) continue;
        seen.add(pk);
        passages.push(passage);
        if (passages.length >= 4) return passages;
      }
    }
  }

  return passages;
}

function detectPropositionRole(leadIn: string): PropositionRole {
  const head = leadIn.slice(0, Math.min(leadIn.length, 200));
  if (
    /\b(?:but\s+see|contra|contrast(?:ed|ing)?|distinguish(?:ed|ing|es)?|unlike|although\b[\s\S]{0,80}\b(?:held|concluded|found))\b/i.test(
      head,
    ) ||
    /\banticipat(?:e|es|ing)\b/i.test(head) ||
    /\b(?:cuts?\s+against|does\s+not\s+(?:control|apply|govern)|is\s+not\s+to\s+the\s+contrary)\b/i.test(
      head,
    )
  ) {
    return "anticipates_contrary";
  }
  if (/\b(?:cf\.?|compare)\b/i.test(head)) {
    return "distinguishes";
  }
  return "supports";
}

/**
 * Split prose into sentences without breaking on legal abbreviations (v., Cal.,
 * U.S., App., etc.).
 */
function splitSentences(text: string): string[] {
  // Mask short abbreviations so "v. Sparkman" / "U.S." / "Cal.App." don't split.
  const masked = text.replace(/\b([A-Za-z]{1,4})\./g, "$1\uE000");
  const parts = masked.split(/(?<=[.!?])\s+(?=[A-Z("“])|\n{2,}/);
  return parts
    .map((p) => tidy(p.replace(/\uE000/g, ".")))
    .filter((p) => p.length >= 12);
}

function stripCitationScaffolding(sentence: string): string {
  return tidy(
    sentence
      .replace(SIGNAL_PREFIX, "")
      .replace(
        /\b[A-Z][^,]{0,80},\s*\d{1,4}\s+(?:U\.?\s?S\.?|F\.|Cal\.)[^)]{0,60}\((?:19|20)\d{2}\)/g,
        " ",
      )
      .replace(/\b\d{1,4}\s+(?:U\.?\s?S\.?|F\.|Cal\.)[^\s,]{0,40}\s+\d{1,4}(?:,\s*\d{1,5})?(?:\s*\((?:19|20)\d{2}\))?/gi, " ")
      .replace(/\((?:19|20)\d{2}\)/g, " ")
      .replace(/\s+/g, " "),
  );
}

function looksLikeProposition(sentence: string): boolean {
  const meat = stripCitationScaffolding(sentence);
  if (meat.length < 28) return false;
  return (
    /\b(?:held|holding|requires?|must|may\s+not|creates?|establishes?|provides?|protects?|bars?|precludes?|immunity|due\s+process|jurisdiction|standing|standard|rule|principle|theory|cuts?\s+against|does\s+not\s+extend)\b/i.test(
      meat,
    ) || meat.length >= 48
  );
}

/**
 * Harvest the filing's claimed propositions around an authority — the prose
 * the cite is offered to support (or distinguish / anticipate).
 */
export function harvestPropositions(
  citations: ExtractedCitation[],
  cite: string,
  pageTextByPage: Map<number, string>,
): Proposition[] {
  const key = normalizeKey(cite);
  const out: Proposition[] = [];
  const seen = new Set<string>();

  for (const c of citations) {
    if (c.kind !== "authority") continue;
    const ck = normalizeKey(c.citation);
    if (ck !== key && !key.startsWith(ck) && !ck.startsWith(key)) continue;

    const pageText = pageTextByPage.get(c.page) || "";
    if (!pageText) continue;

    // Stay between neighboring authorities so one cite cannot inherit another.
    const prevEnd = previousAuthorityEnd(citations, c) ?? 0;
    const nextStart = nextAuthorityStart(citations, c) ?? pageText.length;
    const winStart = Math.max(prevEnd, c.start - PROP_HARVEST_BEFORE);
    const winEnd = Math.min(nextStart, c.end + PROP_HARVEST_AFTER);
    if (winEnd <= winStart) continue;

    const before = tidy(pageText.slice(winStart, c.start));
    const around = tidy(pageText.slice(winStart, Math.min(winEnd, c.end + 80)));
    const after = tidy(pageText.slice(c.end, winEnd));
    const role = detectPropositionRole(around || before);

    const beforeSentences = splitSentences(before);
    const afterSentences = splitSentences(after);
    const aroundSentences = splitSentences(
      tidy(pageText.slice(winStart, winEnd)),
    );

    const candidates: string[] = [];
    const prev = beforeSentences[beforeSentences.length - 1];
    if (prev && looksLikeProposition(prev)) candidates.push(prev);

    const citeToken = c.citation.split(",")[0]?.slice(0, 32) || "";
    const partyHint = citeToken.split(/\s+v\.?\s+/i)[0]?.slice(0, 16) || "";
    const containing = aroundSentences.find(
      (s) => partyHint && s.includes(partyHint),
    );
    if (containing && looksLikeProposition(containing)) {
      candidates.push(containing);
    }

    // After the cite: only keep continuations (which/that…), not the next
    // authority's lead-in sentence.
    for (const s of afterSentences.slice(0, 2)) {
      if (
        /^(?:which|that|and|because|holding|so|thus|therefore|,)/i.test(s) &&
        looksLikeProposition(s)
      ) {
        candidates.push(s);
      }
    }

    for (let text of candidates) {
      text = tidy(
        text
          .replace(
            /^(?:POINTS AND AUTHORITIES|TABLE OF AUTHORITIES|ARGUMENT|INTRODUCTION)\s+/i,
            "",
          )
          .replace(/^,\s*/, ""),
      );
      const pk = normalizeKey(text);
      if (!pk || pk.length < 24 || seen.has(pk)) continue;
      // Drop lines that are basically just the citation.
      if (stripCitationScaffolding(text).length < 28) continue;
      if (pk === normalizeKey(c.citation)) continue;
      // Prefer the longer form when a fragment is already covered.
      const dominated = [...seen].some(
        (existing) => existing.includes(pk) && existing.length > pk.length,
      );
      if (dominated) continue;
      for (const existing of [...seen]) {
        if (pk.includes(existing) && pk.length > existing.length) {
          seen.delete(existing);
          const idx = out.findIndex((p) => normalizeKey(p.text) === existing);
          if (idx >= 0) out.splice(idx, 1);
        }
      }
      seen.add(pk);
      out.push({ text, page: c.page, role });
      if (out.length >= MAX_PROPOSITIONS) return out;
    }
  }

  return out;
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
    propositions: harvestPropositions(citations, citation, pageTextByPage),
  }));
  return { queue: sliced, items };
}

/** Build a statute probe queue — never merged into the case-law verify queue. */
export function buildStatuteQueue(
  citations: ExtractedCitation[],
  limit = 25,
): { queue: string[]; items: StatuteItem[] } {
  const seen = new Set<string>();
  const items: StatuteItem[] = [];

  for (const c of citations) {
    if (c.kind !== "statute_federal" && c.kind !== "statute_state") continue;
    const key = normalizeKey(c.citation);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    items.push({ citation: c.citation, kind: c.kind, page: c.page });
    if (items.length >= limit) break;
  }

  return { queue: items.map((i) => i.citation), items };
}

export function extractCitationsFromPages(
  pages: Array<{ page: number; text: string }>,
  options: { verifyLimit?: number; statuteLimit?: number } = {},
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
  const statutes = buildStatuteQueue(citations, options.statuteLimit ?? 25);

  return {
    citations,
    verifyQueue: built.queue,
    verifyItems: built.items,
    statuteQueue: statutes.queue,
    statuteItems: statutes.items,
    countsByKind,
  };
}

export function extractCitationsFromText(
  text: string,
  options: { verifyLimit?: number } = {},
): CitationExtractionResult {
  return extractCitationsFromPages([{ page: 1, text }], options);
}
