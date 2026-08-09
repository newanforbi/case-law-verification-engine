/**
 * Getting the opinion's own words, so a quote can be checked against them.
 *
 * Two sources, same order of preference as the existence probe. CAP's static
 * HTML is already addressed by the volume lookup that just succeeded, so it
 * costs one more request against a URL we hold. CourtListener needs its
 * opinion record fetched from the search result.
 *
 * Every failure path here returns null. Nothing in this module may report an
 * absence: a quote can only be called missing from text we actually read, and
 * "we could not read it" has to stay distinguishable from "it is not there".
 */
import { httpGet } from "./http";

export interface OpinionText {
  text: string;
  source: "case.law_static" | "courtlistener";
  url: string;
}

const CL_OPINIONS = "https://www.courtlistener.com/api/rest/v4/opinions/";

/** Tags out, entities and page markers kept — pagination lives in the markup. */
function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCharCode(parseInt(code, 16)),
    )
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * CAP page labels sit in attributes that htmlToText would strip, so they are
 * lifted into the star-pagination form the matcher already understands before
 * the tags come out.
 */
function capHtmlToText(html: string): string {
  const withMarkers = html.replace(
    /<a[^>]*\bdata-label="(\d{1,5})"[^>]*>/gi,
    (_, label: string) => ` *${label} `,
  );
  return htmlToText(withMarkers);
}

async function fromCap(caseUrl: string): Promise<OpinionText | null> {
  if (!/\/html\/.+\.html$/.test(caseUrl)) return null;
  const { status, body } = await httpGet(caseUrl, { accept: "text/html" });
  if (status !== 200) return null;
  const text = capHtmlToText(body.toString("utf8"));
  return text.length > 200
    ? { text, source: "case.law_static", url: caseUrl }
    : null;
}

/**
 * CourtListener stores an opinion's words under whichever field its source
 * supplied — plain text for some, one of several HTML flavors for others — so
 * take the longest thing that looks like the opinion rather than betting on a
 * single field name.
 */
function pickOpinionBody(record: Record<string, unknown>): string | null {
  const candidates = [
    "plain_text",
    "html_with_citations",
    "html",
    "html_lawbox",
    "html_columbia",
    "html_anon_2020",
    "xml_harvard",
  ];
  let best: string | null = null;
  for (const key of candidates) {
    const value = record[key];
    if (typeof value !== "string" || !value.trim()) continue;
    const text = key === "plain_text" ? value : htmlToText(value);
    if (!best || text.length > best.length) best = text;
  }
  return best && best.length > 200 ? best : null;
}

async function fromCourtListener(opinionUrl: string): Promise<OpinionText | null> {
  // .../opinion/{cluster}/{slug}/ — the cluster is what the search hands back.
  const m = opinionUrl.match(/\/opinion\/(\d+)\//);
  if (!m) return null;

  const url = `${CL_OPINIONS}?${new URLSearchParams({ cluster: m[1] })}`;
  const { status, body } = await httpGet(url);
  if (status !== 200) return null;

  let data: { results?: Array<Record<string, unknown>> };
  try {
    data = JSON.parse(body.toString("utf8")) as typeof data;
  } catch {
    return null;
  }

  for (const record of data.results ?? []) {
    const text = pickOpinionBody(record);
    if (text) return { text, source: "courtlistener", url: opinionUrl };
  }
  return null;
}

/** The opinion's text from whichever source can supply it, or null. */
export async function fetchOpinionText(candidates: {
  capUrl?: string;
  courtListenerUrl?: string;
}): Promise<OpinionText | null> {
  if (candidates.capUrl) {
    const cap = await fromCap(candidates.capUrl);
    if (cap) return cap;
  }
  if (candidates.courtListenerUrl) {
    return fromCourtListener(candidates.courtListenerUrl);
  }
  return null;
}

export const __testing = { htmlToText, capHtmlToText, pickOpinionBody };
