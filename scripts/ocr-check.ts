/**
 * Offline OCR path: image-only fixture must fail text-layer extract and succeed
 * via tesseract, recovering the known control citations.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractCitationsFromPages } from "../src/lib/citations/extract";
import { extractPdfText } from "../src/lib/pdf/extract";
import { terminateOcrWorker } from "../src/lib/pdf/ocr";

async function main() {
  const pdfPath = resolve(import.meta.dirname, "../fixtures/scanned-pleading.pdf");
  const bytes = readFileSync(pdfPath);

  const noOcr = await extractPdfText(bytes, "scanned-pleading.pdf", { allowOcr: false });
  assert.equal(noOcr.hasTextLayer, false, "fixture must be image-only");
  assert.equal(noOcr.textSource, "text_layer");

  const withOcr = await extractPdfText(bytes, "scanned-pleading.pdf");
  assert.equal(withOcr.textSource, "ocr");
  assert.ok(withOcr.hasTextLayer, "OCR should recover enough text");
  assert.match(withOcr.fullText, /Richardson/i);
  assert.match(withOcr.fullText, /521\s*U\.?\s*S\.?\s*399/i);
  assert.match(withOcr.fullText, /Leman/i);

  const cites = extractCitationsFromPages(withOcr.pages);
  assert.ok(
    cites.verifyQueue.some((c) => /Richardson/i.test(c)),
    `expected Richardson in queue, got ${JSON.stringify(cites.verifyQueue)}`,
  );

  // Text-layer fixture must not pay for OCR.
  const textPdf = readFileSync(resolve(import.meta.dirname, "../fixtures/sample-pleading.pdf"));
  const layered = await extractPdfText(textPdf, "sample-pleading.pdf");
  assert.equal(layered.textSource, "text_layer");
  assert.equal(layered.ocr, undefined);

  console.log(
    JSON.stringify(
      {
        ocrChars: withOcr.charCount,
        ocrMeta: withOcr.ocr,
        queue: cites.verifyQueue,
      },
      null,
      2,
    ),
  );
  console.log("OK ocr tests passed");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await terminateOcrWorker();
  });
