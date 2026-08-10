/**
 * Deploy / local smoke: POST fixtures/sample-pleading.pdf to /api/verify-pdf
 * (extract only) and assert a JSON 200 with a non-empty verify queue.
 *
 * Usage:
 *   CITEPROOF_BASE_URL=http://127.0.0.1:3000 npx tsx scripts/deploy-smoke-check.ts
 *   CITEPROOF_BASE_URL=https://citeproof.io npx tsx scripts/deploy-smoke-check.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = (process.env.CITEPROOF_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const pdfPath = resolve(import.meta.dirname, "../fixtures/sample-pleading.pdf");

async function main() {
  const bytes = readFileSync(pdfPath);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "application/pdf" }), "sample-pleading.pdf");
  form.append("verify", "false");

  const res = await fetch(`${base}/api/verify-pdf`, { method: "POST", body: form });
  const text = await res.text();
  let body: {
    error?: string;
    methodVersion?: string;
    extraction?: { verifyQueueCount?: number; verifyQueue?: string[] };
  };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    throw new Error(
      `Expected JSON from ${base}/api/verify-pdf, got HTTP ${res.status}: ${text.slice(0, 180)}`,
    );
  }

  assert.equal(res.status, 200, body.error || `HTTP ${res.status}`);
  assert.ok(body.methodVersion, "response should carry methodVersion");
  const queue =
    body.extraction?.verifyQueueCount ?? body.extraction?.verifyQueue?.length ?? 0;
  assert.ok(queue >= 1, "extract-only smoke should return at least one authority");

  console.log(
    JSON.stringify(
      {
        base,
        status: res.status,
        methodVersion: body.methodVersion,
        verifyQueueCount: queue,
      },
      null,
      2,
    ),
  );
  console.log("OK deploy smoke passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
