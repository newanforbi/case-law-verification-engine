/**
 * Offline statute parse / URL / response-classifier fixtures (no network).
 */
import assert from "node:assert/strict";
import { extractCitationsFromText } from "../src/lib/citations/extract";
import {
  classifyLeginfoResponse,
  classifyLiiResponse,
  leginfoUrl,
  liiUrl,
  parseStatuteCitation,
  uscSectionPath,
} from "../src/lib/verify/statutes";

const usc = parseStatuteCitation("42 U.S.C. § 1983");
assert.ok(usc);
assert.equal(usc!.kind, "statute_federal");
assert.equal(usc!.title, "42");
assert.equal(usc!.section, "1983");
assert.equal(liiUrl(usc!.title!, usc!.section), "https://www.law.cornell.edu/uscode/text/42/1983");

const sub = parseStatuteCitation("42 U.S.C. § 1983(a)");
assert.ok(sub);
assert.equal(uscSectionPath(sub!.section), "1983/a");
assert.match(liiUrl(sub!.title!, sub!.section), /\/42\/1983\/a$/);

const veh = parseStatuteCitation("Vehicle Code § 40300.5");
assert.ok(veh);
assert.equal(veh!.kind, "statute_state");
assert.equal(veh!.lawCode, "VEH");
assert.equal(veh!.section, "40300.5");
assert.match(
  leginfoUrl(veh!.lawCode!, veh!.section),
  /lawCode=VEH&sectionNum=40300\.5/,
);

const pen = parseStatuteCitation("Pen. Code § 187");
assert.equal(pen?.lawCode, "PEN");

const ccp = parseStatuteCitation("Code of Civil Procedure § 430.10");
assert.equal(ccp?.lawCode, "CCP");

assert.equal(parseStatuteCitation("not a statute"), null);

const liiFound = classifyLiiResponse(
  200,
  "<html><title>42 U.S. Code § 1983</title><body>United States Code section 1983</body></html>",
  usc!,
);
assert.equal(liiFound.outcome, "FOUND");

const liiAbsent = classifyLiiResponse(404, "<html><h1>Page not found</h1></html>", usc!);
assert.equal(liiAbsent.outcome, "ABSENT");

const liiDown = classifyLiiResponse(-1, "", usc!);
assert.equal(liiDown.outcome, "UNAVAILABLE");

const legFound = classifyLeginfoResponse(
  200,
  `var sectionNum = '40300.5.'; sectionuid':'id_b6a92c67-6aad-11ed-823c-e74f056edb17'`,
  veh!,
);
assert.equal(legFound.outcome, "FOUND");

const legAbsent = classifyLeginfoResponse(
  200,
  `var sectionNum = ''; sectionuid':''`,
  veh!,
);
assert.equal(legAbsent.outcome, "ABSENT");

const sample = `
Also cite 42 U.S.C. § 1983 in the same brief.
Peace officers may arrest under Vehicle Code § 40300.5.
See also Pen. Code § 148.
`;
const extracted = extractCitationsFromText(sample);
assert.ok((extracted.countsByKind.statute_federal || 0) >= 1);
assert.ok((extracted.countsByKind.statute_state || 0) >= 2);
assert.ok(extracted.statuteQueue.some((c) => /1983/.test(c)));
assert.ok(extracted.statuteQueue.some((c) => /40300\.5/.test(c)));
// Case-law queue must stay statute-free.
assert.ok(!extracted.verifyQueue.some((c) => /1983|40300/.test(c)));
assert.ok(extracted.statuteItems.every((i) => i.kind.startsWith("statute_")));

console.log(
  JSON.stringify(
    {
      statuteQueue: extracted.statuteQueue,
      statuteItems: extracted.statuteItems,
    },
    null,
    2,
  ),
);
console.log("OK statute tests passed");
