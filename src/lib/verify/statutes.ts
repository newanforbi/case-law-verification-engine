/**
 * Statute probes: free USC (LII) and California codes (LegInfo).
 *
 * Parallel to case-law existence — never feeds CourtListener/CAP consensus.
 * A hit means the free code host serves that section; it does not prove the
 * filing's use of the statute is correct.
 */
import { httpGet } from "./http";
import type {
  Consensus,
  ReferenceLink,
  SourceOutcome,
  StatuteKind,
  StatuteLookupResult,
  StatuteParsed,
  StatuteSourceHit,
} from "./types";

const LII_BASE = "https://www.law.cornell.edu/uscode/text";
const LEGINFO_SECTION =
  "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml";

/**
 * Map extract strings → LegInfo lawCode abbreviations.
 * Trailing `\b` after `Pen.` fails (`.` is non-word), so use a lookahead.
 */
const AFTER_CODE = /(?=[\s§,]|$)/;
const LAW_CODE_PATTERNS: Array<{ re: RegExp; lawCode: string; label: string }> = [
  {
    re: new RegExp(
      String.raw`\b(?:Code\s+of\s+Civil\s+Procedure|Civ\.?\s*Proc\.?|C\.?\s*C\.?\s*P\.?|CCP)` +
        AFTER_CODE.source,
      "i",
    ),
    lawCode: "CCP",
    label: "Code of Civil Procedure",
  },
  {
    re: new RegExp(
      String.raw`\b(?:Welfare\s+(?:and|&)\s+Institutions|W(?:elf)?\.?\s*&\s*I\.?)` +
        AFTER_CODE.source,
      "i",
    ),
    lawCode: "WIC",
    label: "Welfare & Institutions Code",
  },
  {
    re: new RegExp(
      String.raw`\b(?:Health\s+(?:and|&)\s+Safety|H(?:ealth)?\.?\s*&\s*S(?:afety)?\.?)` +
        AFTER_CODE.source,
      "i",
    ),
    lawCode: "HSC",
    label: "Health & Safety Code",
  },
  {
    re: new RegExp(
      String.raw`\b(?:Business\s+(?:and|&)\s+Professions|B(?:us)?\.?\s*&\s*P(?:rof)?\.?)` +
        AFTER_CODE.source,
      "i",
    ),
    lawCode: "BPC",
    label: "Business & Professions Code",
  },
  {
    re: new RegExp(String.raw`\b(?:Penal|Pen\.)` + AFTER_CODE.source, "i"),
    lawCode: "PEN",
    label: "Penal Code",
  },
  {
    re: new RegExp(String.raw`\b(?:Vehicle|Veh\.)` + AFTER_CODE.source, "i"),
    lawCode: "VEH",
    label: "Vehicle Code",
  },
  {
    re: new RegExp(String.raw`\b(?:Evidence|Evid\.)` + AFTER_CODE.source, "i"),
    lawCode: "EVID",
    label: "Evidence Code",
  },
  {
    re: new RegExp(String.raw`\b(?:Labor|Lab\.)` + AFTER_CODE.source, "i"),
    lawCode: "LAB",
    label: "Labor Code",
  },
  {
    re: new RegExp(
      String.raw`\b(?:Government|Gov(?:'?t)?\.)` + AFTER_CODE.source,
      "i",
    ),
    lawCode: "GOV",
    label: "Government Code",
  },
  {
    re: new RegExp(String.raw`\b(?:Civil|Civ\.)` + AFTER_CODE.source, "i"),
    lawCode: "CIV",
    label: "Civil Code",
  },
];

const USC_RE =
  /\b(\d{1,2})\s+U\.?\s*S\.?\s*C\.?\s*§{1,2}\s*([0-9A-Za-z().\-–]+)/i;
const SECTION_RE = /§{1,2}\s*([0-9A-Za-z().\-–]+)/;

function stamp(hit: Omit<StatuteSourceHit, "checkedAt">): StatuteSourceHit {
  return { ...hit, checkedAt: new Date().toISOString() };
}

function cleanSection(raw: string): string {
  return raw
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, "")
    .replace(/\.$/, "");
}

/** Path segment(s) for LII: 1983(a) → 1983/a */
export function uscSectionPath(section: string): string {
  const s = cleanSection(section);
  const m = s.match(/^(\d[\d.]*)(?:\(([a-z0-9]+)\))?(.*)$/i);
  if (!m) return encodeURIComponent(s);
  const base = m[1];
  const sub = m[2];
  if (sub) return `${base}/${sub.toLowerCase()}`;
  return base;
}

export function liiUrl(title: string, section: string): string {
  return `${LII_BASE}/${title}/${uscSectionPath(section)}`;
}

export function leginfoUrl(lawCode: string, section: string): string {
  const params = new URLSearchParams({
    lawCode,
    sectionNum: cleanSection(section),
  });
  return `${LEGINFO_SECTION}?${params}`;
}

export function parseStatuteCitation(
  citation: string,
  kindHint?: StatuteKind,
): StatuteParsed | null {
  const text = citation.trim();
  if (!text) return null;

  const usc = text.match(USC_RE);
  if (usc && (!kindHint || kindHint === "statute_federal")) {
    const title = usc[1];
    const section = cleanSection(usc[2]);
    return {
      kind: "statute_federal",
      title,
      section,
      label: `${title} U.S.C. § ${section}`,
    };
  }

  if (kindHint === "statute_federal") return null;

  const sec = text.match(SECTION_RE);
  if (!sec) return null;
  const section = cleanSection(sec[1]);

  for (const row of LAW_CODE_PATTERNS) {
    if (!row.re.test(text)) continue;
    return {
      kind: "statute_state",
      lawCode: row.lawCode,
      section,
      label: `${row.label} § ${section}`,
    };
  }

  return null;
}

/** Pure: classify HTTP + body into a statute source outcome. */
export function classifyLiiResponse(
  status: number,
  body: string,
  parsed: StatuteParsed,
): { outcome: SourceOutcome; notes: string } {
  if (status < 0) {
    return { outcome: "UNAVAILABLE", notes: "LII request failed." };
  }
  if (status === 404) {
    return {
      outcome: "ABSENT",
      notes: "LII has no page for this U.S.C. section.",
    };
  }
  if (status !== 200) {
    return {
      outcome: "UNAVAILABLE",
      notes: `LII returned HTTP ${status}.`,
    };
  }
  const hay = body.toLowerCase();
  if (/page not found/i.test(body) && body.length < 2000) {
    return { outcome: "ABSENT", notes: "LII returned a not-found page." };
  }
  const titleOk =
    hay.includes("u.s. code") ||
    hay.includes("uscode") ||
    hay.includes("united states code");
  const sectionTok = parsed.section.toLowerCase().replace(/[()]/g, "");
  const sectionOk =
    hay.includes(parsed.section.toLowerCase()) ||
    (sectionTok.length >= 3 && hay.includes(sectionTok));
  if (titleOk || sectionOk) {
    return {
      outcome: "FOUND",
      notes: "LII serves a U.S. Code page for this section.",
    };
  }
  return {
    outcome: "ABSENT",
    notes: "LII response did not look like a U.S. Code section page.",
  };
}

/** Pure: LegInfo always returns 200; empty sectionNum means absent. */
export function classifyLeginfoResponse(
  status: number,
  body: string,
  parsed: StatuteParsed,
): { outcome: SourceOutcome; notes: string } {
  if (status < 0) {
    return { outcome: "UNAVAILABLE", notes: "LegInfo request failed." };
  }
  if (status !== 200) {
    return {
      outcome: "UNAVAILABLE",
      notes: `LegInfo returned HTTP ${status}.`,
    };
  }
  const sectionNum = body.match(/var\s+sectionNum\s*=\s*'([^']*)'/);
  const got = (sectionNum?.[1] ?? "").replace(/\.$/, "");
  const want = cleanSection(parsed.section);
  if (got && (got === want || got.startsWith(want) || want.startsWith(got))) {
    return {
      outcome: "FOUND",
      notes: "LegInfo displays this California code section.",
    };
  }
  if (/sectionuid['"]:\s*'[0-9a-f-]{20,}'/i.test(body)) {
    return {
      outcome: "FOUND",
      notes: "LegInfo returned a section UID for this cite.",
    };
  }
  return {
    outcome: "ABSENT",
    notes: "LegInfo has no content for this code section.",
  };
}

function consensusFromSources(sources: StatuteSourceHit[]): Consensus {
  if (!sources.length) return "UNKNOWN";
  if (sources.every((s) => s.outcome === "OUT_OF_SCOPE")) return "OUT_OF_COVERAGE";
  if (sources.some((s) => s.outcome === "FOUND")) return "FOUND";
  if (sources.some((s) => s.outcome === "UNAVAILABLE")) return "UNCHECKED";
  if (sources.some((s) => s.outcome === "ABSENT")) return "NOT_FOUND";
  return "UNKNOWN";
}

function linksFor(
  parsed: StatuteParsed | null,
  sources: StatuteSourceHit[],
): ReferenceLink[] {
  const links: ReferenceLink[] = [];
  const seen = new Set<string>();
  const push = (link: ReferenceLink) => {
    if (seen.has(link.url)) return;
    seen.add(link.url);
    links.push(link);
  };

  for (const s of sources) {
    if (s.url && s.outcome === "FOUND") {
      push({
        label: s.source === "lii" ? "LII (U.S. Code)" : "California LegInfo",
        url: s.url,
        kind: "primary",
        origin: "source_hit",
      });
    }
  }

  if (parsed?.kind === "statute_federal" && parsed.title) {
    push({
      label: "LII (U.S. Code)",
      url: liiUrl(parsed.title, parsed.section),
      kind: sources.some((s) => s.source === "lii" && s.outcome === "FOUND")
        ? "primary"
        : "reference",
      origin: sources.some((s) => s.source === "lii" && s.outcome === "FOUND")
        ? "source_hit"
        : "constructed",
    });
  }
  if (parsed?.kind === "statute_state" && parsed.lawCode) {
    push({
      label: "California LegInfo",
      url: leginfoUrl(parsed.lawCode, parsed.section),
      kind: sources.some((s) => s.source === "leginfo" && s.outcome === "FOUND")
        ? "primary"
        : "reference",
      origin: sources.some((s) => s.source === "leginfo" && s.outcome === "FOUND")
        ? "source_hit"
        : "constructed",
    });
  }
  return links;
}

async function probeLii(parsed: StatuteParsed): Promise<StatuteSourceHit> {
  const url = liiUrl(parsed.title!, parsed.section);
  const { status, body } = await httpGet(url, {
    accept: "text/html",
    timeoutMs: 30_000,
    retries: 2,
  });
  const { outcome, notes } = classifyLiiResponse(
    status,
    body.toString("utf8"),
    parsed,
  );
  return stamp({
    source: "lii",
    outcome,
    found: outcome === "FOUND",
    coverage:
      outcome === "FOUND"
        ? "LII carries this U.S. Code section"
        : outcome === "ABSENT"
          ? "LII searched; section page absent"
          : "LII unreachable or inconclusive",
    url,
    httpStatus: status < 0 ? null : status,
    notes,
  });
}

async function probeLeginfo(parsed: StatuteParsed): Promise<StatuteSourceHit> {
  const url = leginfoUrl(parsed.lawCode!, parsed.section);
  const { status, body } = await httpGet(url, {
    accept: "text/html",
    timeoutMs: 30_000,
    retries: 2,
  });
  const { outcome, notes } = classifyLeginfoResponse(
    status,
    body.toString("utf8"),
    parsed,
  );
  return stamp({
    source: "leginfo",
    outcome,
    found: outcome === "FOUND",
    coverage:
      outcome === "FOUND"
        ? "LegInfo carries this California code section"
        : outcome === "ABSENT"
          ? "LegInfo searched; section absent"
          : "LegInfo unreachable or inconclusive",
    url,
    httpStatus: status < 0 ? null : status,
    notes,
  });
}

export interface StatuteRequestItem {
  citation: string;
  kind?: StatuteKind;
}

/**
 * Probe one statute against LII (federal) or LegInfo (mapped CA codes).
 * Safe wrapper: failures become UNCHECKED results.
 */
export async function lookupStatute(
  citation: string,
  kindHint?: StatuteKind,
): Promise<StatuteLookupResult> {
  try {
    return await lookupStatuteInner(citation, kindHint);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      query: citation,
      kind: kindHint ?? "statute_federal",
      parsed: null,
      sources: [],
      consensus: "UNCHECKED",
      matchedLabel: "",
      checkedAt: new Date().toISOString(),
      error: `Statute probe failed: ${reason}`,
    };
  }
}

async function lookupStatuteInner(
  citation: string,
  kindHint?: StatuteKind,
): Promise<StatuteLookupResult> {
  const parsed = parseStatuteCitation(citation, kindHint);
  if (!parsed) {
    return {
      query: citation,
      kind: kindHint ?? "statute_federal",
      parsed: null,
      sources: [],
      consensus: "UNKNOWN",
      matchedLabel: "",
      links: [],
      checkedAt: new Date().toISOString(),
      error: "Could not parse a USC or mapped California code section.",
    };
  }

  if (parsed.kind === "statute_federal") {
    if (!parsed.title) {
      return {
        query: citation,
        kind: "statute_federal",
        parsed,
        sources: [
          stamp({
            source: "lii",
            outcome: "OUT_OF_SCOPE",
            found: false,
            coverage: "Not a parseable U.S.C. cite",
          }),
        ],
        consensus: "OUT_OF_COVERAGE",
        matchedLabel: "",
        links: linksFor(parsed, []),
        checkedAt: new Date().toISOString(),
      };
    }
    const hit = await probeLii(parsed);
    const sources = [hit];
    return {
      query: citation,
      kind: "statute_federal",
      parsed,
      sources,
      consensus: consensusFromSources(sources),
      matchedLabel: hit.outcome === "FOUND" ? parsed.label : "",
      links: linksFor(parsed, sources),
      checkedAt: new Date().toISOString(),
    };
  }

  if (!parsed.lawCode) {
    return {
      query: citation,
      kind: "statute_state",
      parsed,
      sources: [
        stamp({
          source: "leginfo",
          outcome: "OUT_OF_SCOPE",
          found: false,
          coverage: "State code family not mapped to LegInfo",
        }),
      ],
      consensus: "OUT_OF_COVERAGE",
      matchedLabel: "",
      links: [],
      checkedAt: new Date().toISOString(),
    };
  }

  const hit = await probeLeginfo(parsed);
  const sources = [hit];
  return {
    query: citation,
    kind: "statute_state",
    parsed,
    sources,
    consensus: consensusFromSources(sources),
    matchedLabel: hit.outcome === "FOUND" ? parsed.label : "",
    links: linksFor(parsed, sources),
    checkedAt: new Date().toISOString(),
  };
}

export async function verifyStatuteItems(
  items: StatuteRequestItem[],
): Promise<StatuteLookupResult[]> {
  if (items.length > 40) {
    throw new Error("Probe at most 40 statutes per request.");
  }
  const out: StatuteLookupResult[] = [];
  for (const item of items) {
    const citation = String(item.citation ?? "").trim();
    if (!citation) continue;
    out.push(await lookupStatute(citation, item.kind));
  }
  return out;
}
