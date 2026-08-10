/**
 * Offline holding-use audit fixtures (no network).
 *
 * Existence and quote support stay out of scope — this only scores filing
 * propositions against supplied opinion text.
 */
import assert from "node:assert/strict";
import { evaluateHoldingUse } from "../src/lib/verify/holding";
import { HOLDING_FITS } from "../src/lib/verify/types";

assert.ok(HOLDING_FITS.includes("supported"));
assert.ok(HOLDING_FITS.includes("overstated"));

const stumpOpinion = `
  The Court held that judges of courts of superior or general jurisdiction are
  not liable to civil actions for their judicial acts, even when such acts are
  in excess of their jurisdiction, and are alleged to have been done
  maliciously or corruptly. A judge will be subject to liability only when he
  has acted in the clear absence of all jurisdiction. We do not hold that
  absolute immunity extends to every act a judge might take, or under all
  circumstances; the immunity is limited to judicial acts.
`.repeat(2);

const overstated = evaluateHoldingUse({
  consensus: "FOUND",
  opinionText: stumpOpinion,
  propositions: [
    {
      text: "Judges always have absolute immunity from suit in all cases without exception.",
      role: "supports",
    },
  ],
});
assert.equal(overstated.overall, "overstated");
assert.equal(overstated.findings[0]?.fit, "overstated");
assert.ok(overstated.findings[0]?.suggestedRevision);
assert.match(overstated.findings[0]!.suggestedRevision!, /absolute|Tone down/i);

const supported = evaluateHoldingUse({
  consensus: "FOUND",
  opinionText: stumpOpinion,
  propositions: [
    {
      text: "A judge is subject to liability only when acting in the clear absence of all jurisdiction.",
      role: "supports",
    },
  ],
});
assert.equal(supported.overall, "supported");
assert.equal(supported.findings[0]?.fit, "supported");
assert.equal(supported.findings[0]?.suggestedRevision, undefined);

const unsupported = evaluateHoldingUse({
  consensus: "FOUND",
  opinionText: stumpOpinion,
  propositions: [
    {
      text: "Private prison guards enjoy the same qualified immunity as state correctional officers under the Eighth Amendment deliberate indifference standard.",
      role: "supports",
    },
  ],
});
assert.equal(unsupported.overall, "unsupported");

const notFound = evaluateHoldingUse({
  consensus: "NOT_FOUND",
  opinionText: stumpOpinion,
  propositions: [
    {
      text: "A judge is subject to liability only when acting in the clear absence of all jurisdiction.",
      role: "supports",
    },
  ],
});
assert.equal(notFound.overall, "unsupported");
assert.match(notFound.note ?? "", /did not resolve/i);

const noText = evaluateHoldingUse({
  consensus: "FOUND",
  opinionText: null,
  propositions: [
    {
      text: "Judicial immunity covers judicial acts even when alleged to be malicious.",
      role: "supports",
    },
  ],
});
assert.equal(noText.overall, "unchecked");

const emptyProps = evaluateHoldingUse({
  consensus: "FOUND",
  opinionText: stumpOpinion,
  propositions: [],
});
assert.equal(emptyProps.overall, "unchecked");
assert.match(emptyProps.note ?? "", /No filing propositions/i);

// Holding audit must not invent existence — caller supplies consensus.
assert.notEqual(unsupported.overall, "supported");

console.log("OK holding tests passed");
