import assert from "node:assert/strict";
import {
  extractQuotedPassages,
  matchPassage,
  pageLabelsIn,
  parsePinCite,
} from "../src/lib/verify/quotes";

/** A stand-in opinion, with the typesetting a real one arrives with. */
const OPINION = `
*399 JUSTICE BREYER delivered the opinion of the Court.

*404 The question is whether prison guards who are employees of a private
prison management firm are entitled to a qualified immunity from suit by
prisoners charging a violation of 42 U. S. C. §1983. We hold that they are
not entitled to qualified immunity — history does not reveal a "firmly
rooted" tradition of immunity applicable to privately employed prison
guards.

*412 The government's immunity rationale, we have said, is "to protect the
public from unwarranted timidity on the part of public officials."
`;

// Straight and curly quotes both come out.
assert.deepEqual(extractQuotedPassages('The court said "firmly rooted" today.'), [
  "firmly rooted",
]);
assert.deepEqual(extractQuotedPassages("It held “no immunity here” again."), [
  "no immunity here",
]);
assert.ok(
  extractQuotedPassages("Holding (‘public entity liability’) stands.").some((p) =>
    /public entity liability/i.test(p),
  ),
);
assert.ok(
  extractQuotedPassages('See id. ("private prison guards").').some((p) =>
    /private prison guards/i.test(p),
  ),
);

// Exact language, differing only in line wrapping.
assert.equal(
  matchPassage(
    "history does not reveal a \"firmly rooted\" tradition of immunity",
    OPINION,
  ).match,
  "VERBATIM",
);

// The standard bracketed substitution: the filing capitalizes mid-sentence.
const bracketed = matchPassage(
  "[H]istory does not reveal a firmly rooted tradition of immunity",
  OPINION,
);
assert.equal(bracketed.match, "ALTERED");
assert.match(bracketed.note ?? "", /bracketed alteration/);

// Elision across a long span, with the segments still in order.
const elided = matchPassage(
  "prison guards who are employees of a private prison management firm ... are entitled to a qualified immunity",
  OPINION,
);
assert.equal(elided.match, "ALTERED");
assert.match(elided.note ?? "", /elision/);

// Segments present but in the wrong order is not a match.
assert.equal(
  matchPassage(
    "entitled to a qualified immunity ... prison guards who are employees",
    OPINION,
  ).match,
  "ABSENT",
);

// Editorial asides belong to the brief, not the opinion.
assert.equal(
  matchPassage(
    "unwarranted timidity on the part of public officials [emphasis added]",
    OPINION,
  ).match,
  "ALTERED",
);

// The failure this whole module exists for: a plausible sentence, in a real
// case, that the opinion never says.
assert.equal(
  matchPassage(
    "private prison guards are entitled to the same immunity as public officers",
    OPINION,
  ).match,
  "ABSENT",
);

// Too short for absence to carry information.
assert.equal(matchPassage("immunity", OPINION).match, "VERBATIM");
assert.equal(matchPassage("wholly novel", OPINION).match, "INDETERMINATE");

// Pin cites: the page the proposition is attributed to, not the first page.
assert.deepEqual(parsePinCite("Richardson v. McKnight, 521 U.S. 399, 404 (1997)", "399"), {
  firstPage: "399",
  pinPage: "404",
});
assert.equal(parsePinCite("Richardson v. McKnight, 521 U.S. 399 (1997)", "399"), null);
assert.equal(parsePinCite("Stump v. Sparkman, 435 U.S. 349, 349 (1978)", "349"), null);

// Star pagination, and the CAP page-label markup.
const labels = pageLabelsIn(OPINION);
assert.ok(labels.has("399") && labels.has("404") && labels.has("412"));
assert.equal(labels.has("500"), false);
assert.ok(pageLabelsIn('<a id="p404" data-label="404">*404</a>').has("404"));

// No markers at all must not be read as "the page is missing" — that is the
// caller's cue to report the pin unchecked.
assert.equal(pageLabelsIn("An opinion with no pagination markers.").size, 0);

console.log("OK quote tests passed");
