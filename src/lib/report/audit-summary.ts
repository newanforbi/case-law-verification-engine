/**
 * Compact citation-audit narrative for print / one-page filings.
 *
 * The interactive results screen stays detailed; the paper artifact is a short
 * verified-citations list with a plain-language summary — not a multi-page
 * dump of every source panel.
 */
import type {
  Consensus,
  LookupResult,
  StatuteLookupResult,
  VerifyResponse,
} from "@/lib/verify";

export type AuditPrintStatus =
  | "verified"
  | "issue"
  | "not_found"
  | "not_covered"
  | "unchecked";

export interface AuditPrintRow {
  /** Full citation string (fallback / sorting key). */
  citation: string;
  /** Party / case caption for italic display, when separable. */
  caseName: string | null;
  /** Reporter + year remainder after the case name. */
  reporterPart: string | null;
  status: AuditPrintStatus;
  label: string;
  /** Soft signal from CourtListener citeCount when available. */
  wellEstablished?: boolean;
}

export interface AuditSummary {
  clean: boolean;
  title: string;
  lead: string;
  rows: AuditPrintRow[];
  statuteLine: string | null;
  closingTitle: string;
  closing: string;
  meta: {
    reportId: string;
    methodVersion: string;
    generatedAt: string;
    documentName?: string;
  };
}

const ISSUE: Consensus[] = ["PARTIAL", "CAPTION_MISMATCH"];
const BAD: Consensus[] = ["NOT_FOUND"];
const COVERED_OK: Consensus[] = ["FOUND"];

function printStatus(consensus: Consensus): AuditPrintStatus {
  if (consensus === "FOUND") return "verified";
  if (consensus === "NOT_FOUND") return "not_found";
  if (consensus === "OUT_OF_COVERAGE") return "not_covered";
  if (consensus === "UNCHECKED" || consensus === "UNKNOWN") return "unchecked";
  return "issue";
}

function printLabel(status: AuditPrintStatus): string {
  switch (status) {
    case "verified":
      return "Verified";
    case "not_found":
      return "Not found";
    case "not_covered":
      return "Not covered";
    case "unchecked":
      return "Not checked";
    case "issue":
      return "Needs review";
    default:
      return status;
  }
}

function citeCountOf(r: LookupResult): number | undefined {
  const fromSource = r.sources.find((s) => s.source === "courtlistener")?.citeCount;
  if (typeof fromSource === "number") return fromSource;
  if (typeof r.treatment?.citingCount === "number") return r.treatment.citingCount;
  return undefined;
}

/** Split "Case Name, 123 U.S. 456 (1990)" into italic name + reporter remainder. */
export function splitCitationDisplay(r: LookupResult): {
  caseName: string | null;
  reporterPart: string | null;
} {
  const q = r.query.trim();
  const guess = (r.matchedName || r.caseNameGuess || "").trim();
  if (guess) {
    const lower = q.toLowerCase();
    const g = guess.toLowerCase();
    if (lower.startsWith(g)) {
      const rest = q.slice(guess.length).replace(/^,\s*/, "").trim();
      return { caseName: guess, reporterPart: rest || null };
    }
  }
  const comma = q.indexOf(",");
  if (comma > 0) {
    return {
      caseName: q.slice(0, comma).trim(),
      reporterPart: q.slice(comma + 1).trim() || null,
    };
  }
  return { caseName: null, reporterPart: null };
}

function rowFromLookup(r: LookupResult): AuditPrintRow {
  const status = printStatus(r.consensus);
  const n = citeCountOf(r);
  const { caseName, reporterPart } = splitCitationDisplay(r);
  return {
    citation: r.query,
    caseName,
    reporterPart,
    status,
    label: printLabel(status),
    ...(status === "verified" && typeof n === "number" && n >= 100
      ? { wellEstablished: true as const }
      : {}),
  };
}

function allClean(
  results: LookupResult[],
  statutes: StatuteLookupResult[],
): boolean {
  if (!results.length && !statutes.length) return false;
  const casesOk = results.every((r) => COVERED_OK.includes(r.consensus));
  const statutesOk = statutes.every((s) => COVERED_OK.includes(s.consensus));
  return casesOk && statutesOk;
}

function countKinds(
  results: LookupResult[],
): { bad: number; issues: number; unchecked: number; uncovered: number } {
  let bad = 0;
  let issues = 0;
  let unchecked = 0;
  let uncovered = 0;
  for (const r of results) {
    if (BAD.includes(r.consensus)) bad += 1;
    else if (ISSUE.includes(r.consensus)) issues += 1;
    else if (r.consensus === "OUT_OF_COVERAGE") uncovered += 1;
    else if (r.consensus === "UNCHECKED" || r.consensus === "UNKNOWN") unchecked += 1;
  }
  return { bad, issues, unchecked, uncovered };
}

export function buildAuditSummary(data: VerifyResponse): AuditSummary {
  const results = data.results ?? [];
  const statutes = data.statuteResults ?? [];
  const rows = results.map(rowFromLookup);
  const clean = allClean(results, statutes);
  const { bad, issues, unchecked, uncovered } = countKinds(results);
  const contrary = (data.contraryClusters ?? []).map((c) => c.citation);

  let lead: string;
  if (clean) {
    lead =
      "After a thorough audit, no citation inaccuracies were found. Every case" +
      (statutes.length ? ", statute, and rule" : "") +
      " cited in the filing is verified as authentic and correctly referenced.";
  } else {
    const bits: string[] = [];
    if (bad) bits.push(`${bad} not found`);
    if (issues) bits.push(`${issues} needing review`);
    if (uncovered) bits.push(`${uncovered} outside free-source coverage`);
    if (unchecked) bits.push(`${unchecked} unchecked`);
    lead =
      `After a thorough audit, ${bits.join(", ") || "issues"} were found among ${results.length} case-law authorit${results.length === 1 ? "y" : "ies"}. ` +
      "Review the flagged rows below before filing.";
  }

  let statuteLine: string | null = null;
  if (statutes.length) {
    const ok = statutes.filter((s) => s.consensus === "FOUND").length;
    const fail = statutes.length - ok;
    statuteLine =
      fail === 0
        ? `Statutes: All ${statutes.length} federal and California statute${statutes.length === 1 ? "" : "s"} probed are verified as authentic.`
        : `Statutes: ${ok} of ${statutes.length} verified; ${fail} did not resolve on free code hosts (LII / LegInfo).`;
  }

  let closing =
    "A distinction exists between citation accuracy and legal strength — a case can be real and still not carry the weight the filing places on it.";
  if (contrary.length) {
    const names = contrary
      .map((c) => c.split(",")[0]?.trim() || c)
      .slice(0, 3)
      .join("; ");
    closing +=
      ` The filing itself flags contrary or limiting use of: ${names}` +
      (contrary.length > 3 ? ` (and ${contrary.length - 3} more)` : "") +
      ".";
  }
  if (clean) {
    closing = "The filing's citations are accurate. " + closing;
  }

  return {
    clean,
    title: "Citation Audit Report",
    lead,
    rows,
    statuteLine,
    closingTitle: clean ? "No Inaccuracies Found" : "Review Before Filing",
    closing,
    meta: {
      reportId: "",
      methodVersion: data.methodVersion,
      generatedAt: data.generatedAt,
      documentName: undefined,
    },
  };
}

function formatCiteHtml(r: AuditPrintRow): string {
  if (r.caseName) {
    return `<em>${esc(r.caseName)}</em>${
      r.reporterPart ? `, ${esc(r.reporterPart)}` : ""
    }`;
  }
  return esc(r.citation);
}

/** Compact HTML for Word / print-adjacent downloads. */
export function auditSummaryToHtml(
  summary: AuditSummary,
  extra: { reportId?: string; documentName?: string } = {},
): string {
  const id = extra.reportId || summary.meta.reportId || "—";
  const doc = extra.documentName || summary.meta.documentName;
  const rows = summary.rows
    .map((r) => {
      const mark =
        r.status === "verified" ? "✓" : r.status === "not_found" ? "✗" : "·";
      const est = r.wellEstablished ? " (well-established)" : "";
      return `<tr>
  <td style="padding:2pt 8pt 2pt 0; border-bottom:0.4pt solid #ddd; vertical-align:top;">
    ${formatCiteHtml(r)}
  </td>
  <td style="padding:2pt 0 2pt 8pt; border-bottom:0.4pt solid #ddd; white-space:nowrap; text-align:right; vertical-align:top;">
    ${mark} ${esc(r.label)}${esc(est)}
  </td>
</tr>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<title>${esc(summary.title)}</title>
<style>
  body { font-family: Georgia, "Times New Roman", serif; font-size: 10pt; color: #111; margin: 14mm; line-height: 1.35; }
  h1 { font-size: 15pt; margin: 0 0 3pt; text-align: center; font-weight: 600; }
  .meta { text-align: center; color: #555; font-size: 8pt; margin: 0 0 10pt; }
  .lead { margin: 0 0 12pt; }
  h2 { font-size: 10.5pt; margin: 12pt 0 4pt; letter-spacing: 0.03em; text-transform: uppercase; font-weight: 600; }
  .sub { font-size: 9pt; color: #444; margin: 0 0 6pt; }
  table { width: 100%; border-collapse: collapse; }
  .statutes { margin-top: 12pt; }
  .closing-title { margin-top: 14pt; border-top: 0.5pt solid #999; padding-top: 10pt; }
  .closing { margin: 4pt 0 0; }
</style></head><body>
  <h1>${esc(summary.title)}</h1>
  <p class="meta">Citeproof · report ${esc(id)} · method ${esc(summary.meta.methodVersion)}${
    doc ? ` · ${esc(doc)}` : ""
  }</p>
  <p class="lead">${esc(summary.lead)}</p>
  <h2>Verified Citations</h2>
  <p class="sub">Citation Verification</p>
  <table>
    <tbody>
${rows || `<tr><td colspan="2">No case-law authorities in this audit.</td></tr>`}
    </tbody>
  </table>
  ${summary.statuteLine ? `<p class="statutes">${esc(summary.statuteLine)}</p>` : ""}
  <h2 class="closing-title">${esc(summary.closingTitle)}</h2>
  <p class="closing">${esc(summary.closing)}</p>
</body></html>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
