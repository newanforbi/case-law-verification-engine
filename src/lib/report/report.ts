/**
 * The verification report: the artifact a filing can be accompanied by.
 *
 * A results screen answers a question and then vanishes on refresh. What a
 * firm can actually use is a record — what was checked, against which sources,
 * when, with what method, and what the method could not reach. Courts issuing
 * standing orders on AI use are asking for exactly that, and it is the only
 * part of this tool that survives being closed.
 *
 * Pure and client-safe: it reshapes a VerifyResponse, and never fetches.
 */
import type {
  Consensus,
  LookupResult,
  PinFinding,
  QuoteFinding,
  Support,
  VerifyResponse,
} from "@/lib/verify";
import { CONSENSUS_KINDS, SUPPORT_KINDS } from "@/lib/verify/types";

export interface ReportSource {
  source: string;
  outcome: string;
  coverage: string;
  url?: string;
}

export interface ReportRecord {
  citation: string;
  parsedName: string;
  cite: string | null;
  westlaw: string | null;
  existence: Consensus;
  support: Support;
  matchedCaption: string;
  sources: ReportSource[];
  quotes: QuoteFinding[];
  pin: PinFinding | null;
}

export interface VerificationReport {
  id: string;
  generatedAt: string;
  tool: string;
  document?: { fileName: string; pageCount: number };
  methodology: VerifyResponse["methodology"];
  summary: {
    citations: number;
    existence: Record<Consensus, number>;
    support: Record<Support, number>;
  };
  records: ReportRecord[];
  /** The limits, carried by the artifact rather than left to the reader. */
  caveats: string[];
}

/**
 * FNV-1a over the report's content. Not a security property — it is a handle,
 * so two people looking at the same run can confirm they hold the same one.
 */
function digest(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function emptyTally<T extends string>(kinds: readonly T[]): Record<T, number> {
  return Object.fromEntries(kinds.map((k) => [k, 0])) as Record<T, number>;
}

function toRecord(r: LookupResult): ReportRecord {
  return {
    citation: r.query,
    parsedName: r.caseNameGuess,
    cite: r.reporterPin,
    westlaw: r.wlPin,
    existence: r.consensus,
    support: r.support.verdict,
    matchedCaption: r.matchedName,
    sources: r.sources.map((s) => ({
      source: s.source,
      outcome: s.outcome,
      coverage: s.coverage,
      url: s.url,
    })),
    quotes: r.support.quotes,
    pin: r.support.pin,
  };
}

/**
 * State the limits that apply to this particular run.
 *
 * Generic disclaimers get skimmed. These are conditional on what actually
 * happened, so a reader can tell an unqualified pass from one with holes in
 * it, and so nobody mistakes a citation nothing could reach for a cleared one.
 */
function caveatsFor(records: ReportRecord[]): string[] {
  const out: string[] = [
    "We check what the opinion says, not whether it supports the argument. A case can be real, correctly quoted, and still not carry the weight the filing places on it.",
  ];

  const count = (fn: (r: ReportRecord) => boolean) => records.filter(fn).length;

  const unchecked = count((r) => r.existence === "UNCHECKED");
  if (unchecked) {
    out.push(
      `${unchecked} citation${unchecked === 1 ? " was" : "s were"} not checked at all — a source was unreachable. Nothing in this report speaks to ${unchecked === 1 ? "it" : "them"}.`,
    );
  }

  const uncovered = count((r) => r.existence === "OUT_OF_COVERAGE");
  if (uncovered) {
    out.push(
      `${uncovered} citation${uncovered === 1 ? " falls" : "s fall"} outside both free sources — typically unpublished or Westlaw-only. Their absence here is not evidence; confirm in a paid database.`,
    );
  }

  const quoteUnchecked = count(
    (r) => r.support === "UNCHECKED" || r.support === "INDETERMINATE",
  );
  if (quoteUnchecked) {
    out.push(
      `Quoted language could not be confirmed for ${quoteUnchecked} citation${quoteUnchecked === 1 ? "" : "s"} — the opinion text was unavailable, or the quote was too short to judge.`,
    );
  }

  const noQuote = count((r) => r.support === "NO_QUOTE");
  if (noQuote === records.length && records.length) {
    out.push(
      "No quoted language was supplied, so nothing in this report speaks to what these authorities say.",
    );
  }

  return out;
}

export function buildReport(
  data: VerifyResponse,
  extra: { document?: { fileName: string; pageCount: number }; tool?: string } = {},
): VerificationReport {
  const records = data.results.map(toRecord);

  const existence = emptyTally(CONSENSUS_KINDS);
  const support = emptyTally(SUPPORT_KINDS);
  for (const r of records) {
    existence[r.existence] += 1;
    support[r.support] += 1;
  }

  const body = {
    generatedAt: data.generatedAt,
    records: records.map((r) => [r.citation, r.existence, r.support]),
  };

  return {
    id: digest(JSON.stringify(body)),
    generatedAt: data.generatedAt,
    tool: extra.tool ?? "Citeproof",
    document: extra.document,
    methodology: data.methodology,
    summary: { citations: records.length, existence, support },
    records,
    caveats: caveatsFor(records),
  };
}

/** A stable file name, so a saved report says what it is on disk. */
export function reportFileName(report: VerificationReport): string {
  const day = report.generatedAt.slice(0, 10);
  const base = report.document?.fileName?.replace(/\.pdf$/i, "") ?? "citations";
  const safe = base.replace(/[^a-z0-9-_]+/gi, "-").slice(0, 40);
  return `citeproof-${safe}-${day}-${report.id}.json`;
}
