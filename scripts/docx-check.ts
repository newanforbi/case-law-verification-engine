/**
 * Offline Word .docx intake: extract text and queue the known control cites.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractCitationsFromPages } from "../src/lib/citations/extract";
import { extractDocxText } from "../src/lib/docx/extract";
import { extractFilingText } from "../src/lib/filing/extract";
import { filingFormatFromName } from "../src/lib/filing/kinds";

async function main() {
  assert.equal(filingFormatFromName("brief.docx"), "docx");
  assert.equal(filingFormatFromName("brief.DOCX"), "docx");
  assert.equal(filingFormatFromName("brief.pdf"), "pdf");
  assert.equal(filingFormatFromName("brief.doc"), null);

  const path = resolve(import.meta.dirname, "../fixtures/sample-pleading.docx");
  const bytes = readFileSync(path);

  const extracted = await extractDocxText(bytes, "sample-pleading.docx");
  assert.equal(extracted.textSource, "docx");
  assert.ok(extracted.hasTextLayer, "docx should yield extractable text");
  assert.match(extracted.fullText, /Richardson/i);
  assert.match(extracted.fullText, /521\s*U\.?\s*S\.?\s*399/i);
  assert.match(extracted.fullText, /Leman/i);

  const viaDispatch = await extractFilingText(bytes, "sample-pleading.docx");
  assert.equal(viaDispatch.format, "docx");
  assert.equal(viaDispatch.textSource, "docx");

  const cites = extractCitationsFromPages(extracted.pages);
  assert.ok(
    cites.verifyQueue.some((c) => /Richardson/i.test(c)),
    `expected Richardson in queue, got ${JSON.stringify(cites.verifyQueue)}`,
  );
  assert.ok(
    cites.verifyQueue.some((c) => /Leman/i.test(c)),
    `expected Leman in queue, got ${JSON.stringify(cites.verifyQueue)}`,
  );

  console.log(
    JSON.stringify(
      {
        chars: extracted.charCount,
        pages: extracted.pageCount,
        queue: cites.verifyQueue,
      },
      null,
      2,
    ),
  );
  console.log("OK docx tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
