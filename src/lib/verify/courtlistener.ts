import { envelopeForReporter } from "./coverage";
import { httpGet } from "./http";
import { namesCompatible, normalizeName } from "./names";
import { parseReporter, WL_RE } from "./reporters";
import type { SourceHit } from "./types";

const CL_SEARCH = "https://www.courtlistener.com/api/rest/v4/search/";

type ClResult = {
  citation?: Array<string | number>;
  caseName?: string;
  absolute_url?: string;
  cluster_id?: number;
  citeCount?: number;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function stamp(hit: Omit<SourceHit, "checkedAt">): SourceHit {
  return { ...hit, checkedAt: new Date().toISOString() };
}

export async function lookupCourtListener(
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
          notes: `Search q=${JSON.stringify(q)}; cite_match=${citeMatch}; wl_match=${wlMatch}; name_match=${nameMatch}; cluster_id=${clusterId ?? "none"}`,
          httpStatus: 200,
        });
        if ((citeMatch || wlMatch) && nameMatch) return hit;
        // Prefer a pin match over a name-only fallback. Notes use JS booleans
        // (`false`), so older checks for `False` never fired and ranking was dead.
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
      notes: `Queries attempted: ${JSON.stringify(tried)}`,
    });
  }

  // A search that ran and came back empty only means something where
  // CourtListener carries the corpus. It carries the reporters this app
  // parses; it indexes Westlaw pins only for opinions it already holds, so a
  // Westlaw-only citation missing here is uninformative.
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
      notes: `No cite/name match in queries ${JSON.stringify(tried)}`,
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
    notes: `No cite/name match in queries ${JSON.stringify(tried)}`,
  });
}
