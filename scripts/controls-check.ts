/**
 * Live method controls against CourtListener + CAP static.case.law.
 * Expect: Richardson FOUND/PARTIAL; Leman NOT_FOUND.
 */
import assert from "node:assert/strict";
import { CONTROLS, verifyCitations } from "../src/lib/verify";

const data = await verifyCitations(`${CONTROLS.positive}\n${CONTROLS.negative}`);
console.log(
  JSON.stringify(
    data.results.map((r) => ({
      query: r.query,
      consensus: r.consensus,
      matchedName: r.matchedName,
      sources: r.sources.map((s) => ({ source: s.source, found: s.found })),
    })),
    null,
    2,
  ),
);

const richardson = data.results.find((r) => r.query.includes("Richardson"));
const leman = data.results.find((r) => r.query.includes("Leman"));
assert.ok(richardson, "missing Richardson result");
assert.ok(leman, "missing Leman result");
assert.ok(
  richardson.consensus === "FOUND" || richardson.consensus === "PARTIAL",
  `Richardson expected FOUND/PARTIAL, got ${richardson.consensus}`,
);
assert.equal(leman.consensus, "NOT_FOUND", `Leman expected NOT_FOUND, got ${leman.consensus}`);
console.log("OK method controls passed");
