import assert from "node:assert/strict";
import { extractCitationsFromText } from "../src/lib/citations/extract";

const sample = `
POINTS AND AUTHORITIES
Absolute immunity does not extend to private prison guards.
See Richardson v. McKnight, 521 U.S. 399, 402 (1997)
("private prison guards").
Judicial immunity remains the rule for judges acting in their judicial capacity:
Stump v. Sparkman, 435 U.S. 349 (1978).
Negative control In re Leman, 66 Cal.App.5th 200 (2021).
Wrong pin In re Hudson, 1 Cal.App.4th 1 (2006).
Correct pin In re Hudson, 143 Cal.App.4th 1 (2006).
Westlaw: Burrell v. Jackson, 2003 WL 23545858.
Also cite 42 U.S.C. § 1983 in the same brief.
Peace officers may arrest under Vehicle Code § 40300.5.
Local practice: L.R. 7-1 and Civil L.R. 3-4.
But see Armondo v. Department of Motor Vehicles, 15 Cal.App.4th 1174 (1993),
which cuts against a disappearing-arrest theory under the Vehicle Code.
`;

const out = extractCitationsFromText(sample);
assert.ok(out.countsByKind.authority >= 4, `expected authorities, got ${JSON.stringify(out.countsByKind)}`);
assert.ok(
  out.verifyQueue.some((c) => c.includes("Richardson") && c.includes("521")),
  "Richardson authority missing",
);
assert.ok(
  out.verifyQueue.some((c) => /399,\s*402/.test(c)),
  "Richardson pin page should be preserved",
);
assert.ok(
  out.verifyQueue.some((c) => c.includes("Leman") && c.includes("66")),
  "Leman authority missing",
);
assert.ok(
  out.verifyQueue.some((c) => /2003 WL 23545858/i.test(c)),
  "Westlaw authority missing",
);
// Statutes catalogued on a side queue — never in the case-law verify queue
assert.ok((out.countsByKind.statute_federal || 0) >= 1);
assert.ok((out.countsByKind.statute_state || 0) >= 1);
assert.ok(!out.verifyQueue.some((c) => c.includes("1983")));
assert.ok(out.statuteQueue.some((c) => c.includes("1983")));
assert.ok(out.statuteQueue.some((c) => /40300\.5/.test(c)));
assert.ok(
  out.statuteItems.some((i) => i.kind === "statute_federal" && /1983/.test(i.citation)),
);

const richardson = out.verifyItems.find((i) => i.citation.includes("Richardson"));
assert.ok(richardson, "verifyItems should include Richardson");
assert.ok(
  richardson!.passages.some((p) => /private prison guards/i.test(p)),
  "quoted passage near Richardson should be harvested",
);
assert.ok(
  richardson!.propositions.some((p) => /absolute immunity|private prison/i.test(p.text)),
  `Richardson should yield a filing proposition, got ${JSON.stringify(richardson!.propositions)}`,
);
assert.equal(richardson!.propositions[0]?.role, "supports");

const stump = out.verifyItems.find((i) => i.citation.includes("Stump"));
assert.ok(stump, "verifyItems should include Stump");
assert.ok(
  !stump!.passages.some((p) => /private prison guards/i.test(p)),
  "Richardson's quote must not be attributed to the next authority",
);
assert.ok(
  stump!.propositions.some((p) => /judicial immunity/i.test(p.text)),
  `Stump should harvest the immunity proposition, got ${JSON.stringify(stump!.propositions)}`,
);

const armondo = out.verifyItems.find((i) => /Armondo/i.test(i.citation));
assert.ok(armondo, "verifyItems should include Armondo");
assert.ok(
  armondo!.propositions.some((p) => p.role === "anticipates_contrary"),
  `Armondo should be flagged anticipates_contrary, got ${JSON.stringify(armondo!.propositions)}`,
);

// Local-rule pattern must stay tight — a loose L.R. matcher hangs real PDFs.
assert.ok((out.countsByKind.rule_local || 0) >= 1, "expected local rule hits");

console.log(
  JSON.stringify(
    {
      countsByKind: out.countsByKind,
      verifyQueue: out.verifyQueue,
      statuteQueue: out.statuteQueue,
      verifyItems: out.verifyItems.map((i) => ({
        citation: i.citation,
        passages: i.passages,
        propositions: i.propositions,
      })),
    },
    null,
    2,
  ),
);
console.log("OK citation extract tests passed");
