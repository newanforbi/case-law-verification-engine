/**
 * Offline regression pack for the filing-audit path.
 *
 * No network: extract golden + report artifact shape + Word export + coverage
 * envelopes. Live source behaviour stays in controls-check / sample-filing-check.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractCitationsFromPages, extractCitationsFromText } from "../src/lib/citations/extract";
import { extractPdfText } from "../src/lib/pdf/extract";
import { reportToWordHtml, reportWordFileName } from "../src/lib/report/export-word";
import { buildReport, reportFileName } from "../src/lib/report/report";
import { extractQuotedPassages } from "../src/lib/verify/quotes";
import { METHOD_VERSION, type LookupResult, type VerifyResponse } from "../src/lib/verify/types";

async function main() {
  const root = resolve(import.meta.dirname, "..");
  const sampleText = readFileSync(
    resolve(root, "fixtures/regression/extract-sample.txt"),
    "utf8",
  );
  const expected = JSON.parse(
    readFileSync(resolve(root, "fixtures/regression/expected-extract.json"), "utf8"),
  ) as {
    mustIncludeInQueue: string[];
    mustHarvestPassages: Record<string, string[]>;
    mustNotQueue: string[];
    minAuthorities: number;
    minLocalRules: number;
  };

  const extracted = extractCitationsFromText(sampleText);
  assert.ok(
    (extracted.countsByKind.authority || 0) >= expected.minAuthorities,
    `expected >= ${expected.minAuthorities} authorities`,
  );
  assert.ok(
    (extracted.countsByKind.rule_local || 0) >= expected.minLocalRules,
    "local rules should still extract",
  );

  assert.ok(
    extracted.verifyQueue.some((c) => /Richardson/.test(c) && /399,\s*402/.test(c)),
    "Richardson pin page must survive extract",
  );
  assert.ok(
    extracted.verifyQueue.some((c) => /Leman/.test(c) && /66/.test(c)),
    "Leman must be in queue",
  );
  assert.ok(
    extracted.verifyQueue.some((c) => /2003 WL 23545858/i.test(c)),
    "Westlaw pin must survive extract",
  );
  for (const banned of expected.mustNotQueue) {
    assert.ok(!extracted.verifyQueue.some((c) => c.includes(banned)), `queue should omit ${banned}`);
  }

  for (const [needle, passages] of Object.entries(expected.mustHarvestPassages)) {
    const item = extracted.verifyItems.find((i) => i.citation.includes(needle));
    assert.ok(item, `verifyItems missing ${needle}`);
    for (const p of passages) {
      assert.ok(
        item!.passages.some((x) => x.toLowerCase().includes(p.toLowerCase())),
        `${needle} should harvest “${p}”`,
      );
    }
  }

  // Curly / single-quoted harvest.
  assert.ok(
    extractQuotedPassages("County said (‘public entity liability’).").some((p) =>
      /public entity liability/i.test(p),
    ),
  );

  function result(
    citation: string,
    existence: LookupResult["consensus"],
    support: LookupResult["support"]["verdict"] = "NO_QUOTE",
  ): LookupResult {
    return {
      query: citation,
      caseNameGuess: citation.split(",")[0] || citation,
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
          checkedAt: "2026-08-10T01:00:00.000Z",
          url: "https://www.courtlistener.com/opinion/1/x/",
        },
      ],
      consensus: existence,
      matchedName: existence === "FOUND" ? citation.split(",")[0] || "" : "",
      matchedCitations: [],
      support: { verdict: support, quotes: [], pin: null },
      checkedAt: "2026-08-10T01:00:01.000Z",
    };
  }

  const response: VerifyResponse = {
    generatedAt: "2026-08-10T01:00:02.000Z",
    methodVersion: METHOD_VERSION,
    methodology: {
      version: METHOD_VERSION,
      sources: ["CourtListener", "CAP"],
      reference: "regression",
      controls: {
        positive: "Richardson v. McKnight, 521 U.S. 399 (1997)",
        negative: "In re Leman, 66 Cal.App.5th 200",
        expected: { positive: "FOUND", negative: "NOT_FOUND" },
      },
    },
    controlRun: {
      runAt: "2026-08-10T01:00:00.000Z",
      ok: true,
      results: [
        {
          role: "positive",
          citation: "Richardson v. McKnight, 521 U.S. 399 (1997)",
          expected: "FOUND",
          actual: "FOUND",
          ok: true,
        },
        {
          role: "negative",
          citation: "In re Leman, 66 Cal.App.5th 200",
          expected: "NOT_FOUND",
          actual: "NOT_FOUND",
          ok: true,
        },
      ],
    },
    resultCount: 2,
    counts: { FOUND: 1, NOT_FOUND: 1 } as VerifyResponse["counts"],
    results: [
      result("Richardson v. McKnight, 521 U.S. 399 (1997)", "FOUND", "SUPPORTED"),
      result("In re Leman, 66 Cal.App.5th 200", "NOT_FOUND"),
    ],
  };

  const report = buildReport(response, {
    document: { fileName: "regression.pdf", pageCount: 3 },
  });
  assert.equal(report.methodVersion, METHOD_VERSION);
  assert.ok(report.controlRun?.ok);
  assert.ok(report.records[0]?.sources[0]?.envelope?.jurisdiction === "us_supreme");
  assert.ok(report.records[0]?.checkedAt);
  assert.match(reportFileName(report), /^citeproof-regression-2026-08-10-[0-9a-f]{8}\.json$/);

  const word = reportToWordHtml(report);
  assert.match(word, /Citation verification report/);
  assert.match(word, /method 2026\.08\.1/);
  assert.match(word, /Richardson/);
  assert.match(reportWordFileName(report), /\.doc$/);

  const pdfPath = resolve(root, "fixtures/sample-pleading.pdf");
  const pdf = await extractPdfText(readFileSync(pdfPath));
  assert.ok(pdf.hasTextLayer);
  const pdfCites = extractCitationsFromPages(pdf.pages);
  assert.ok(pdfCites.verifyQueue.length >= 1, "sample pleading should yield authorities");

  console.log(
    JSON.stringify(
      {
        methodVersion: METHOD_VERSION,
        textQueue: extracted.verifyQueue.length,
        pdfQueue: pdfCites.verifyQueue.length,
        reportId: report.id,
        wordBytes: Buffer.byteLength(word, "utf8"),
      },
      null,
      2,
    ),
  );
  console.log("OK regression pack passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
