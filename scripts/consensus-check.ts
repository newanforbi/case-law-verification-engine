import assert from "node:assert/strict";
import { applyConsensus } from "../src/lib/verify/index";
import type { Consensus, LookupResult, SourceHit, SourceOutcome } from "../src/lib/verify/types";

/** A source hit with only the fields the consensus rules actually read. */
function hit(
  source: SourceHit["source"],
  outcome: SourceOutcome,
  caseName?: string,
): SourceHit {
  return {
    source,
    outcome,
    found: outcome === "FOUND",
    coverage: "",
    caseName,
  };
}

function verdict(
  opts: {
    name?: string;
    reporterPin?: string | null;
    wlPin?: string | null;
    sources: SourceHit[];
  },
): Consensus {
  const result: LookupResult = {
    query: "test",
    caseNameGuess: opts.name ?? "Richardson v. McKnight",
    reporterPin: opts.reporterPin === undefined ? "521 U.S. 399" : opts.reporterPin,
    wlPin: opts.wlPin ?? null,
    sources: opts.sources,
    consensus: "UNKNOWN",
    matchedName: "",
    matchedCitations: [],
  };
  return applyConsensus(result);
}

const NAME = "Richardson v. McKnight";

// Both sources carry the reporter and both resolve it.
assert.equal(
  verdict({
    sources: [hit("courtlistener", "FOUND", NAME), hit("case.law_static", "FOUND", NAME)],
  }),
  "FOUND",
);

// The recency case: CourtListener has it, CAP's digitized run stops short of
// the volume. One source that covers the corpus is enough — this must not be
// downgraded merely because the other source could not look.
assert.equal(
  verdict({
    sources: [
      hit("courtlistener", "FOUND", NAME),
      hit("case.law_static", "OUT_OF_SCOPE"),
    ],
  }),
  "FOUND",
);

// Genuine disagreement: both carry the corpus, only one found it.
assert.equal(
  verdict({
    sources: [hit("courtlistener", "FOUND", NAME), hit("case.law_static", "ABSENT")],
  }),
  "PARTIAL",
);

// The pin resolves to a different case.
assert.equal(
  verdict({
    sources: [hit("courtlistener", "FOUND", "Stump v. Sparkman")],
  }),
  "CAPTION_MISMATCH",
);

// A source that carries the reporter looked and it is not there.
assert.equal(
  verdict({
    sources: [hit("courtlistener", "ABSENT"), hit("case.law_static", "OUT_OF_SCOPE")],
  }),
  "NOT_FOUND",
);

// The Westlaw-only case: nothing was in a position to look, so this is a
// statement about our reach, never about the citation.
assert.equal(
  verdict({
    reporterPin: null,
    wlPin: "23545858",
    sources: [
      hit("courtlistener", "OUT_OF_SCOPE"),
      hit("case.law_static", "OUT_OF_SCOPE"),
    ],
  }),
  "OUT_OF_COVERAGE",
);

// An outage must never masquerade as absence.
assert.equal(
  verdict({
    sources: [
      hit("courtlistener", "UNAVAILABLE"),
      hit("case.law_static", "OUT_OF_SCOPE"),
    ],
  }),
  "UNCHECKED",
);

// One source down, the other carries the reporter and says no: still a real
// absence, because something was able to look.
assert.equal(
  verdict({
    sources: [hit("courtlistener", "UNAVAILABLE"), hit("case.law_static", "ABSENT")],
  }),
  "NOT_FOUND",
);

// Nothing parsed out of the line at all.
assert.equal(
  verdict({
    reporterPin: null,
    wlPin: null,
    sources: [
      hit("courtlistener", "OUT_OF_SCOPE"),
      hit("case.law_static", "OUT_OF_SCOPE"),
    ],
  }),
  "UNKNOWN",
);

console.log("OK consensus tests passed");
