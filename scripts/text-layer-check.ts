/**
 * Offline gate: ECF/PACER stamp-only text layers must be treated as unusable
 * so extract falls through to OCR.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractPdfText } from "../src/lib/pdf/extract";
import { terminateOcrWorker } from "../src/lib/pdf/ocr";
import {
  stripFilingBoilerplate,
  substantiveCharCount,
  textLayerIsUsable,
} from "../src/lib/pdf/text-layer";

function ecfStamp(page: number, of = 50): string {
  return `Case 2:26-cv-00195-TLN-AC Document 1 Filed 01/22/26 Page ${page} of ${of}`;
}

// Stamp strip
const stamped = `${ecfStamp(1)}\n\n-- 1 of 50 --\n`;
assert.equal(substantiveCharCount(stamped), 0);
assert.match(stripFilingBoilerplate(stamped), /^\s*$/);

// 50-page ECF stamp-only layer (mirrors scanned PACER complaints)
const stampPages = Array.from({ length: 50 }, (_, i) => ({
  text: ecfStamp(i + 1),
}));
assert.equal(
  textLayerIsUsable(stampPages),
  false,
  "ECF stamp-only layers must not count as usable text",
);

// Real pleading body must still pass
const bodyPages = [
  {
    text: `POINTS AND AUTHORITIES
See Richardson v. McKnight, 521 U.S. 399 (1997).
Judicial immunity remains governed by Stump v. Sparkman, 435 U.S. 349 (1978).
The following pins are method controls.
In re Leman, 66 Cal.App.5th 200 (2021).`,
  },
];
assert.equal(textLayerIsUsable(bodyPages), true);

// Short motion + empty later pages still usable if body is rich
assert.equal(
  textLayerIsUsable([
    bodyPages[0]!,
    { text: ecfStamp(2, 2) },
  ]),
  true,
  "rich first page should keep the text layer",
);

async function main() {
  // Fixture: multi-page PDF whose only text is ECF stamps
  const pdfPath = resolve(
    import.meta.dirname,
    "../fixtures/ecf-stamp-only.pdf",
  );
  const bytes = readFileSync(pdfPath);
  const noOcr = await extractPdfText(bytes, "ecf-stamp-only.pdf", {
    allowOcr: false,
  });
  assert.equal(noOcr.textSource, "text_layer");
  assert.equal(
    noOcr.hasTextLayer,
    false,
    "stamp-only PDF must report hasTextLayer=false",
  );
  assert.ok(
    noOcr.charCount > 40,
    "raw stamp chars should exceed the old naive floor (regression guard)",
  );

  // With OCR allowed, must leave the text-layer path (blank pages → OCR source).
  const withOcr = await extractPdfText(bytes, "ecf-stamp-only.pdf", {
    maxOcrPages: 2,
  });
  assert.equal(
    withOcr.textSource,
    "ocr",
    "stamp-only PDF must fall through to OCR",
  );

  console.log("OK text-layer gate tests passed");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await terminateOcrWorker();
  });
