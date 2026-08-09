import { lookupCap } from "./cap";
import { lookupCourtListener } from "./courtlistener";
import { namesCompatible } from "./names";
import { guessName, parseReporter, WL_RE } from "./reporters";
import type { Consensus, LookupResult, SourceHit, VerifyResponse } from "./types";

export type { Consensus, LookupResult, SourceHit, VerifyResponse } from "./types";

export const CONTROLS = {
  positive: "Richardson v. McKnight, 521 U.S. 399 (1997)",
  negative: "In re Leman, 66 Cal.App.5th 200",
} as const;

export const EXAMPLES = [
  CONTROLS.positive,
  CONTROLS.negative,
  "Stump v. Sparkman, 435 U.S. 349 (1978)",
  "In re Hudson, 1 Cal.App.4th 1 (2006)",
  "In re Hudson, 143 Cal.App.4th 1 (2006)",
  "Swift v. California, 384 F.3d 1184",
] as const;

function applyConsensus(result: LookupResult): Consensus {
  const cl = result.sources.find((s) => s.source === "courtlistener");
  const cap = result.sources.find((s) => s.source === "case.law_static");
  const foundSources = [cl, cap].filter((s): s is SourceHit => Boolean(s?.found));

  if (!foundSources.length) {
    result.consensus =
      result.wlPin || result.reporterPin ? "NOT_FOUND" : "UNKNOWN";
    return result.consensus;
  }

  let primary = foundSources[0];
  for (const s of foundSources) {
    if (s.caseName && namesCompatible(result.caseNameGuess, s.caseName)) {
      primary = s;
      break;
    }
  }
  result.matchedName = primary.caseName || "";
  result.matchedCitations = primary.citations || [];

  const nameOk =
    Boolean(primary.caseName) &&
    namesCompatible(result.caseNameGuess, primary.caseName || "");
  if (!nameOk && primary.caseName) {
    result.consensus = "CAPTION_MISMATCH";
    return result.consensus;
  }

  result.consensus = foundSources.length >= 2 ? "FOUND" : "PARTIAL";
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

  // Run both working sources from PR #493 in parallel.
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

  const counts: Record<Consensus, number> = {
    FOUND: 0,
    PARTIAL: 0,
    CAPTION_MISMATCH: 0,
    NOT_FOUND: 0,
    UNKNOWN: 0,
  };
  for (const r of results) counts[r.consensus] += 1;

  return {
    generatedAt: new Date().toISOString(),
    methodology: {
      sources: [
        "CourtListener /api/rest/v4/search/",
        "Caselaw Access Project static.case.law (CasesMetadata.json + HTML)",
      ],
      reference:
        "Mechanics from interactive-litigation-portfolio PR #493 (CourtListener + CAP static.case.law)",
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
