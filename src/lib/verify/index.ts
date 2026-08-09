import { lookupCap } from "./cap";
import { lookupCourtListener } from "./courtlistener";
import { namesCompatible } from "./names";
import { guessName, parseReporter, WL_RE } from "./reporters";
import { CONSENSUS_KINDS } from "./types";
import type { Consensus, LookupResult, VerifyResponse } from "./types";

export { CONSENSUS_KINDS } from "./types";
export type {
  Consensus,
  LookupResult,
  SourceHit,
  SourceOutcome,
  VerifyResponse,
} from "./types";

export const CONTROLS = {
  positive: "Richardson v. McKnight, 521 U.S. 399 (1997)",
  negative: "In re Leman, 66 Cal.App.5th 200",
} as const;

export function tallyConsensus(
  results: Array<Pick<LookupResult, "consensus">>,
): Record<Consensus, number> {
  const counts = Object.fromEntries(
    CONSENSUS_KINDS.map((k) => [k, 0]),
  ) as Record<Consensus, number>;
  for (const r of results) counts[r.consensus] += 1;
  return counts;
}

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

export async function lookupOne(citation: string): Promise<LookupResult> {
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
  };

  // Run both working sources in parallel.
  const [cl, cap] = await Promise.all([
    lookupCourtListener(citation, name),
    lookupCap(citation, name),
  ]);
  result.sources.push(cl, cap);
  applyConsensus(result);
  return result;
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

export async function verifyCitations(raw: string): Promise<VerifyResponse> {
  const cites = parseCitationInput(raw);
  if (!cites.length) {
    throw new Error("Provide at least one citation to verify.");
  }
  if (cites.length > 25) {
    throw new Error("Verify at most 25 citations per request.");
  }

  const results: LookupResult[] = [];
  for (const cite of cites) {
    results.push(await lookupOne(cite));
  }

  const counts = tallyConsensus(results);

  return {
    generatedAt: new Date().toISOString(),
    methodology: {
      sources: [
        "CourtListener /api/rest/v4/search/",
        "Caselaw Access Project static.case.law (CasesMetadata.json + HTML)",
      ],
      reference:
        "Coverage-aware existence probe: CourtListener search + CAP static.case.law. A citation counts as absent only where a source that carries its corpus was able to look and did not find it.",
      controls: {
        positive: CONTROLS.positive,
        negative: CONTROLS.negative,
      },
    },
    resultCount: results.length,
    counts,
    results,
  };
}
