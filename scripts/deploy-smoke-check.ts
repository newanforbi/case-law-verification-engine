/**
 * Deploy / local smoke: POST fixtures/sample-pleading.pdf to /api/verify-pdf
 * (extract only) and assert a JSON 200 with a non-empty verify queue.
 *
 * Uses curl for the multipart upload — Node's fetch FormData is unreliable
 * against some edge proxies (production has returned "Failed to parse body
 * as FormData" for the same payload curl accepts).
 *
 * Usage:
 *   CITEPROOF_BASE_URL=http://127.0.0.1:3010 npx tsx scripts/deploy-smoke-check.ts
 *   CITEPROOF_BASE_URL=https://citeproof.io npx tsx scripts/deploy-smoke-check.ts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const base = (process.env.CITEPROOF_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const pdfPath = resolve(import.meta.dirname, "../fixtures/sample-pleading.pdf");
/** When true, require methodVersion (fortify+). Off for pre-merge production checks. */
const requireMethodVersion = process.env.CITEPROOF_REQUIRE_METHOD_VERSION !== "0";

function main() {
  const raw = execFileSync(
    "curl",
    [
      "-sS",
      "-L",
      "-X",
      "POST",
      `${base}/api/verify-pdf`,
      "-F",
      `file=@${pdfPath};type=application/pdf`,
      "-F",
      "verify=false",
      "-w",
      "\n%{http_code}",
    ],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
  const nl = raw.lastIndexOf("\n");
  const text = raw.slice(0, nl);
  const status = Number(raw.slice(nl + 1));

  let body: {
    error?: string;
    methodVersion?: string;
    extraction?: { verifyQueueCount?: number; verifyQueue?: string[] };
  };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    throw new Error(
      `Expected JSON from ${base}/api/verify-pdf, got HTTP ${status}: ${text.slice(0, 180)}`,
    );
  }

  assert.equal(status, 200, body.error || `HTTP ${status}`);
  if (requireMethodVersion) {
    assert.ok(body.methodVersion, "response should carry methodVersion");
  }
  const queue =
    body.extraction?.verifyQueueCount ?? body.extraction?.verifyQueue?.length ?? 0;
  assert.ok(queue >= 1, "extract-only smoke should return at least one authority");

  console.log(
    JSON.stringify(
      {
        base,
        status,
        methodVersion: body.methodVersion ?? null,
        verifyQueueCount: queue,
      },
      null,
      2,
    ),
  );
  console.log("OK deploy smoke passed");
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
