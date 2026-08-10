/**
 * Offline CourtListener citation-lookup response mapping (no network / no token).
 */
import assert from "node:assert/strict";
import { mapCitationLookupEntry } from "../src/lib/verify/courtlistener";
import { parseReporter } from "../src/lib/verify/reporters";

const us = parseReporter("521 U.S. 399");
assert.ok(us);

const found = mapCitationLookupEntry(
  {
    citation: "521 U.S. 399",
    normalized_citations: ["521 U.S. 399"],
    status: 200,
    error_message: "",
    clusters: [
      {
        id: 118137,
        absolute_url: "/opinion/118137/richardson-v-mcknight/",
        case_name: "Richardson v. McKnight",
        citations: [
          { volume: "521", reporter: "U.S.", page: "399" },
          { volume: "117", reporter: "S. Ct.", page: "2100" },
        ],
      },
    ],
  },
  { nameGuess: "Richardson v. McKnight", rep: us },
);
assert.ok(found);
assert.equal(found!.outcome, "FOUND");
assert.equal(found!.clusterId, 118137);
assert.equal(found!.caseName, "Richardson v. McKnight");
assert.match(found!.notes ?? "", /via=citation-lookup/);
assert.equal(
  found!.url,
  "https://www.courtlistener.com/opinion/118137/richardson-v-mcknight/",
);

const absent = mapCitationLookupEntry(
  {
    citation: "66 Cal. App. 5th 200",
    normalized_citations: ["66 Cal. App. 5th 200"],
    status: 404,
    error_message: "Citation not found",
    clusters: [],
  },
  { nameGuess: "In re Leman", rep: parseReporter("66 Cal.App.5th 200") },
);
assert.equal(absent?.outcome, "ABSENT");

const badReporter = mapCitationLookupEntry(
  {
    citation: "33 Umbrella 422",
    status: 400,
    error_message: "Unknown reporter",
    clusters: [],
  },
  { nameGuess: "", rep: null },
);
assert.equal(badReporter?.outcome, "OUT_OF_SCOPE");

const throttled = mapCitationLookupEntry(
  {
    citation: "521 U.S. 399",
    status: 429,
    error_message: "Too many citations requested.",
    clusters: [],
  },
  { nameGuess: "Richardson v. McKnight", rep: us },
);
assert.equal(throttled?.outcome, "UNAVAILABLE");

const ambiguous = mapCitationLookupEntry(
  {
    citation: "1 H. 150",
    status: 300,
    normalized_citations: ["1 Handy 150", "1 Haw. 150"],
    clusters: [
      {
        id: 1,
        case_name: "Louis v. Steamboat Buckeye",
        absolute_url: "/opinion/1/louis/",
      },
      {
        id: 2,
        case_name: "Fell v. Parke",
        absolute_url: "/opinion/2/fell/",
      },
    ],
  },
  { nameGuess: "Fell v. Parke", rep: null },
);
assert.equal(ambiguous?.outcome, "FOUND");
assert.equal(ambiguous?.caseName, "Fell v. Parke");
assert.equal(ambiguous?.clusterId, 2);
assert.match(ambiguous?.notes ?? "", /clusters=2/);

assert.equal(
  mapCitationLookupEntry(
    { citation: "x", /* no status */ clusters: [] },
    { nameGuess: "", rep: null },
  ),
  null,
);

console.log(
  JSON.stringify(
    {
      found: found!.outcome,
      absent: absent!.outcome,
      badReporter: badReporter!.outcome,
      ambiguousCluster: ambiguous!.clusterId,
    },
    null,
    2,
  ),
);
console.log("OK citation-lookup tests passed");
