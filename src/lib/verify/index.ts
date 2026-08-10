import { lookupCap } from "./cap";
import { lookupCourtListener } from "./courtlistener";
import { evaluateHoldingUse } from "./holding";
import { enrichLookupMetadata } from "./links";
import { namesCompatible } from "./names";
import { fetchOpinionText, type OpinionText } from "./opinion";
import {
  extractQuotedPassages,
  matchPassage,
  pageLabelsIn,
  parsePinCite,
} from "./quotes";
import { guessName, parseReporter, WL_RE } from "./reporters";
import { METHOD_VERSION, tallyConsensus } from "./types";
import type {
  Consensus,
  ControlRun,
  LookupResult,
  PinFinding,
  Proposition,
  Support,
  SupportReport,
  VerifyResponse,
} from "./types";

export { CONSENSUS_KINDS, HOLDING_FITS, METHOD_VERSION, SUPPORT_KINDS, tallyConsensus } from "./types";
export type {
  Consensus,
  ControlResult,
  ControlRun,
  CoverageEnvelope,
  HoldingFit,
  HoldingPropositionFinding,
  HoldingReport,
  LookupResult,
  PinFinding,
  Proposition,
  PropositionRole,
  QuoteFinding,
  QuoteMatch,
  ReferenceLink,
  SourceHit,
  SourceOutcome,
  Support,
  SupportReport,
  VerifyResponse,
} from "./types";
export {
  buildReferenceLinks,
  constructedReferenceLinks,
  courtLabelForPin,
  parseDecisionYear,
} from "./links";
export { evaluateHoldingUse } from "./holding";

export const CONTROLS = {
  positive: "Richardson v. McKnight, 521 U.S. 399 (1997)",
  negative: "In re Leman, 66 Cal.App.5th 200",
} as const;

export const CONTROL_EXPECTATIONS = {
  positive: "FOUND" as const satisfies Consensus,
  negative: "NOT_FOUND" as const satisfies Consensus,
};

export const EXAMPLES = [
  CONTROLS.positive,
  CONTROLS.negative,
  "Stump v. Sparkman, 435 U.S. 349 (1978)",
  "In re Hudson, 1 Cal.App.4th 1 (2006)",
  "In re Hudson, 143 Cal.App.4th 1 (2006)",
  "Swift v. California, 384 F.3d 1184",
] as const;

/**
 * Read the sources' outcomes into a verdict.
 *
 * The rule this deliberately does not follow is counting. Counting hits makes
 * the verdict a function of how many corpora happen to overlap a citation
 * rather than of what was actually established, which punishes recent
 * authority — anything past the end of CAP's digitized run can only ever be
 * half-confirmed — and, worse, turns "no source covers this" into the same
 * answer as "a source that covers this says it does not exist".
 *
 * So a single source that carries the corpus is enough to confirm, PARTIAL is
 * reserved for genuine disagreement between two sources that both cover the
 * citation, and absence only counts when something was in a position to see it.
 */
export function applyConsensus(result: LookupResult): Consensus {
  const found = result.sources.filter((s) => s.outcome === "FOUND");
  const absent = result.sources.filter((s) => s.outcome === "ABSENT");
  const unavailable = result.sources.filter((s) => s.outcome === "UNAVAILABLE");

  if (found.length) {
    const primary =
      found.find(
        (s) => s.caseName && namesCompatible(result.caseNameGuess, s.caseName),
      ) ?? found[0];
    result.matchedName = primary.caseName || "";
    result.matchedCitations = primary.citations || [];

    const nameOk =
      Boolean(primary.caseName) &&
      namesCompatible(result.caseNameGuess, primary.caseName || "");
    if (!nameOk && primary.caseName) {
      result.consensus = "CAPTION_MISMATCH";
      return result.consensus;
    }

    // One source has it and another that carries the same corpus does not:
    // that is a real conflict, and the only thing PARTIAL should mean.
    result.consensus = absent.length ? "PARTIAL" : "FOUND";
    return result.consensus;
  }

  if (!result.reporterPin && !result.wlPin) {
    result.consensus = "UNKNOWN";
    return result.consensus;
  }
  if (absent.length) {
    result.consensus = "NOT_FOUND";
    return result.consensus;
  }
  if (unavailable.length) {
    result.consensus = "UNCHECKED";
    return result.consensus;
  }
  result.consensus = "OUT_OF_COVERAGE";
  return result.consensus;
}

/**
 * Check the quoted language and pin page against the opinion's own words.
 *
 * Only reachable once a source has resolved the case, since there is nothing
 * to read otherwise, and it will not report a quote missing from text it could
 * not retrieve — the same rule the existence probe follows about absence.
 */
function evaluateSupportWithOpinion(
  citation: string,
  extraPassages: string[],
  opinion: OpinionText | null,
): SupportReport {
  const fromCite = extractQuotedPassages(citation);
  const seen = new Set(fromCite.map((p) => p.toLowerCase()));
  const passages = [...fromCite];
  for (const p of extraPassages) {
    const key = p.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    passages.push(p.trim());
  }
  const rep = parseReporter(citation);
  const pinCite = rep ? parsePinCite(citation, rep.page) : null;

  if (!passages.length && !pinCite) {
    return { verdict: "NO_QUOTE", quotes: [], pin: null };
  }

  if (!opinion) {
    return {
      verdict: "UNCHECKED",
      quotes: passages.map((passage) => ({
        passage,
        match: "INDETERMINATE" as const,
      })),
      pin: pinCite ? { page: pinCite.pinPage, present: null } : null,
    };
  }

  const quotes = passages.map((passage) => matchPassage(passage, opinion.text));

  let pin: PinFinding | null = null;
  if (pinCite) {
    const labels = pageLabelsIn(opinion.text);
    // No markers at all means the pagination is invisible to us, not that the
    // page is missing from the opinion.
    pin = {
      page: pinCite.pinPage,
      present: labels.size ? labels.has(pinCite.pinPage) : null,
    };
  }

  let verdict: Support;
  if (quotes.some((q) => q.match === "ABSENT")) verdict = "UNSUPPORTED";
  else if (quotes.some((q) => q.match === "ALTERED") || pin?.present === false)
    verdict = "QUALIFIED";
  else if (quotes.length && quotes.every((q) => q.match === "INDETERMINATE"))
    verdict = "INDETERMINATE";
  else verdict = "SUPPORTED";

  return {
    verdict,
    quotes,
    pin,
    textSource: opinion.source,
    textUrl: opinion.url,
  };
}

/**
 * lookupOne, with anything it throws turned into a result rather than an
 * exception.
 *
 * A batch runs many of these, and one citation that trips an unforeseen edge
 * — a malformed pin, a source returning something unparseable — must not cost
 * the caller every other answer in the batch. The failure is reported as
 * UNCHECKED, which is what it is: nothing was established about this citation.
 */
export interface VerifyRequestItem {
  citation: string;
  /** Quoted passages from the filing to check against the opinion. */
  passages?: string[];
  /** Filing propositions harvested near this authority (for holding audit). */
  propositions?: Proposition[];
}

function methodologyBlock(): VerifyResponse["methodology"] {
  return {
    version: METHOD_VERSION,
    sources: [
      "CourtListener /api/rest/v4/search/",
      "Caselaw Access Project static.case.law (CasesMetadata.json + HTML)",
    ],
    reference:
      "Coverage-aware existence probe plus quote checking: CourtListener search + CAP static.case.law. A citation counts as absent only where a source that carries its corpus was able to look and did not find it. Where the filing quotes an opinion, we check what the opinion says — not whether it supports the argument. Optional holding-use audit scores harvested filing propositions against opinion text (heuristic overlap; HOLDING_AUDITOR=heuristic|llm) and never changes existence verdicts. Open links marked primary come from voting sources (or retrieved opinion text); constructed Justia / LOC / Scholar links are references only.",
    controls: {
      positive: CONTROLS.positive,
      negative: CONTROLS.negative,
      expected: {
        positive: CONTROL_EXPECTATIONS.positive,
        negative: CONTROL_EXPECTATIONS.negative,
      },
    },
  };
}

/** Run the method's positive/negative controls and record pass/fail. */
export async function runMethodControls(): Promise<ControlRun> {
  const [positive, negative] = await Promise.all([
    lookupOneSafe(CONTROLS.positive),
    lookupOneSafe(CONTROLS.negative),
  ]);
  const results = [
    {
      role: "positive" as const,
      citation: CONTROLS.positive,
      expected: CONTROL_EXPECTATIONS.positive,
      actual: positive.consensus,
      ok: positive.consensus === CONTROL_EXPECTATIONS.positive,
    },
    {
      role: "negative" as const,
      citation: CONTROLS.negative,
      expected: CONTROL_EXPECTATIONS.negative,
      actual: negative.consensus,
      ok: negative.consensus === CONTROL_EXPECTATIONS.negative,
    },
  ];
  return {
    runAt: new Date().toISOString(),
    results,
    ok: results.every((r) => r.ok),
  };
}

export interface LookupOptions {
  /** When true, score harvested propositions against opinion text. */
  holdingAudit?: boolean;
}

export async function lookupOneSafe(
  citation: string,
  passages: string[] = [],
  propositions: Proposition[] = [],
  options: LookupOptions = {},
): Promise<LookupResult> {
  try {
    return await lookupOne(citation, passages, propositions, options);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const rep = parseReporter(citation);
    return enrichLookupMetadata({
      query: citation,
      caseNameGuess: guessName(citation),
      reporterPin: rep?.pin ?? null,
      wlPin: citation.match(WL_RE)?.[1] ?? null,
      sources: [],
      consensus: "UNCHECKED",
      matchedName: "",
      matchedCitations: [],
      support: { verdict: "UNCHECKED", quotes: [], pin: null },
      propositions,
      checkedAt: new Date().toISOString(),
      error: `Lookup failed for this citation: ${reason}`,
    });
  }
}

export async function lookupOne(
  citation: string,
  passages: string[] = [],
  propositions: Proposition[] = [],
  options: LookupOptions = {},
): Promise<LookupResult> {
  const name = guessName(citation);
  const rep = parseReporter(citation);
  const wlM = citation.match(WL_RE);
  const result: LookupResult = {
    query: citation,
    caseNameGuess: name,
    reporterPin: rep?.pin ?? null,
    wlPin: wlM?.[1] ?? null,
    sources: [],
    consensus: "UNKNOWN",
    matchedName: "",
    matchedCitations: [],
    support: { verdict: "NO_QUOTE", quotes: [], pin: null },
    propositions,
  };

  // Run both working sources in parallel.
  const [cl, cap] = await Promise.all([
    lookupCourtListener(citation, name),
    lookupCap(citation, name),
  ]);
  result.sources.push(cl, cap);
  applyConsensus(result);

  const wantHolding = options.holdingAudit === true && propositions.length > 0;
  const needOpinion =
    wantHolding ||
    passages.length > 0 ||
    extractQuotedPassages(citation).length > 0 ||
    Boolean(rep && parsePinCite(citation, rep.page));

  let opinion: OpinionText | null = null;
  if (
    needOpinion &&
    (result.consensus === "FOUND" ||
      result.consensus === "PARTIAL" ||
      result.consensus === "CAPTION_MISMATCH")
  ) {
    const found = result.sources.filter((s) => s.outcome === "FOUND");
    opinion = await fetchOpinionText({
      capUrl: found.find((s) => s.source === "case.law_static")?.url,
      courtListenerUrl: found.find((s) => s.source === "courtlistener")?.url,
    });
  }

  result.support = evaluateSupportWithOpinion(citation, passages, opinion);

  if (wantHolding) {
    result.holding = evaluateHoldingUse({
      propositions,
      opinionText: opinion?.text,
      consensus: result.consensus,
      textUrl: opinion?.url ?? result.support.textUrl,
      textSource: opinion?.source ?? result.support.textSource,
    });
  }

  result.checkedAt = new Date().toISOString();
  return enrichLookupMetadata(result);
}

export function parseCitationInput(raw: string): string[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    // allow numbered / bulleted pastes
    .map((l) => l.replace(/^[-*•]\s+/, "").replace(/^\d+[.)]\s+/, ""));

  // Also accept semicolon-separated single-line batches
  const expanded: string[] = [];
  for (const line of lines) {
    if (line.includes(";") && !/,.*,/.test(line)) {
      expanded.push(...line.split(";").map((s) => s.trim()).filter(Boolean));
    } else {
      expanded.push(line);
    }
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of expanded) {
    if (!seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

export async function verifyCitationItems(
  items: VerifyRequestItem[],
  options: { includeControlRun?: boolean; holdingAudit?: boolean } = {},
): Promise<VerifyResponse> {
  if (!items.length) {
    throw new Error("Provide at least one citation to verify.");
  }
  if (items.length > 25) {
    throw new Error("Verify at most 25 citations per request.");
  }

  // Off by default: clients that batch lookups would otherwise re-run the
  // control pair on every slice. Ask once per session when stamping a report.
  const includeControlRun = options.includeControlRun === true;
  const holdingAudit = options.holdingAudit === true;
  const controlPromise = includeControlRun ? runMethodControls() : null;

  const results: LookupResult[] = [];
  for (const item of items) {
    const citation = item.citation.trim();
    if (!citation) continue;
    results.push(
      await lookupOneSafe(
        citation,
        item.passages ?? [],
        item.propositions ?? [],
        { holdingAudit },
      ),
    );
  }

  if (!results.length) {
    throw new Error("Provide at least one citation to verify.");
  }

  const counts = tallyConsensus(results);
  const controlRun = controlPromise ? await controlPromise : undefined;

  return {
    generatedAt: new Date().toISOString(),
    methodVersion: METHOD_VERSION,
    methodology: methodologyBlock(),
    controlRun,
    resultCount: results.length,
    counts,
    results,
  };
}

export async function verifyCitations(
  raw: string,
  options: { includeControlRun?: boolean; holdingAudit?: boolean } = {},
): Promise<VerifyResponse> {
  const cites = parseCitationInput(raw);
  return verifyCitationItems(
    cites.map((citation) => ({ citation })),
    options,
  );
}
