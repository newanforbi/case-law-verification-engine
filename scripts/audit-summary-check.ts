import assert from "node:assert/strict";
import {
  auditSummaryToHtml,
  buildAuditSummary,
  splitCitationDisplay,
} from "../src/lib/report/audit-summary";
import type {
  Consensus,
  LookupResult,
  StatuteLookupResult,
  VerifyResponse,
} from "../src/lib/verify/types";
import { METHOD_VERSION } from "../src/lib/verify/types";

function result(
  citation: string,
  existence: Consensus,
  opts: { citeCount?: number; matchedName?: string } = {},
): LookupResult {
  return {
    query: citation,
    caseNameGuess: citation.split(",")[0]?.trim() || citation,
    reporterPin: null,
    wlPin: null,
    sources: [
      {
        source: "courtlistener",
        outcome: existence === "FOUND" ? "FOUND" : "ABSENT",
        found: existence === "FOUND",
        coverage: "CourtListener",
        citeCount: opts.citeCount,
        checkedAt: "2026-08-10T00:00:00.000Z",
      },
    ],
    consensus: existence,
    matchedName: opts.matchedName ?? (existence === "FOUND" ? citation.split(",")[0]?.trim() || "" : ""),
    matchedCitations: [],
    support: { verdict: "NO_QUOTE", quotes: [], pin: null },
    checkedAt: "2026-08-10T00:00:00.000Z",
  };
}

function statute(query: string, consensus: Consensus): StatuteLookupResult {
  return {
    query,
    kind: "statute_federal",
    parsed: { kind: "statute_federal", title: "42", section: "1983", label: query },
    sources: [],
    consensus,
    matchedLabel: query,
    checkedAt: "2026-08-10T00:00:00.000Z",
  };
}

function response(
  results: LookupResult[],
  extras: Partial<VerifyResponse> = {},
): VerifyResponse {
  return {
    generatedAt: "2026-08-10T00:00:00.000Z",
    methodVersion: METHOD_VERSION,
    methodology: {
      version: METHOD_VERSION,
      sources: ["CourtListener", "CAP"],
      reference: "test",
      controls: {
        positive: "p",
        negative: "n",
        expected: { positive: "FOUND", negative: "NOT_FOUND" },
      },
    },
    resultCount: results.length,
    counts: {} as VerifyResponse["counts"],
    results,
    ...extras,
  };
}

const split = splitCitationDisplay(
  result("Ex parte Young, 209 U.S. 123 (1908)", "FOUND", {
    matchedName: "Ex parte Young",
  }),
);
assert.equal(split.caseName, "Ex parte Young");
assert.equal(split.reporterPart, "209 U.S. 123 (1908)");

const clean = buildAuditSummary(
  response(
    [
      result("Ex parte Young, 209 U.S. 123 (1908)", "FOUND"),
      result("Stump v. Sparkman, 435 U.S. 349 (1978)", "FOUND", { citeCount: 250 }),
      result("Armondo v. DMV, 15 Cal.App.4th 1174 (1993)", "FOUND", { citeCount: 40 }),
    ],
    {
      statuteResults: [statute("42 U.S.C. § 1983", "FOUND")],
      contraryClusters: [
        {
          citation: "Armondo v. DMV, 15 Cal.App.4th 1174 (1993)",
          matchedName: "Armondo v. DMV",
          propositions: [],
          existence: "FOUND",
          negativeLanguageSampleCount: 0,
        },
      ],
    },
  ),
);

assert.equal(clean.clean, true);
assert.match(clean.lead, /no citation inaccuracies were found/i);
assert.equal(clean.closingTitle, "No Inaccuracies Found");
assert.match(clean.closing, /citations are accurate/i);
assert.match(clean.closing, /Armondo/i);
assert.equal(clean.rows.length, 3);
assert.equal(clean.rows[0]?.status, "verified");
assert.equal(clean.rows[0]?.caseName, "Ex parte Young");
assert.equal(clean.rows[1]?.wellEstablished, true);
assert.equal(clean.rows[2]?.wellEstablished, undefined);
assert.match(clean.statuteLine ?? "", /verified as authentic/i);

const dirty = buildAuditSummary(
  response([
    result("Richardson v. McKnight, 521 U.S. 399 (1997)", "FOUND"),
    result("In re Leman, 66 Cal.App.5th 200", "NOT_FOUND"),
  ]),
);
assert.equal(dirty.clean, false);
assert.equal(dirty.closingTitle, "Review Before Filing");
assert.match(dirty.lead, /1 not found/i);
assert.equal(dirty.rows[1]?.status, "not_found");
assert.equal(dirty.rows[1]?.label, "Not found");

const html = auditSummaryToHtml(clean, { reportId: "test-id" });
assert.match(html, /Citation Audit Report/);
assert.match(html, /<em>Ex parte Young<\/em>/);
assert.match(html, /\(well-established\)/);
assert.match(html, /No Inaccuracies Found/);
assert.ok(!html.includes("CourtListener opinion URL"));
assert.ok(html.length < 8000, `compact html should stay short, got ${html.length}`);

console.log("audit-summary-check: ok");
