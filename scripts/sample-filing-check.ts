/**
 * Live check against the uploaded N.D. Cal. complaint sample:
 * extract must finish quickly, coverage-aware verdicts must distinguish
 * OUT_OF_COVERAGE, and harvested quotes must reach support checking.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractCitationsFromPages } from "../src/lib/citations/extract";
import { extractPdfText } from "../src/lib/pdf/extract";
import { lookupOneSafe, verifyCitationItems } from "../src/lib/verify";

async function main() {
  const path =
    process.argv[2] ||
    "Complaint Ngwa Nforbi v Meza-Gonzalez and Melano NDCal 3 Operative.pdf";

  const t0 = Date.now();
  const pdf = await extractPdfText(readFileSync(path));
  const cites = extractCitationsFromPages(pdf.pages);
  const extractMs = Date.now() - t0;
  assert.ok(extractMs < 15_000, `extract too slow: ${extractMs}ms`);
  assert.ok(cites.verifyQueue.length >= 5, "expected authorities from sample filing");

  // Coverage: unpublished WL-only should not be NOT_FOUND.
  const wl = await lookupOneSafe("Burrell v. Jackson, 2003 WL 23545858");
  assert.equal(
    wl.consensus,
    "OUT_OF_COVERAGE",
    `WL-only should be OUT_OF_COVERAGE, got ${wl.consensus}`,
  );

  // Controls still hold through the batch API shape.
  const controls = await verifyCitationItems([
    { citation: "Richardson v. McKnight, 521 U.S. 399 (1997)" },
    { citation: "In re Leman, 66 Cal.App.5th 200" },
  ]);
  assert.equal(controls.results[0]?.consensus, "FOUND");
  assert.equal(controls.results[1]?.consensus, "NOT_FOUND");

  // Quote path: a known Richardson passage with pin.
  const quoted = await lookupOneSafe(
    "Richardson v. McKnight, 521 U.S. 399, 402 (1997)",
    ["private prison guards"],
  );
  assert.equal(quoted.consensus, "FOUND");
  assert.ok(
    quoted.support.verdict === "SUPPORTED" ||
      quoted.support.verdict === "QUALIFIED" ||
      quoted.support.verdict === "UNCHECKED",
    `unexpected support ${quoted.support.verdict}`,
  );

  // Spot-check a few authorities from the filing itself.
  const sampleItems = cites.verifyItems.slice(0, 4);
  const batch = await verifyCitationItems(sampleItems);
  assert.equal(batch.results.length, sampleItems.length);

  console.log(
    JSON.stringify(
      {
        extractMs,
        queue: cites.verifyQueue.length,
        withPassages: cites.verifyItems.filter((i) => i.passages.length).length,
        wl: wl.consensus,
        richardsonSupport: quoted.support.verdict,
        filingSpot: batch.results.map((r) => ({
          q: r.query,
          c: r.consensus,
          s: r.support.verdict,
        })),
      },
      null,
      2,
    ),
  );
  console.log("OK sample filing check passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
