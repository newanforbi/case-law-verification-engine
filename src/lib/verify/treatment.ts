/**
 * Subsequent-treatment sketch + contrary clusters (free sources only).
 *
 * Uses CourtListener search `cites:(cluster_id)` — not Shepard's / KeyCite,
 * not auth-gated `/opinions-cited/`. Never changes existence consensus.
 */
import { httpGet } from "./http";
import type {
  Consensus,
  ContraryCluster,
  LookupResult,
  TreatmentCite,
  TreatmentReport,
  TreatmentStatus,
} from "./types";

const CL_SEARCH = "https://www.courtlistener.com/api/rest/v4/search/";

/** Noisy cues — keyword heuristic only, not a treatment code. */
export const NEGATIVE_LANGUAGE_RE =
  /\b(?:overrul(?:e[ds]?|ing)?|abrogat(?:e[ds]?|ing)?|disapprov(?:e[ds]?|ing)?|no\s+longer\s+good\s+law|not\s+good\s+law|superseded|repudiat(?:e[ds]?|ing)?)\b/i;

const SAMPLE_LIMIT = 8;

type ClSearchHit = {
  caseName?: string;
  dateFiled?: string | null;
  court?: string | null;
  absolute_url?: string;
  cluster_id?: number;
  syllabus?: string | null;
  procedural_history?: string | null;
  citeCount?: number;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function absUrl(path: string | undefined): string {
  if (!path) return CL_SEARCH;
  return path.startsWith("/") ? `https://www.courtlistener.com${path}` : path;
}

export function hasNegativeLanguage(...parts: Array<string | null | undefined>): boolean {
  return parts.some((p) => Boolean(p && NEGATIVE_LANGUAGE_RE.test(p)));
}

export function toTreatmentCite(hit: ClSearchHit): TreatmentCite {
  const blob = [hit.caseName, hit.syllabus, hit.procedural_history]
    .filter(Boolean)
    .join(" ");
  return {
    caseName: hit.caseName || "Untitled opinion",
    dateFiled: hit.dateFiled ?? null,
    court: hit.court ?? null,
    url: absUrl(hit.absolute_url),
    clusterId: typeof hit.cluster_id === "number" ? hit.cluster_id : undefined,
    negativeLanguage: hasNegativeLanguage(blob),
  };
}

/** Pure: shape a TreatmentReport from already-fetched citing hits. */
export function buildTreatmentReport(input: {
  consensus: Consensus;
  clusterId?: number;
  citeCount?: number;
  samples?: TreatmentCite[];
  fetchError?: string;
  clOutcome?: string;
}): TreatmentReport {
  const {
    consensus,
    clusterId,
    citeCount,
    samples = [],
    fetchError,
    clOutcome,
  } = input;

  if (
    consensus !== "FOUND" &&
    consensus !== "PARTIAL" &&
    consensus !== "CAPTION_MISMATCH"
  ) {
    return {
      status: "skipped",
      samples: [],
      negativeLanguageSamples: [],
      note: `Subsequent cites were not probed because existence was ${consensus}.`,
    };
  }

  if (clOutcome === "UNAVAILABLE") {
    return {
      status: "unchecked",
      samples: [],
      negativeLanguageSamples: [],
      note: "CourtListener search was unreachable, so subsequent cites were not checked.",
    };
  }

  if (!clusterId) {
    return {
      status: "out_of_coverage",
      samples: [],
      negativeLanguageSamples: [],
      note:
        "No CourtListener cluster id was available for this hit — cannot run a free cites: search. This is not Shepard's/KeyCite coverage.",
    };
  }

  if (fetchError) {
    return {
      status: "unchecked",
      clusterId,
      citingCount: citeCount,
      samples: [],
      negativeLanguageSamples: [],
      note: fetchError,
    };
  }

  const negativeLanguageSamples = samples.filter((s) => s.negativeLanguage);
  return {
    status: "ok",
    clusterId,
    citingCount: citeCount,
    samples,
    negativeLanguageSamples,
    note:
      "CourtListener search cites:(cluster) sample — keyword negatives are heuristics, not treatment codes. Not Shepard's or KeyCite.",
  };
}

/**
 * Filing-grounded contrary clusters from harvested anticipates_contrary props.
 * Pure — safe for offline tests and client recompute across batches.
 */
export function buildContraryClusters(
  results: LookupResult[],
): ContraryCluster[] {
  const out: ContraryCluster[] = [];
  for (const r of results) {
    const props = (r.propositions ?? []).filter(
      (p) => p.role === "anticipates_contrary",
    );
    if (!props.length) continue;
    out.push({
      citation: r.query,
      matchedName: r.matchedName || r.caseNameGuess,
      propositions: props,
      existence: r.consensus,
      treatmentStatus: r.treatment?.status,
      negativeLanguageSampleCount:
        r.treatment?.negativeLanguageSamples?.length ?? 0,
      citingCount: r.treatment?.citingCount,
    });
  }
  return out;
}

export async function fetchCitingSamples(
  clusterId: number,
  limit = SAMPLE_LIMIT,
): Promise<{
  samples: TreatmentCite[];
  count?: number;
  error?: string;
}> {
  const params = new URLSearchParams({
    type: "o",
    q: `cites:(${clusterId})`,
    page_size: String(Math.min(Math.max(limit, 1), 20)),
  });
  const url = `${CL_SEARCH}?${params}`;
  const { status, body } = await httpGet(url, {
    accept: "application/json",
    timeoutMs: 30_000,
    retries: 2,
  });
  if (status !== 200) {
    return {
      samples: [],
      error: `CourtListener cites: search returned HTTP ${status}.`,
    };
  }
  let data: { count?: number; results?: ClSearchHit[] };
  try {
    data = JSON.parse(body.toString("utf8")) as {
      count?: number;
      results?: ClSearchHit[];
    };
  } catch {
    return { samples: [], error: "CourtListener cites: response was not JSON." };
  }
  const samples = (data.results ?? []).slice(0, limit).map(toTreatmentCite);
  await sleep(400);
  return { samples, count: data.count };
}

/**
 * Attach a subsequent-cite sketch when we have a CL cluster id.
 */
export async function evaluateTreatment(input: {
  consensus: Consensus;
  clusterId?: number;
  citeCount?: number;
  clOutcome?: string;
}): Promise<TreatmentReport> {
  if (
    input.consensus !== "FOUND" &&
    input.consensus !== "PARTIAL" &&
    input.consensus !== "CAPTION_MISMATCH"
  ) {
    return buildTreatmentReport(input);
  }
  if (!input.clusterId) {
    return buildTreatmentReport(input);
  }
  if (input.clOutcome === "UNAVAILABLE") {
    return buildTreatmentReport(input);
  }

  const fetched = await fetchCitingSamples(input.clusterId);
  return buildTreatmentReport({
    ...input,
    samples: fetched.samples,
    // Prefer the cluster's own citeCount; fall back to search hit count.
    citeCount: input.citeCount ?? fetched.count,
    fetchError: fetched.error,
  });
}

export function treatmentStatusLabel(status: TreatmentStatus): string {
  switch (status) {
    case "ok":
      return "Subsequent cites";
    case "unchecked":
      return "Cites unchecked";
    case "out_of_coverage":
      return "No cite graph";
    case "skipped":
      return "Cites skipped";
    default:
      return status;
  }
}
