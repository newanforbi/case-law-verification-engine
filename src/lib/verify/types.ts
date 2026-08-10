import type { CoverageEnvelope } from "./coverage";
import type { QuoteFinding } from "./quotes";

export type { QuoteFinding, QuoteMatch, PinCite } from "./quotes";
export type { CoverageEnvelope, CoverageReason, Jurisdiction } from "./coverage";

/**
 * Method identity stamped into every verify response and exportable report.
 * Bump when consensus rules, quote matching, coverage, holding fit, or report
 * schema change.
 */
export const METHOD_VERSION = "2026.09.1";

/**
 * Openable URL attached to a lookup. Primary = from a voting source or the
 * opinion text we retrieved. Reference = constructed public copy; never a vote.
 */
export type ReferenceLinkKind = "primary" | "reference";

export interface ReferenceLink {
  label: string;
  url: string;
  kind: ReferenceLinkKind;
  origin: "source_hit" | "opinion_text" | "constructed";
}

/** Filing-side claim tied to an authority (from citation extract). */
export type PropositionRole =
  | "supports"
  | "distinguishes"
  | "anticipates_contrary";

export interface Proposition {
  text: string;
  page?: number;
  role: PropositionRole;
}

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

export function tallyConsensus(
  results: Array<{ consensus: Consensus }>,
): Record<Consensus, number> {
  const counts = Object.fromEntries(CONSENSUS_KINDS.map((k) => [k, 0])) as Record<
    Consensus,
    number
  >;
  for (const r of results) counts[r.consensus] += 1;
  return counts;
}


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
  /** Structured form of `coverage` for tooling and exports. */
  envelope?: CoverageEnvelope;
  /** When this source finished answering for this citation. */
  checkedAt?: string;
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

/**
 * How fairly the filing's proposition sits against the opinion's holding.
 * Separate from existence and from verbatim quote support.
 */
export const HOLDING_FITS = [
  "supported",
  "aggressive",
  "overstated",
  "unsupported",
  "unchecked",
] as const;

export type HoldingFit = (typeof HOLDING_FITS)[number];

export interface HoldingPropositionFinding {
  proposition: Proposition;
  fit: HoldingFit;
  /** Short opinion excerpt that drove the score, when available. */
  excerpt?: string;
  suggestedRevision?: string;
  note?: string;
}

export interface HoldingReport {
  overall: HoldingFit;
  findings: HoldingPropositionFinding[];
  auditor: "heuristic" | "llm";
  textSource?: SourceHit["source"];
  textUrl?: string;
  note?: string;
}

export interface LookupResult {
  query: string;
  caseNameGuess: string;
  reporterPin: string | null;
  wlPin: string | null;
  /** Year from a trailing parenthetical in the citation, when present. */
  decisionYear?: string | null;
  /** Court / reporter family label derived from the pin. */
  courtLabel?: string | null;
  sources: SourceHit[];
  consensus: Consensus;
  matchedName: string;
  matchedCitations: string[];
  support: SupportReport;
  /** Holding-use audit, when requested and propositions were available. */
  holding?: HoldingReport;
  /**
   * Openable URLs. Primary links are from voting sources / retrieved opinion
   * text; reference links are constructed and do not affect consensus.
   */
  links?: ReferenceLink[];
  /**
   * Propositions harvested from the filing around this citation (how the
   * pleading uses the authority). Empty for paste-only verifies with no context.
   */
  propositions?: Proposition[];
  /** When both sources finished and the verdict was assigned. */
  checkedAt?: string;
  /** Set only when the lookup itself failed, rather than the citation. */
  error?: string;
}
export interface ControlSpec {
  citation: string;
  expected: Consensus;
}

export interface ControlResult {
  role: "positive" | "negative";
  citation: string;
  expected: Consensus;
  actual: Consensus;
  ok: boolean;
}

export interface ControlRun {
  runAt: string;
  results: ControlResult[];
  /** True when both controls matched their expected verdicts. */
  ok: boolean;
}

export interface VerifyResponse {
  generatedAt: string;
  methodVersion: string;
  methodology: {
    version: string;
    sources: string[];
    reference: string;
    controls: {
      positive: string;
      negative: string;
      expected: { positive: Consensus; negative: Consensus };
    };
  };
  /** Live control-pair results for this run, when they were executed. */
  controlRun?: ControlRun;
  resultCount: number;
  counts: Record<Consensus, number>;
  results: LookupResult[];
}
