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

const volumeCache = new Map<string, CapCase[] | null>();

async function loadCapVolume(slug: string, volume: string): Promise<CapCase[] | null> {
  const key = `${slug}/${volume}`;
  if (volumeCache.has(key)) return volumeCache.get(key) ?? null;

  const url = `${CAP_STATIC}/${slug}/${volume}/CasesMetadata.json`;
  const { status, body } = await httpGet(url);
  const preview = body.subarray(0, 20).toString("utf8");
  if (status !== 200 || !preview.includes("[")) {
    volumeCache.set(key, null);
    return null;
  }
  try {
    const data = JSON.parse(body.toString("utf8")) as CapCase[];
    volumeCache.set(key, data);
    return data;
  } catch {
    volumeCache.set(key, null);
    return null;
  }
}

export async function lookupCap(citation: string, nameGuess: string): Promise<SourceHit> {
  const rep = parseReporter(citation);
  if (!rep) {
    return {
      source: "case.law_static",
      found: false,
      notes: "No supported reporter pin to resolve on static.case.law",
    };
  }

  const meta = await loadCapVolume(rep.slug, rep.volume);
  const metaUrl = `${CAP_STATIC}/${rep.slug}/${rep.volume}/CasesMetadata.json`;
  if (meta === null) {
    const { status } = await httpGet(metaUrl);
    return {
      source: "case.law_static",
      found: false,
      url: metaUrl,
      httpStatus: status,
      notes: `Volume metadata unavailable for ${rep.slug}/${rep.volume}`,
    };
  }

  const page = String(rep.page);
  const exact = meta.filter((c) => String(c.first_page) === page);
  let chosen: CapCase | undefined;
  if (exact.length) {
    chosen =
      exact.find((c) =>
        namesCompatible(nameGuess, c.name_abbreviation || c.name || ""),
      ) ?? exact[0];
  }
  if (!chosen) {
    return {
      source: "case.law_static",
      found: false,
      url: metaUrl,
      notes: `No case with first_page=${page} in CAP volume ${rep.slug}/${rep.volume}`,
    };
  }

  const cites = (chosen.citations || [])
    .map((x) => x.cite || "")
    .filter(Boolean);
  const fname = chosen.file_name || "";
  const caseUrl = fname
    ? `${CAP_STATIC}/${rep.slug}/${rep.volume}/html/${fname}.html`
    : metaUrl;
  const name = chosen.name_abbreviation || chosen.name || "";
  const nameOk = namesCompatible(nameGuess, name);
  let notes = "Exact first_page match in CAP CasesMetadata.json";
  if (!nameOk) {
    notes += `; caption mismatch vs query name (${JSON.stringify(nameGuess)} vs ${JSON.stringify(name)})`;
  }

  return {
    source: "case.law_static",
    found: true,
    url: caseUrl,
    caseName: name,
    citations: cites,
    notes,
    httpStatus: 200,
  };
}
