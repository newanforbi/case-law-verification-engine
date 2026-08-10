/**
 * Offline checks for PDF size limits and Blob URL guards.
 */
import assert from "node:assert/strict";
import { assertFilingBlobUrl } from "../src/lib/pdf/blob";
import {
  DIRECT_BODY_MAX_BYTES,
  MAX_PDF_BYTES,
  MAX_PDF_LABEL,
  describeBytes,
} from "../src/lib/pdf/limits";

assert.equal(MAX_PDF_BYTES, 40 * 1024 * 1024);
assert.equal(DIRECT_BODY_MAX_BYTES, 4 * 1024 * 1024);
assert.equal(MAX_PDF_LABEL, "40 MB");
assert.equal(describeBytes(5 * 1024 * 1024), "5.0 MB");

assert.ok(
  assertFilingBlobUrl(
    "https://abc123.public.blob.vercel-storage.com/filings/brief.pdf",
  ),
);
assert.throws(
  () => assertFilingBlobUrl("https://evil.example.com/filings/brief.pdf"),
  /not a Vercel Blob/,
);
assert.throws(
  () =>
    assertFilingBlobUrl(
      "https://abc123.public.blob.vercel-storage.com/other/brief.pdf",
    ),
  /not a Citeproof filing/,
);

console.log("OK blob limits tests passed");
