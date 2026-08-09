/**
 * End-to-end: sample pleading PDF → extract citations → verify controls.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractCitationsFromPages } from "../src/lib/citations/extract";
import { extractPdfText } from "../src/lib/pdf/extract";
import { lookupOne } from "../src/lib/verify";

async function main() {
  const pdfPath = join(process.cwd(), "fixtures", "sample-pleading.pdf");
  const bytes = new Uint8Array(readFileSync(pdfPath));
  const extracted = await extractPdfText(bytes, "sample-pleading.pdf");
  assert.ok(extracted.hasTextLayer, "expected text layer");
  assert.ok(extracted.pageCount >= 1);

  const cites = extractCitationsFromPages(extracted.pages, { verifyLimit: 10 });
  console.log("verifyQueue", cites.verifyQueue);
  assert.ok(
    cites.verifyQueue.some((c) => /Richardson/i.test(c)),
    "Richardson not extracted from PDF",
  );
  assert.ok(
    cites.verifyQueue.some((c) => /Leman/i.test(c)),
    "Leman not extracted from PDF",
  );

  const richardsonCite =
    cites.verifyQueue.find((c) => /Richardson/i.test(c)) || "";
  const lemanCite = cites.verifyQueue.find((c) => /Leman/i.test(c)) || "";
  const richardson = await lookupOne(richardsonCite);
  const leman = await lookupOne(lemanCite);
  console.log(
    JSON.stringify(
      [
        { q: richardson.query, c: richardson.consensus },
        { q: leman.query, c: leman.consensus },
      ],
      null,
      2,
    ),
  );
  assert.ok(
    richardson.consensus === "FOUND" || richardson.consensus === "PARTIAL",
    `Richardson expected FOUND/PARTIAL, got ${richardson.consensus}`,
  );
  assert.equal(leman.consensus, "NOT_FOUND");
  console.log("OK pdf verify check passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
