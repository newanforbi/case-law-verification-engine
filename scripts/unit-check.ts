import assert from "node:assert/strict";
import { parseReporter, guessName } from "../src/lib/verify/reporters";
import { namesCompatible } from "../src/lib/verify/names";
import { parseCitationInput } from "../src/lib/verify/index";

const richardson = parseReporter("Richardson v. McKnight, 521 U.S. 399 (1997)");
assert.equal(richardson?.pin, "521 U.S. 399");
assert.equal(richardson?.slug, "us");

const hudsonBad = parseReporter("In re Hudson, 1 Cal.App.4th 1 (2006)");
assert.equal(hudsonBad?.pin, "1 Cal. App. 4th 1");

const hudsonGood = parseReporter("In re Hudson, 143 Cal.App.4th 1 (2006)");
assert.equal(hudsonGood?.pin, "143 Cal. App. 4th 1");

assert.equal(
  guessName("Richardson v. McKnight, 521 U.S. 399 (1997)"),
  "Richardson v. McKnight",
);
assert.equal(guessName("In re Leman, 66 Cal.App.5th 200"), "In re Leman");
assert.equal(
  guessName("In re Hudson, 143 Cal.App.4th 1 (2006)"),
  "In re Hudson",
);
assert.ok(namesCompatible("Richardson v. McKnight", "Richardson v. McKnight"));
assert.ok(
  namesCompatible(
    "California Highway Patrol v. Superior Court",
    "Department of California Highway Patrol v. Superior Court",
  ),
);
assert.equal(
  namesCompatible(
    "Home v. Dep't of Health Care Services",
    "California Ass'n for Health Services at Home v. State Department of Health Care Services",
  ),
  false,
);
assert.equal(
  namesCompatible(
    "Soranno's Gasco, Inc. v. Morgan Hill Unified",
    "Soranno's Gasco, Inc. v. Morgan",
  ),
  false,
);
assert.ok(
  namesCompatible(
    "Western/California, Ltd. v. Dry Creek",
    "Western/California, Ltd. v. Dry Creek Joint Elementary School District",
  ),
);

const parsed = parseCitationInput(`1. Richardson v. McKnight, 521 U.S. 399
- In re Leman, 66 Cal.App.5th 200`);
assert.deepEqual(parsed, [
  "Richardson v. McKnight, 521 U.S. 399",
  "In re Leman, 66 Cal.App.5th 200",
]);

console.log("OK unit tests passed");
