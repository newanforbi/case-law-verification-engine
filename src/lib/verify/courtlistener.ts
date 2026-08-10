import { envelopeForReporter } from "./coverage";
import { httpGet, httpPostForm } from "./http";
import { namesCompatible, normalizeName } from "./names";
import { parseReporter, WL_RE, type ReporterPin } from "./reporters";
import type { SourceHit } from "./types";

const CL_SEARCH = "https://www.courtlistener.com/api/rest/v4/search/";
const CL_CITATION_LOOKUP =
  "https://www.courtlistener.com/api/rest/v4/citation-lookup/";

type ClResult = {
  citation?: Array<string | number>;
  caseName?: string;
  absolute_url?: string;
  cluster_id?: number;
  citeCount?: number;
};

type ClLookupCluster = {
  id?: number;
  absolute_url?: string;
  case_name?: string;
  case_name_full?: string;
  citations?: Array<{
    volume?: string | number;
    reporter?: string;
    page?: string | number;
  }>;
};

export type CitationLookupEntry = {
  citation?: string;
  normalized_citations?: string[];
  status?: number;
  error_message?: string;
  clusters?: ClLookupCluster[];
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function stamp(hit: Omit<SourceHit, "checkedAt">): SourceHit {
  return { ...hit, checkedAt: new Date().toISOString() };
}

function absUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("/") ? `https://www.courtlistener.com${path}` : path;
}

/** Read optional token; never log the value. */
export function courtListenerApiToken(): string | undefined {
  const raw = process.env.COURTLISTENER_API_TOKEN?.trim();
  return raw || undefined;
}

function clusterCitations(cluster: ClLookupCluster): string[] {
  return (cluster.citations ?? [])
    .map((c) => {
      if (c.volume == null || !c.reporter || c.page == null) return "";
      return `${c.volume} ${c.reporter} ${c.page}`;
    })
    .filter(Boolean);
}

function pickCluster(
  clusters: ClLookupCluster[],
  nameGuess: string,
): ClLookupCluster | undefined {
  if (!clusters.length) return undefined;
  const named = clusters.find((c) =>
    namesCompatible(nameGuess, c.case_name || c.case_name_full || ""),
  );
  return named ?? clusters[0];
}

/**
 * Pure mapper from a citation-lookup entry → SourceHit.
 * Returns null when the entry is empty/unusable (caller should fall back).
 */
export function mapCitationLookupEntry(
  entry: CitationLookupEntry,
  opts: {
    nameGuess: string;
    rep: ReporterPin | null;
    httpStatus?: number | null;
  },
): SourceHit | null {
  const status = entry.status;
  if (status == null) return null;

  const rep = opts.rep;
  const baseNotes = `citation-lookup status=${status}` +
    (entry.citation ? `; citation=${JSON.stringify(entry.citation)}` : "") +
    (entry.error_message ? `; ${entry.error_message}` : "");

  if (status === 200 || status === 300) {
    const clusters = entry.clusters ?? [];
    const cluster = pickCluster(clusters, opts.nameGuess);
    if (!cluster) {
      return stamp({
        source: "courtlistener",
        outcome: "ABSENT",
        found: false,
        url: CL_CITATION_LOOKUP,
        httpStatus: opts.httpStatus ?? 200,
        coverage:
          "Citation-lookup accepted the pin but returned no opinion clusters.",
        envelope: envelopeForReporter(rep, {
          inCorpus: true,
          reason: "searched_empty",
        }),
        notes: baseNotes,
      });
    }
    const name = cluster.case_name || cluster.case_name_full || "";
    const nameMatch = namesCompatible(opts.nameGuess, name);
    const cites = clusterCitations(cluster);
    const clusterId =
      typeof cluster.id === "number" && Number.isFinite(cluster.id)
        ? cluster.id
        : undefined;
    const ambiguous = status === 300 || clusters.length > 1;
    return stamp({
      source: "courtlistener",
      outcome: "FOUND",
      found: true,
      url: absUrl(cluster.absolute_url),
      caseName: name,
      citations: cites.length
        ? cites
        : entry.normalized_citations ?? (entry.citation ? [entry.citation] : []),
      clusterId,
      coverage: ambiguous
        ? "CourtListener citation-lookup matched more than one cluster for this pin."
        : "CourtListener citation-lookup resolved this pin.",
      envelope: envelopeForReporter(rep, {
        inCorpus: true,
        reason: "carried",
      }),
      notes:
        `${baseNotes}; via=citation-lookup; name_match=${nameMatch}` +
        (ambiguous ? `; clusters=${clusters.length}` : "") +
        (clusterId != null ? `; cluster_id=${clusterId}` : ""),
      httpStatus: opts.httpStatus ?? 200,
    });
  }

  if (status === 404) {
    return stamp({
      source: "courtlistener",
      outcome: "ABSENT",
      found: false,
      url: CL_CITATION_LOOKUP,
      httpStatus: opts.httpStatus ?? 200,
      coverage: rep
        ? `CourtListener citation-lookup carries this reporter family and did not find ${rep.pin}.`
        : "CourtListener citation-lookup did not find this citation.",
      envelope: envelopeForReporter(rep, {
        inCorpus: true,
        reason: "searched_empty",
      }),
      notes: `${baseNotes}; via=citation-lookup`,
    });
  }

  if (status === 400) {
    return stamp({
      source: "courtlistener",
      outcome: "OUT_OF_SCOPE",
      found: false,
      url: CL_CITATION_LOOKUP,
      httpStatus: opts.httpStatus ?? 200,
      coverage:
        "Citation-lookup could not parse a known reporter from this string.",
      envelope: envelopeForReporter(rep, {
        inCorpus: null,
        reason: "no_pin",
      }),
      notes: `${baseNotes}; via=citation-lookup`,
    });
  }

  if (status === 429) {
    return stamp({
      source: "courtlistener",
      outcome: "UNAVAILABLE",
      found: false,
      url: CL_CITATION_LOOKUP,
      httpStatus: 429,
      coverage:
        "CourtListener citation-lookup throttle hit; this citation was not checked via lookup.",
      envelope: envelopeForReporter(rep, {
        inCorpus: null,
        reason: "unreachable",
      }),
      notes: `${baseNotes}; via=citation-lookup`,
    });
  }

  return null;
}

async function lookupViaCitationLookup(
  citation: string,
  nameGuess: string,
  rep: ReporterPin | null,
  token: string,
): Promise<SourceHit | null> {
  const fields: Record<string, string> = rep
    ? { volume: rep.volume, reporter: rep.label, page: rep.page }
    : { text: citation };

  const { status, body } = await httpPostForm(CL_CITATION_LOOKUP, fields, {
    authorization: `Token ${token}`,
    timeoutMs: 30_000,
    retries: 2,
  });

  if (status === 401 || status === 403) {
    // Bad/expired token — fall back to anonymous search.
    return null;
  }
  if (status === 429) {
    return stamp({
      source: "courtlistener",
      outcome: "UNAVAILABLE",
      found: false,
      url: CL_CITATION_LOOKUP,
      httpStatus: 429,
      coverage:
        "CourtListener citation-lookup rate limit; try again shortly or rely on CAP.",
      envelope: envelopeForReporter(rep, {
        inCorpus: null,
        reason: "unreachable",
      }),
      notes: "via=citation-lookup; HTTP 429",
    });
  }
  if (status !== 200) {
    return null;
  }

  let entries: CitationLookupEntry[];
  try {
    const parsed = JSON.parse(body.toString("utf8")) as unknown;
    if (!Array.isArray(parsed)) return null;
    entries = parsed as CitationLookupEntry[];
  } catch {
    return null;
  }

  if (!entries.length) {
    // Nothing Eyecite could parse — let search try (e.g. odd WL forms).
    return null;
  }

  // Prefer an entry whose citation matches our reporter pin when several exist.
  let entry = entries[0]!;
  if (rep && entries.length > 1) {
    const target = normalizeName(rep.pin);
    const matched = entries.find((e) => {
      const candidates = [
        e.citation,
        ...(e.normalized_citations ?? []),
      ].filter(Boolean) as string[];
      return candidates.some((c) => {
        const nc = normalizeName(c);
        return nc === target || nc.includes(target) || target.includes(nc);
      });
    });
    if (matched) entry = matched;
  }

  return mapCitationLookupEntry(entry, {
    nameGuess,
    rep,
    httpStatus: status,
  });
}

async function lookupViaSearch(
  citation: string,
  nameGuess: string,
): Promise<SourceHit> {
  const rep = parseReporter(citation);
  const wl = citation.match(WL_RE);
  const queries: string[] = [];

  if (rep) {
    queries.push(`"${rep.pin}"`);
    const compact = rep.pin.replace(/Cal\. App\./g, "Cal.App.").replace(/F\. /g, "F.");
    if (compact !== rep.pin) queries.push(`"${compact}"`);
  }
  if (wl) {
    queries.push(wl[1]);
    queries.push(`WL ${wl[1]}`);
  }
  if (nameGuess && rep && !wl) {
    queries.push(`"${nameGuess}"`);
  }

  let best: SourceHit | null = null;
  let lastStatus: number | null = null;
  let anySearchSucceeded = false;
  const tried: string[] = [];

  for (const q of queries) {
    const url = `${CL_SEARCH}?${new URLSearchParams({ type: "o", q })}`;
    const { status, body } = await httpGet(url);
    lastStatus = status;
    tried.push(q);
    if (status !== 200) {
      await sleep(250);
      continue;
    }

    let data: { results?: ClResult[] };
    try {
      data = JSON.parse(body.toString("utf8")) as { results?: ClResult[] };
    } catch {
      await sleep(250);
      continue;
    }
    anySearchSucceeded = true;

    const results = data.results || [];
    for (const r of results) {
      const cites = (r.citation || []).map(String);
      const name = r.caseName || "";
      const abs = r.absolute_url || "";
      const fullUrl = abs.startsWith("/")
        ? `https://www.courtlistener.com${abs}`
        : abs;

      let citeMatch = false;
      if (rep) {
        const target = normalizeName(rep.pin);
        citeMatch = cites.some((c) => {
          const nc = normalizeName(c);
          return nc === target || nc.includes(target);
        });
      }

      let wlMatch = false;
      if (wl) {
        const pin = wl[1];
        const yearM = citation.match(/\b((?:19|20)\d{2})\b/);
        if (yearM) {
          const full = `${yearM[1]} WL ${pin}`;
          wlMatch = cites.some((c) => c.toLowerCase().includes(full.toLowerCase()));
        } else {
          const wlRx = new RegExp(`(?:^|[^0-9])(?:WL\\s*)?${pin}(?:[^0-9]|$)`, "i");
          wlMatch = cites.some((c) => wlRx.test(c) && c.toUpperCase().includes("WL"));
        }
      }

      const nameMatch = namesCompatible(nameGuess, name);
      let accept = false;
      if (rep && citeMatch) accept = true;
      else if (wl && !rep && wlMatch) accept = true;
      else if (!rep && !wl && nameMatch) accept = true;

      if (accept) {
        const clusterId =
          typeof r.cluster_id === "number" && Number.isFinite(r.cluster_id)
            ? r.cluster_id
            : undefined;
        const citeCount =
          typeof r.citeCount === "number" && Number.isFinite(r.citeCount)
            ? r.citeCount
            : undefined;
        const hit = stamp({
          source: "courtlistener",
          outcome: "FOUND",
          found: true,
          url: fullUrl,
          caseName: name,
          citations: cites,
          clusterId,
          citeCount,
          coverage: "CourtListener returned an opinion matching this pin.",
          envelope: envelopeForReporter(rep, {
            inCorpus: true,
            reason: "carried",
          }),
          notes: `Search q=${JSON.stringify(q)}; cite_match=${citeMatch}; wl_match=${wlMatch}; name_match=${nameMatch}; cluster_id=${clusterId ?? "none"}; via=search`,
          httpStatus: 200,
        });
        if ((citeMatch || wlMatch) && nameMatch) return hit;
        if (
          !best ||
          ((citeMatch || wlMatch) &&
            (best.notes || "").includes("cite_match=false") &&
            (best.notes || "").includes("wl_match=false"))
        ) {
          best = hit;
        }
      }
    }
    await sleep(550);
  }

  if (best) return best;

  if (!tried.length) {
    return stamp({
      source: "courtlistener",
      outcome: "OUT_OF_SCOPE",
      found: false,
      coverage:
        "Nothing queryable in this citation — no reporter pin, Westlaw pin, or caption to search on.",
      envelope: envelopeForReporter(rep, {
        inCorpus: null,
        reason: "no_pin",
      }),
    });
  }

  if (!anySearchSucceeded) {
    return stamp({
      source: "courtlistener",
      outcome: "UNAVAILABLE",
      found: false,
      url: CL_SEARCH,
      httpStatus: lastStatus,
      coverage: `No CourtListener search completed (last status ${lastStatus}); this citation was not actually checked against it.`,
      envelope: envelopeForReporter(rep, {
        inCorpus: null,
        reason: "unreachable",
      }),
      notes: `Queries attempted: ${JSON.stringify(tried)}; via=search`,
    });
  }

  if (rep) {
    return stamp({
      source: "courtlistener",
      outcome: "ABSENT",
      found: false,
      url: CL_SEARCH,
      httpStatus: 200,
      coverage: `CourtListener carries ${rep.label}, and a search for this pin returned no matching opinion.`,
      envelope: envelopeForReporter(rep, {
        inCorpus: true,
        reason: "searched_empty",
      }),
      notes: `No cite/name match in queries ${JSON.stringify(tried)}; via=search`,
    });
  }

  return stamp({
    source: "courtlistener",
    outcome: "OUT_OF_SCOPE",
    found: false,
    url: CL_SEARCH,
    httpStatus: 200,
    coverage:
      "CourtListener indexes Westlaw numbers only for opinions already in its corpus, so an unpublished Westlaw-only citation missing here is not evidence of anything.",
    envelope: envelopeForReporter(null, {
      inCorpus: false,
      reason: "westlaw_only",
    }),
    notes: `No cite/name match in queries ${JSON.stringify(tried)}; via=search`,
  });
}

/**
 * CourtListener existence probe.
 *
 * When COURTLISTENER_API_TOKEN is set, prefer POST citation-lookup (Eyecite).
 * Otherwise — or on auth/parse failure — fall back to unauthenticated /search/.
 */
export async function lookupCourtListener(
  citation: string,
  nameGuess: string,
): Promise<SourceHit> {
  const rep = parseReporter(citation);
  const token = courtListenerApiToken();

  if (token && (rep || WL_RE.test(citation))) {
    const looked = await lookupViaCitationLookup(
      citation,
      nameGuess,
      rep,
      token,
    );
    if (looked) {
      await sleep(250);
      return looked;
    }
  }

  return lookupViaSearch(citation, nameGuess);
}
