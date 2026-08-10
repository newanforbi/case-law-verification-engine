import assert from "node:assert/strict";
import { reportToWordHtml, reportWordFileName } from "../src/lib/report/export-word";
import { buildReport, reportFileName } from "../src/lib/report/report";
import type { Consensus, LookupResult, Support, VerifyResponse } from "../src/lib/verify/types";
import { METHOD_VERSION } from "../src/lib/verify/types";

function result(
  citation: string,
  existence: Consensus,
  support: Support = "NO_QUOTE",
): LookupResult {
  return {
    query: citation,
    caseNameGuess: citation.split(",")[0],
    reporterPin: "521 U.S. 399",
    wlPin: null,
    sources: [
      {
        source: "courtlistener",
        outcome: existence === "FOUND" ? "FOUND" : "ABSENT",
        found: existence === "FOUND",
        coverage: "CourtListener carries U.S.",
        envelope: {
          inCorpus: true,
          reason: existence === "FOUND" ? "carried" : "searched_empty",
          reporter: "U.S.",
          volume: "521",
          jurisdiction: "us_supreme",
        },
        checkedAt: "2026-08-09T23:30:00.000Z",
        url: "https://www.courtlistener.com/opinion/1/x/",
      },
    ],
    consensus: existence,
    matchedName: existence === "FOUND" ? citation.split(",")[0] : "",
    matchedCitations: [],
    support: { verdict: support, quotes: [], pin: null },
    checkedAt: "2026-08-09T23:30:01.000Z",
  };
}

function response(results: LookupResult[]): VerifyResponse {
  return {
    generatedAt: "2026-08-09T23:30:00.000Z",
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
    controlRun: {
      runAt: "2026-08-09T23:29:00.000Z",
      ok: true,
      results: [
        {
          role: "positive",
          citation: "p",
          expected: "FOUND",
          actual: "FOUND",
          ok: true,
        },
        {
          role: "negative",
          citation: "n",
          expected: "NOT_FOUND",
          actual: "NOT_FOUND",
          ok: true,
        },
      ],
    },
    resultCount: results.length,
    counts: {} as VerifyResponse["counts"],
    results,
  };
}

const report = buildReport(
  response([
    result("Richardson v. McKnight, 521 U.S. 399 (1997)", "FOUND", "SUPPORTED"),
    result("In re Leman, 66 Cal.App.5th 200", "NOT_FOUND"),
    result("Burrell v. Jackson, 2003 WL 23545858", "OUT_OF_COVERAGE"),
    result("Doe v. Roe, 1 U.S. 1", "UNCHECKED"),
  ]),
);

assert.equal(report.methodVersion, METHOD_VERSION);
assert.ok(report.controlRun?.ok);
assert.equal(report.summary.citations, 4);
assert.equal(report.summary.existence.FOUND, 1);
assert.equal(report.summary.existence.NOT_FOUND, 1);
assert.equal(report.summary.existence.OUT_OF_COVERAGE, 1);
assert.equal(report.summary.existence.UNCHECKED, 1);
assert.equal(report.summary.support.SUPPORTED, 1);
assert.ok(report.records[0]?.sources[0]?.envelope?.reason);
assert.ok(report.records[0]?.checkedAt);

// Every verdict is present in the tally, including the zeroes, so a reader
// cannot mistake an absent key for a count of none.
assert.equal(Object.keys(report.summary.existence).length, 7);
assert.equal(Object.keys(report.summary.support).length, 6);

// The artifact carries its own limits, and they are specific to this run.
assert.match(report.caveats[0], /what the opinion says/i);
assert.ok(report.caveats.some((c) => /not checked at all/i.test(c)));
assert.ok(report.caveats.some((c) => /outside both free sources/i.test(c)));

// A clean run says the standing caveats and nothing alarming.
const clean = buildReport(
  response([result("Richardson v. McKnight, 521 U.S. 399 (1997)", "FOUND", "SUPPORTED")]),
);
assert.equal(clean.caveats.length, 5);
assert.ok(clean.caveats.some((c) => /what the opinion says/i.test(c)));
assert.ok(clean.caveats.some((c) => /references only/i.test(c)));
assert.ok(clean.caveats.some((c) => /Holding-use scores/i.test(c)));
assert.ok(clean.caveats.some((c) => /Statute probes/i.test(c)));
assert.ok(clean.caveats.some((c) => /Subsequent-cite samples/i.test(c)));
assert.equal(clean.records[0]?.links?.length ?? 0, 0); // fixture has no links attached
assert.equal(clean.summary.statutes, 0);
assert.equal(clean.statuteRecords.length, 0);
assert.equal(clean.contraryClusters.length, 0);

const withHolding = buildReport(
  response([
    {
      ...result("Stump v. Sparkman, 435 U.S. 349 (1978)", "FOUND", "NO_QUOTE"),
      propositions: [
        {
          text: "Judges always have absolute immunity from suit in all cases.",
          role: "supports",
        },
      ],
      holding: {
        overall: "overstated",
        auditor: "heuristic",
        findings: [
          {
            proposition: {
              text: "Judges always have absolute immunity from suit in all cases.",
              role: "supports",
            },
            fit: "overstated",
            suggestedRevision: "Tone down absolute language.",
            note: "overbreadth cue",
          },
        ],
        note: "Heuristic holding audit.",
      },
    },
  ]),
);
assert.equal(withHolding.records[0]?.holding?.overall, "overstated");
assert.ok(withHolding.caveats.some((c) => /overstated or unsupported/i.test(c)));
assert.match(reportToWordHtml(withHolding), /Holding use/i);
assert.match(reportToWordHtml(withHolding), /Overall: overstated/);

// Failed controls add a caveat.
const failedControls = buildReport({
  ...response([result("Richardson v. McKnight, 521 U.S. 399 (1997)", "FOUND", "SUPPORTED")]),
  controlRun: {
    runAt: "2026-08-09T23:29:00.000Z",
    ok: false,
    results: [
      {
        role: "positive",
        citation: "p",
        expected: "FOUND",
        actual: "NOT_FOUND",
        ok: false,
      },
      {
        role: "negative",
        citation: "n",
        expected: "NOT_FOUND",
        actual: "NOT_FOUND",
        ok: true,
      },
    ],
  },
});
assert.ok(failedControls.caveats.some((c) => /Method controls did not both pass/i.test(c)));

// Unsupplied quotes must be stated, not silently passed over.
const noQuotes = buildReport(
  response([result("Richardson v. McKnight, 521 U.S. 399 (1997)", "FOUND")]),
);
assert.ok(noQuotes.caveats.some((c) => /No quoted language was supplied/i.test(c)));

// The id is a handle: same content, same id; changed verdict, changed id.
const same = buildReport(
  response([result("Richardson v. McKnight, 521 U.S. 399 (1997)", "FOUND", "SUPPORTED")]),
);
assert.equal(clean.id, same.id);
const changed = buildReport(
  response([result("Richardson v. McKnight, 521 U.S. 399 (1997)", "NOT_FOUND", "SUPPORTED")]),
);
assert.notEqual(clean.id, changed.id);

assert.match(reportFileName(clean), /^citeproof-citations-2026-08-09-[0-9a-f]{8}\.json$/);
assert.match(
  reportFileName(buildReport(response([]), { document: { fileName: "Motion to Dismiss.pdf", pageCount: 12 } })),
  /^citeproof-Motion-to-Dismiss-2026-08-09-[0-9a-f]{8}\.json$/,
);

const word = reportToWordHtml(clean);
assert.match(word, /Citeproof/);
assert.match(reportWordFileName(clean), /\.doc$/);

console.log("OK report tests passed");
