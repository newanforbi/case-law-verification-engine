/**
 * Live method controls against CourtListener + CAP static.case.law.
 *
 * Expect: Richardson FOUND, Leman NOT_FOUND. Richardson is asserted at FOUND
 * rather than FOUND-or-PARTIAL now that a verdict follows coverage instead of
 * a source count — one source that carries U.S. Reports settles it, so a
 * PARTIAL here would mean a source that covers the volume actively disagrees,
 * which is a real failure worth breaking on.
 */
import assert from "node:assert/strict";
import { CONTROLS, verifyCitations } from "../src/lib/verify";

async function main() {
  const data = await verifyCitations(`${CONTROLS.positive}\n${CONTROLS.negative}`);
  console.log(
    JSON.stringify(
      data.results.map((r) => ({
        query: r.query,
        consensus: r.consensus,
        matchedName: r.matchedName,
        sources: r.sources.map((s) => ({
          source: s.source,
          outcome: s.outcome,
          coverage: s.coverage,
        })),
      })),
      null,
      2,
    ),
  );

  const richardson = data.results.find((r) => r.query.includes("Richardson"));
  const leman = data.results.find((r) => r.query.includes("Leman"));
  assert.ok(richardson, "missing Richardson result");
  assert.ok(leman, "missing Leman result");

  // Say why when the controls cannot run, rather than reporting it as a
  // verdict regression: every source unreachable proves nothing either way.
  const reachedSomething = data.results.some((r) =>
    r.sources.some((s) => s.outcome !== "UNAVAILABLE"),
  );
  if (!reachedSomething) {
    console.error(
      "INCONCLUSIVE: no source was reachable, so the controls proved nothing. " +
        "Check network egress to courtlistener.com and static.case.law.",
    );
    process.exit(2);
  }
  assert.equal(
    richardson.consensus,
    "FOUND",
    `Richardson expected FOUND, got ${richardson.consensus}`,
  );
  assert.equal(
    leman.consensus,
    "NOT_FOUND",
    `Leman expected NOT_FOUND, got ${leman.consensus}`,
  );
  console.log("OK method controls passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
