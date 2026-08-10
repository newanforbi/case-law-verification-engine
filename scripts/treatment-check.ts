/**
 * Offline subsequent-treatment / contrary-cluster fixtures (no network).
 */
import assert from "node:assert/strict";
import {
  buildContraryClusters,
  buildTreatmentReport,
  hasNegativeLanguage,
  toTreatmentCite,
} from "../src/lib/verify/treatment";
import type { LookupResult } from "../src/lib/verify/types";

assert.equal(hasNegativeLanguage("The court overruled Richardson"), true);
assert.equal(hasNegativeLanguage("We distinguish Richardson"), false);
assert.equal(hasNegativeLanguage("no longer good law after Smith"), true);

const cite = toTreatmentCite({
  caseName: "Smith v. Jones overruled prior immunity cases",
  dateFiled: "2020-01-01",
  court: "Ninth Circuit",
  absolute_url: "/opinion/1/smith/",
  cluster_id: 99,
  syllabus: "Discussion of absolute immunity.",
});
assert.equal(cite.negativeLanguage, true);
assert.equal(cite.url, "https://www.courtlistener.com/opinion/1/smith/");

const ok = buildTreatmentReport({
  consensus: "FOUND",
  clusterId: 118137,
  citeCount: 449,
  samples: [
    cite,
    toTreatmentCite({
      caseName: "Ordinary citing case",
      absolute_url: "/opinion/2/ordinary/",
      cluster_id: 2,
    }),
  ],
});
assert.equal(ok.status, "ok");
assert.equal(ok.citingCount, 449);
assert.equal(ok.samples.length, 2);
assert.equal(ok.negativeLanguageSamples.length, 1);

const skipped = buildTreatmentReport({ consensus: "NOT_FOUND" });
assert.equal(skipped.status, "skipped");

const noCluster = buildTreatmentReport({
  consensus: "FOUND",
  clOutcome: "FOUND",
});
assert.equal(noCluster.status, "out_of_coverage");

const unchecked = buildTreatmentReport({
  consensus: "FOUND",
  clusterId: 1,
  fetchError: "CourtListener cites: search returned HTTP 503.",
});
assert.equal(unchecked.status, "unchecked");

const base: LookupResult = {
  query: "Armondo v. Department of Motor Vehicles, 15 Cal.App.4th 1174 (1993)",
  caseNameGuess: "Armondo v. Department of Motor Vehicles",
  reporterPin: "15 Cal.App.4th 1174",
  wlPin: null,
  sources: [],
  consensus: "FOUND",
  matchedName: "Armondo v. Department of Motor Vehicles",
  matchedCitations: [],
  support: { verdict: "NO_QUOTE", quotes: [], pin: null },
  propositions: [
    {
      text: "But see Armondo, which cuts against a disappearing-arrest theory",
      role: "anticipates_contrary",
    },
  ],
  treatment: ok,
};

const supportOnly: LookupResult = {
  ...base,
  query: "Richardson v. McKnight, 521 U.S. 399 (1997)",
  propositions: [
    {
      text: "Absolute immunity does not extend to private prison guards",
      role: "supports",
    },
  ],
};

const clusters = buildContraryClusters([supportOnly, base]);
assert.equal(clusters.length, 1);
assert.match(clusters[0]!.citation, /Armondo/);
assert.equal(clusters[0]!.negativeLanguageSampleCount, 1);
assert.equal(clusters[0]!.citingCount, 449);

// Existence consensus is unrelated to treatment status.
assert.equal(base.consensus, "FOUND");
assert.notEqual(ok.status, "skipped");

console.log(
  JSON.stringify(
    {
      okStatus: ok.status,
      negativeSamples: ok.negativeLanguageSamples.length,
      contrary: clusters.map((c) => c.citation),
    },
    null,
    2,
  ),
);
console.log("OK treatment tests passed");
