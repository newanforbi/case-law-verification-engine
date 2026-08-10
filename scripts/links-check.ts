/**
 * Offline checks for reference-link construction and metadata enrich.
 */
import assert from "node:assert/strict";
import {
  buildReferenceLinks,
  constructedReferenceLinks,
  courtLabelForPin,
  enrichLookupMetadata,
  parseDecisionYear,
} from "../src/lib/verify/links";
import { parseReporter } from "../src/lib/verify/reporters";
import type { LookupResult } from "../src/lib/verify/types";

assert.equal(parseDecisionYear("Richardson v. McKnight, 521 U.S. 399 (1997)"), "1997");
assert.equal(parseDecisionYear("In re Leman, 66 Cal.App.5th 200"), null);

const us = parseReporter("521 U.S. 399");
assert.ok(us);
assert.equal(courtLabelForPin(us), "U.S. Supreme Court");
const usLinks = constructedReferenceLinks(us!);
assert.ok(usLinks.some((l) => /supreme\.justia\.com\/cases\/federal\/us\/521\/399/.test(l.url)));
assert.ok(usLinks.some((l) => l.label.includes("Library of Congress")));
assert.ok(usLinks.every((l) => l.kind === "reference" && l.origin === "constructed"));

const cal = parseReporter("53 Cal.3d 753");
assert.ok(cal);
assert.equal(courtLabelForPin(cal), "California Supreme Court");
const calLinks = constructedReferenceLinks(cal!);
assert.ok(
  calLinks.some((l) =>
    l.url.includes("law.justia.com/cases/california/supreme-court/3d/53/753.html"),
  ),
);

const app = parseReporter("77 Cal.App.5th 517");
assert.ok(app);
assert.equal(courtLabelForPin(app), "California Court of Appeal");

const f3d = parseReporter("384 F.3d 1184");
assert.ok(f3d);
assert.equal(courtLabelForPin(f3d), "U.S. Court of Appeals");
assert.ok(
  constructedReferenceLinks(f3d!).some((l) =>
    l.url.includes("appellate-courts/F3/384/1184"),
  ),
);

const base: LookupResult = {
  query: "Richardson v. McKnight, 521 U.S. 399 (1997)",
  caseNameGuess: "Richardson v. McKnight",
  reporterPin: "521 U.S. 399",
  wlPin: null,
  sources: [
    {
      source: "courtlistener",
      outcome: "FOUND",
      found: true,
      coverage: "carried",
      url: "https://www.courtlistener.com/opinion/123/richardson-v-mcknight/",
    },
    {
      source: "case.law_static",
      outcome: "FOUND",
      found: true,
      coverage: "carried",
      url: "https://static.case.law/us/521/html/0399-01.html",
    },
  ],
  consensus: "FOUND",
  matchedName: "Richardson v. McKnight",
  matchedCitations: ["521 U.S. 399"],
  support: {
    verdict: "NO_QUOTE",
    quotes: [],
    pin: null,
    textUrl: "https://static.case.law/us/521/html/0399-01.html",
  },
};

const links = buildReferenceLinks(base);
assert.ok(links.some((l) => l.kind === "primary" && l.label === "CourtListener"));
assert.ok(links.some((l) => l.kind === "primary" && l.label === "CAP static.case.law"));
assert.ok(links.some((l) => l.kind === "reference" && /justia/i.test(l.label)));
// Dedup opinion text URL against CAP case URL
assert.equal(
  links.filter((l) => l.url === base.support.textUrl).length,
  1,
);

const enriched = enrichLookupMetadata({ ...base, support: { ...base.support } });
assert.equal(enriched.decisionYear, "1997");
assert.equal(enriched.courtLabel, "U.S. Supreme Court");
assert.ok((enriched.links?.length ?? 0) >= 3);

// Search API endpoints must not appear as open links
const withSearch: LookupResult = {
  ...base,
  sources: [
    {
      source: "courtlistener",
      outcome: "ABSENT",
      found: false,
      coverage: "empty",
      url: "https://www.courtlistener.com/api/rest/v4/search/",
    },
  ],
  consensus: "NOT_FOUND",
  matchedName: "",
  support: { verdict: "NO_QUOTE", quotes: [], pin: null },
};
const absentLinks = buildReferenceLinks(withSearch);
assert.ok(!absentLinks.some((l) => l.url.includes("/api/")));
assert.ok(absentLinks.every((l) => l.kind === "reference"));

console.log(
  JSON.stringify(
    {
      usLinkCount: usLinks.length,
      enrichedYear: enriched.decisionYear,
      openLabels: enriched.links?.map((l) => `${l.kind}:${l.label}`),
    },
    null,
    2,
  ),
);
console.log("OK links tests passed");
