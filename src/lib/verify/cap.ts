import { httpGet } from "./http";
import { namesCompatible } from "./names";
import { parseReporter } from "./reporters";
import type { SourceHit } from "./types";

const CAP_STATIC = "https://static.case.law";

type CapCase = {
  first_page?: string | number;
  name?: string;
  name_abbreviation?: string;
  file_name?: string;
  citations?: Array<{ cite?: string }>;
};

type VolumeLoad =
  | { state: "loaded"; cases: CapCase[] }
  /** The volume is not part of CAP's digitized run — past the cutoff, or a
   *  reporter it never carried. Silence from a volume that does not exist
   *  says nothing about the case. */
  | { state: "absent-volume"; status: number }
  | { state: "unavailable"; status: number };

const volumeCache = new Map<string, VolumeLoad>();

/**
 * A volume CAP certainly digitized, used to tell "this volume is not in the
 * corpus" apart from "we could not reach the corpus at all".
 *
 * The distinction needs proving rather than assuming, because the failures
 * are not distinguishable by status code. static.case.law sits behind object
 * storage that answers 403 for a key that does not exist, and a blocked or
 * proxied network answers 403 too. Reading either as "outside CAP's run"
 * would state a confident falsehood about coverage — the very thing this
 * module exists to stop. So before concluding a volume is absent, confirm the
 * canary still loads; if it does not, we were never in a position to look.
 */
const CANARY = { slug: "us", volume: "1" };
let canaryReachable: Promise<boolean> | null = null;

async function fetchVolume(slug: string, volume: string) {
  return httpGet(`${CAP_STATIC}/${slug}/${volume}/CasesMetadata.json`);
}

function parseVolume(body: Buffer): CapCase[] | null {
  const preview = body.subarray(0, 20).toString("utf8");
  if (!preview.includes("[")) return null;
  try {
    return JSON.parse(body.toString("utf8")) as CapCase[];
  } catch {
    return null;
  }
}

function capIsReachable(): Promise<boolean> {
  canaryReachable ??= (async () => {
    const { status, body } = await fetchVolume(CANARY.slug, CANARY.volume);
    return status === 200 && parseVolume(body) !== null;
  })();
  return canaryReachable;
}

async function loadCapVolume(slug: string, volume: string): Promise<VolumeLoad> {
  const key = `${slug}/${volume}`;
  const cached = volumeCache.get(key);
  if (cached) return cached;

  const { status, body } = await fetchVolume(slug, volume);

  let load: VolumeLoad;
  if (status === 200) {
    const cases = parseVolume(body);
    load = cases ? { state: "loaded", cases } : { state: "unavailable", status };
  } else if (status === 404 || status === 403) {
    load = (await capIsReachable())
      ? { state: "absent-volume", status }
      : { state: "unavailable", status };
  } else {
    load = { state: "unavailable", status };
  }

  volumeCache.set(key, load);
  return load;
}

export async function lookupCap(citation: string, nameGuess: string): Promise<SourceHit> {
  const rep = parseReporter(citation);
  if (!rep) {
    return {
      source: "case.law_static",
      outcome: "OUT_OF_SCOPE",
      found: false,
      coverage:
        "CAP static is addressed by reporter volume and page; this citation has no supported reporter pin to resolve.",
    };
  }

  const metaUrl = `${CAP_STATIC}/${rep.slug}/${rep.volume}/CasesMetadata.json`;
  const load = await loadCapVolume(rep.slug, rep.volume);

  if (load.state === "absent-volume") {
    return {
      source: "case.law_static",
      outcome: "OUT_OF_SCOPE",
      found: false,
      url: metaUrl,
      httpStatus: load.status,
      coverage: `CAP has no volume ${rep.volume} of ${rep.label} — outside its digitized run, so it cannot speak to this citation either way.`,
    };
  }

  if (load.state === "unavailable") {
    return {
      source: "case.law_static",
      outcome: "UNAVAILABLE",
      found: false,
      url: metaUrl,
      httpStatus: load.status,
      coverage: `Could not read CAP volume metadata for ${rep.slug}/${rep.volume} (status ${load.status}); this citation was not actually checked against CAP.`,
    };
  }

  const page = String(rep.page);
  const exact = load.cases.filter((c) => String(c.first_page) === page);
  const chosen = exact.length
    ? exact.find((c) => namesCompatible(nameGuess, c.name_abbreviation || c.name || "")) ??
      exact[0]
    : undefined;

  if (!chosen) {
    return {
      source: "case.law_static",
      outcome: "ABSENT",
      found: false,
      url: metaUrl,
      httpStatus: 200,
      coverage: `CAP carries volume ${rep.volume} of ${rep.label}, so this volume was searched in full.`,
      notes: `No case begins at page ${page} in CAP volume ${rep.slug}/${rep.volume}`,
    };
  }

  const cites = (chosen.citations || []).map((x) => x.cite || "").filter(Boolean);
  const fname = chosen.file_name || "";
  const caseUrl = fname
    ? `${CAP_STATIC}/${rep.slug}/${rep.volume}/html/${fname}.html`
    : metaUrl;
  const name = chosen.name_abbreviation || chosen.name || "";
  let notes = "Exact first_page match in CAP CasesMetadata.json";
  if (!namesCompatible(nameGuess, name)) {
    notes += `; caption mismatch vs query name (${JSON.stringify(nameGuess)} vs ${JSON.stringify(name)})`;
  }

  return {
    source: "case.law_static",
    outcome: "FOUND",
    found: true,
    url: caseUrl,
    caseName: name,
    citations: cites,
    coverage: `CAP carries volume ${rep.volume} of ${rep.label}.`,
    notes,
    httpStatus: 200,
  };
}
