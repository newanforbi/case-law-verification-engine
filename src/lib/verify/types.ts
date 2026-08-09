import type { QuoteFinding } from "./quotes";

export type { QuoteFinding, QuoteMatch, PinCite } from "./quotes";

/**
 * Every verdict, in the order a reader should scan them. Declared here, in the
 * one module with no imports, so the client bundle can enumerate verdicts
 * without dragging the source clients in behind it.
 */
export const CONSENSUS_KINDS = [
  "FOUND",
  "PARTIAL",
  "CAPTION_MISMATCH",
  "NOT_FOUND",
  "OUT_OF_COVERAGE",
  "UNCHECKED",
  "UNKNOWN",
] as const;

export type Consensus = (typeof CONSENSUS_KINDS)[number];


/**
 * What one source was actually able to say about a citation.
 *
 * The load-bearing distinction is ABSENT vs OUT_OF_SCOPE. A source that
 * carries the corpus a citation belongs to and does not have the case is
 * evidence the case is fabricated. A source whose corpus never covered that
 * citation — a volume past the end of its digitized run, a Westlaw-only
 * unpublished disposition — is evidence of nothing at all. Collapsing the two
 * into a single "miss" is what makes a verifier report real authority as
 * missing, which costs more trust than a caught fabrication earns.
 */
export type SourceOutcome = "FOUND" | "ABSENT" | "OUT_OF_SCOPE" | "UNAVAILABLE";

export interface SourceHit {
  source: "courtlistener" | "case.law_static";
  outcome: SourceOutcome;
  /** Mirrors `outcome === "FOUND"`. */
  found: boolean;
  /** Why this source could or could not speak to the citation. */
  coverage: string;
  url?: string;
  caseName?: string;
  citations?: string[];
  notes?: string;
  httpStatus?: number | null;
}

/**
 * Whether the opinion supports what was attributed to it — a separate question
 * from whether the case exists, and deliberately a separate verdict. A real
 * case quoted for language it does not contain is the failure that reaches
 * filings, and it would disappear if folded into an existence result.
 */
export const SUPPORT_KINDS = [
  "SUPPORTED",
  "QUALIFIED",
  "UNSUPPORTED",
  "INDETERMINATE",
  "NO_QUOTE",
  "UNCHECKED",
] as const;

export type Support = (typeof SUPPORT_KINDS)[number];

export interface PinFinding {
  page: string;
  /** null where the opinion carries no pagination markers to check against. */
  present: boolean | null;
}

export interface SupportReport {
  verdict: Support;
  quotes: QuoteFinding[];
  pin: PinFinding | null;
  /** Where the opinion's words were read from, when they could be read. */
  textSource?: SourceHit["source"];
  textUrl?: string;
}

export interface LookupResult {
  query: string;
  caseNameGuess: string;
  reporterPin: string | null;
  wlPin: string | null;
  sources: SourceHit[];
  consensus: Consensus;
  matchedName: string;
  matchedCitations: string[];
  support: SupportReport;
}

export interface VerifyResponse {
  generatedAt: string;
  methodology: {
    sources: string[];
    reference: string;
    controls: { positive: string; negative: string };
  };
  resultCount: number;
  counts: Record<Consensus, number>;
  results: LookupResult[];
}
