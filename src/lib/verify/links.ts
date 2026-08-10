/**
 * Openable URLs for a verified citation.
 *
 * Primary links come from live source hits (CourtListener / CAP) or the
 * opinion text we actually read. Reference links are constructed from the
 * reporter pin so a reader can open a public copy — they are never votes in
 * consensus.
 */
import { parseReporter, type ReporterPin } from "./reporters";
import type { LookupResult, ReferenceLink } from "./types";

/** Year in a trailing parenthetical, when the paste carries one. */
export function parseDecisionYear(citation: string): string | null {
  const m = citation.match(/\((\d{4})\)\s*\.?$/);
  if (m) return m[1]!;
  const any = citation.match(/\((\d{4})\)/);
  return any?.[1] ?? null;
}

/** Human court/reporter label from a parsed pin. */
export function courtLabelForPin(rep: ReporterPin | null): string | null {
  if (!rep) return null;
  switch (rep.slug) {
    case "us":
    case "s-ct":
    case "l-ed-2d":
      return "U.S. Supreme Court";
    case "f2d":
    case "f3d":
    case "f4th":
      return "U.S. Court of Appeals";
    case "f-supp-2d":
    case "f-supp-3d":
    case "frd":
      return "U.S. District Court";
    case "cal-3d":
    case "cal-4th":
    case "cal-5th":
      return "California Supreme Court";
    case "cal-app-3d":
    case "cal-app-4th":
    case "cal-app-5th":
      return "California Court of Appeal";
    case "mj":
      return "Court of Appeals for the Armed Forces";
    default:
      return rep.label;
  }
}

function pushUnique(out: ReferenceLink[], link: ReferenceLink): void {
  if (out.some((l) => l.url === link.url)) return;
  out.push(link);
}

/** Constructed public URLs from volume/page — reference only. */
export function constructedReferenceLinks(rep: ReporterPin): ReferenceLink[] {
  const { volume, page, slug } = rep;
  const out: ReferenceLink[] = [];

  if (slug === "us") {
    pushUnique(out, {
      label: "Justia (U.S. Reports)",
      url: `https://supreme.justia.com/cases/federal/us/${volume}/${page}/`,
      kind: "reference",
      origin: "constructed",
    });
    // LOC bound volume PDF naming: usrep{vol}{page} with no separators.
    pushUnique(out, {
      label: "Library of Congress (U.S. Reports PDF)",
      url: `https://tile.loc.gov/storage-services/service/ll/usrep/usrep${volume}/usrep${volume}${page}/usrep${volume}${page}.pdf`,
      kind: "reference",
      origin: "constructed",
    });
  }

  if (slug === "cal-3d" || slug === "cal-4th" || slug === "cal-5th") {
    const series = slug.replace("cal-", "");
    pushUnique(out, {
      label: `Justia (Cal. ${series})`,
      url: `https://law.justia.com/cases/california/supreme-court/${series}/${volume}/${page}.html`,
      kind: "reference",
      origin: "constructed",
    });
  }

  if (slug === "cal-app-3d" || slug === "cal-app-4th" || slug === "cal-app-5th") {
    const series = slug.replace("cal-app-", "");
    pushUnique(out, {
      label: `Justia (Cal. App. ${series})`,
      url: `https://law.justia.com/cases/california/court-of-appeal/${series}/${volume}/${page}.html`,
      kind: "reference",
      origin: "constructed",
    });
  }

  if (slug === "f2d" || slug === "f3d" || slug === "f4th") {
    const series = slug === "f2d" ? "F2" : slug === "f3d" ? "F3" : "F4";
    pushUnique(out, {
      label: `Justia (Federal Reporter ${series})`,
      url: `https://law.justia.com/cases/federal/appellate-courts/${series}/${volume}/${page}/`,
      kind: "reference",
      origin: "constructed",
    });
  }

  // Always offer a scholar query on the pin — last-resort open path.
  pushUnique(out, {
    label: "Google Scholar (search)",
    url: `https://scholar.google.com/scholar?q=${encodeURIComponent(rep.pin)}`,
    kind: "reference",
    origin: "constructed",
  });

  return out;
}

/**
 * Build the open-link pack for a lookup result.
 * Prefer live source/opinion URLs; fill gaps with constructed references.
 */
export function buildReferenceLinks(result: LookupResult): ReferenceLink[] {
  const out: ReferenceLink[] = [];

  for (const s of result.sources) {
    if (!s.url) continue;
    if (s.outcome !== "FOUND" && !s.url.includes("courtlistener.com/opinion")) {
      // Keep search endpoints off the "Open" pack — they are not case pages.
      if (s.url.includes("/api/") || s.url.endsWith("/search/")) continue;
    }
    if (s.outcome === "FOUND" && s.url) {
      pushUnique(out, {
        label: s.source === "courtlistener" ? "CourtListener" : "CAP static.case.law",
        url: s.url,
        kind: "primary",
        origin: "source_hit",
      });
    }
  }

  if (result.support?.textUrl) {
    pushUnique(out, {
      label: "Opinion text (retrieved)",
      url: result.support.textUrl,
      kind: "primary",
      origin: "opinion_text",
    });
  }

  const rep =
    (result.reporterPin && parseReporter(result.reporterPin)) ||
    parseReporter(result.query);
  if (rep) {
    for (const link of constructedReferenceLinks(rep)) {
      pushUnique(out, link);
    }
  }

  return out;
}

/** Attach year, court label, and links onto a finished LookupResult. */
export function enrichLookupMetadata(result: LookupResult): LookupResult {
  const rep = parseReporter(result.query);
  result.decisionYear = parseDecisionYear(result.query);
  result.courtLabel = courtLabelForPin(rep);
  result.links = buildReferenceLinks(result);
  return result;
}
