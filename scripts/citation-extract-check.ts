import assert from "node:assert/strict";
import { extractCitationsFromText } from "../src/lib/citations/extract";

const sample = `
POINTS AND AUTHORITIES
See Richardson v. McKnight, 521 U.S. 399 (1997).
Judicial immunity: Stump v. Sparkman, 435 U.S. 349 (1978).
Negative control In re Leman, 66 Cal.App.5th 200 (2021).
Wrong pin In re Hudson, 1 Cal.App.4th 1 (2006).
Correct pin In re Hudson, 143 Cal.App.4th 1 (2006).
Westlaw: Burrell v. Jackson, 2003 WL 23545858.
Also cite 42 U.S.C. § 1983 in the same brief.
`;

const out = extractCitationsFromText(sample);
assert.ok(out.countsByKind.authority >= 4, `expected authorities, got ${JSON.stringify(out.countsByKind)}`);
assert.ok(
  out.verifyQueue.some((c) => c.includes("Richardson") && c.includes("521")),
  "Richardson authority missing",
);
assert.ok(
  out.verifyQueue.some((c) => c.includes("Leman") && c.includes("66")),
  "Leman authority missing",
);
assert.ok(
  out.verifyQueue.some((c) => /2003 WL 23545858/i.test(c)),
  "Westlaw authority missing",
);
// Statutes catalogued but not in verify queue
assert.ok((out.countsByKind.statute_federal || 0) >= 1);
assert.ok(!out.verifyQueue.some((c) => c.includes("1983")));

console.log(
  JSON.stringify(
    { countsByKind: out.countsByKind, verifyQueue: out.verifyQueue },
    null,
    2,
  ),
);
console.log("OK citation extract tests passed");
