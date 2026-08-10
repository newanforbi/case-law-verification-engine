/**
 * Holding-use audit: does the opinion fairly support the filing's proposition?
 *
 * Separate from existence (is the case real?) and from quote support (is this
 * exact language in the opinion?). Heuristic v1 — token/phrase overlap plus
 * overbreadth cues. Set HOLDING_AUDITOR=llm later behind the same interface.
 */
import type {
  Consensus,
  HoldingFit,
  HoldingPropositionFinding,
  HoldingReport,
  Proposition,
} from "./types";

export type HoldingAuditorMode = "heuristic" | "llm";

const STOP = new Set(
  [
    "a",
    "an",
    "the",
    "and",
    "or",
    "of",
    "to",
    "in",
    "on",
    "for",
    "by",
    "with",
    "as",
    "at",
    "from",
    "that",
    "this",
    "these",
    "those",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "has",
    "have",
    "had",
    "do",
    "does",
    "did",
    "not",
    "no",
    "nor",
    "but",
    "if",
    "then",
    "than",
    "so",
    "such",
    "into",
    "under",
    "over",
    "about",
    "between",
    "through",
    "during",
    "before",
    "after",
    "above",
    "below",
    "which",
    "who",
    "whom",
    "whose",
    "what",
    "when",
    "where",
    "why",
    "how",
    "its",
    "it",
    "their",
    "there",
    "here",
    "also",
    "only",
    "just",
    "see",
    "cf",
    "accord",
    "contra",
    "held",
    "holding",
    "court",
    "courts",
    "case",
    "cases",
    "v",
  ].map((w) => w),
);

/**
 * Filing-side stretch cues. Keep these stronger than bare "all"/"absolute",
 * which appear in ordinary holdings (e.g. Stump's "clear absence of all
 * jurisdiction" / "absolute immunity").
 */
const OVERBREADTH =
  /\b(?:always|never|categorically|without\s+exception|under\s+no\s+circumstances|in\s+(?:any|every|all)\s+cases?|no\s+circumstances|absolutely)\b/i;

const LIMITING_IN_OPINION =
  /\b(?:unless|except|however|only\s+when|only\s+if|narrow(?:ly)?|limited|does\s+not\s+(?:mean|hold|extend)|we\s+do\s+not\s+(?:hold|decide)|in\s+this\s+context)\b/i;

function auditorMode(): HoldingAuditorMode {
  const raw = (process.env.HOLDING_AUDITOR || "heuristic").toLowerCase();
  return raw === "llm" ? "llm" : "heuristic";
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contentWords(s: string): string[] {
  return normalize(s)
    .split(" ")
    .filter((w) => w.length >= 4 && !STOP.has(w));
}

/** Longest opinion excerpt that shares a content-word run with the proposition. */
function bestExcerpt(proposition: string, opinionText: string): string | undefined {
  const words = contentWords(proposition);
  if (words.length < 2) return undefined;
  const hay = normalize(opinionText);
  // Try progressively shorter windows of meaningful words.
  for (let len = Math.min(6, words.length); len >= 2; len--) {
    for (let i = 0; i <= words.length - len; i++) {
      const phrase = words.slice(i, i + len).join(" ");
      const at = hay.indexOf(phrase);
      if (at === -1) continue;
      // Map back roughly into original text via a case-insensitive search.
      const re = new RegExp(
        phrase
          .split(" ")
          .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("[\\s\\S]{0,24}"),
        "i",
      );
      const m = re.exec(opinionText);
      if (!m) continue;
      const start = Math.max(0, m.index - 40);
      const end = Math.min(opinionText.length, m.index + m[0].length + 80);
      return opinionText.slice(start, end).replace(/\s+/g, " ").trim();
    }
  }
  return undefined;
}

function overlapScore(proposition: string, opinionText: string): {
  ratio: number;
  hits: number;
  total: number;
} {
  const words = contentWords(proposition);
  if (!words.length) return { ratio: 0, hits: 0, total: 0 };
  const hay = normalize(opinionText);
  let hits = 0;
  for (const w of words) {
    if (hay.includes(w)) hits += 1;
  }
  return { ratio: hits / words.length, hits, total: words.length };
}

function citationExists(consensus: Consensus): boolean {
  return (
    consensus === "FOUND" ||
    consensus === "PARTIAL" ||
    consensus === "CAPTION_MISMATCH"
  );
}

function revisionFor(
  fit: HoldingFit,
  proposition: Proposition,
): string | undefined {
  switch (fit) {
    case "supported":
      return undefined;
    case "aggressive":
      return `Narrow the claim: keep what the opinion actually addresses, and avoid stretching “${proposition.text.slice(0, 80)}${proposition.text.length > 80 ? "…" : ""}” beyond the holding.`;
    case "overstated":
      return "Tone down absolute language (always/never/clear absence) unless the opinion uses the same breadth.";
    case "unsupported":
      return proposition.role === "anticipates_contrary"
        ? "Confirm the contrary holding in the opinion text, or drop the anticipated-authority framing."
        : "Remove or rewrite: the retrieved opinion text does not support this proposition.";
    case "unchecked":
      return "Could not read opinion text — confirm the proposition manually against a full reporter copy.";
    default:
      return undefined;
  }
}

function filingOverbreadth(proposition: string, opinionText: string): boolean {
  const m = proposition.match(OVERBREADTH);
  if (!m) return false;
  // If the opinion itself uses the same breadth cue, the filing is echoing
  // doctrine — not inventing it.
  const cue = normalize(m[0]);
  return cue.length > 0 && !normalize(opinionText).includes(cue);
}

function scoreOne(
  proposition: Proposition,
  opinionText: string,
): HoldingPropositionFinding {
  const { ratio, hits, total } = overlapScore(proposition.text, opinionText);
  const excerpt = bestExcerpt(proposition.text, opinionText);
  const overbroad = filingOverbreadth(proposition.text, opinionText);
  const opinionLimits = LIMITING_IN_OPINION.test(opinionText);

  let fit: HoldingFit;
  if (total === 0) {
    fit = "unchecked";
  } else if (ratio >= 0.55 && hits >= 3 && !overbroad) {
    fit = "supported";
  } else if (ratio >= 0.55 && hits >= 3 && overbroad) {
    fit = opinionLimits ? "overstated" : "aggressive";
  } else if (ratio >= 0.35 && hits >= 2) {
    fit = overbroad && opinionLimits ? "overstated" : "aggressive";
  } else if (ratio > 0 && hits >= 1 && proposition.role === "anticipates_contrary") {
    // Filing flags contrary authority — weak textual overlap is still a signal
    // the case is being used for a limiting point; treat as aggressive, not fake.
    fit = "aggressive";
  } else {
    fit = "unsupported";
  }

  const note =
    fit === "supported"
      ? `Heuristic overlap ${hits}/${total} content words in the opinion.`
      : fit === "unchecked"
        ? "Not enough content words to score."
        : `Heuristic overlap ${hits}/${total} content words` +
          (overbroad ? "; overbreadth cue in proposition" : "") +
          (opinionLimits && overbroad ? "; opinion uses limiting language" : "") +
          ".";

  return {
    proposition,
    fit,
    excerpt,
    suggestedRevision: revisionFor(fit, proposition),
    note,
  };
}

function overallFit(findings: HoldingPropositionFinding[]): HoldingFit {
  if (!findings.length) return "unchecked";
  const order: HoldingFit[] = [
    "unsupported",
    "overstated",
    "aggressive",
    "supported",
    "unchecked",
  ];
  for (const fit of order) {
    if (findings.some((f) => f.fit === fit)) return fit;
  }
  return "unchecked";
}

export interface EvaluateHoldingInput {
  propositions: Proposition[];
  opinionText: string | null | undefined;
  consensus: Consensus;
  textUrl?: string;
  textSource?: "courtlistener" | "case.law_static";
}

/**
 * Score filing propositions against retrieved opinion text.
 * Pure when opinion text is supplied — safe for offline tests.
 */
export function evaluateHoldingUse(input: EvaluateHoldingInput): HoldingReport {
  const mode = auditorMode();
  const base = {
    auditor: mode,
    textSource: input.textSource,
    textUrl: input.textUrl,
  };

  if (!input.propositions.length) {
    return {
      ...base,
      overall: "unchecked",
      findings: [],
      note: "No filing propositions were harvested for this authority.",
    };
  }

  if (!citationExists(input.consensus)) {
    return {
      ...base,
      overall: "unsupported",
      findings: input.propositions.map((proposition) => ({
        proposition,
        fit: "unsupported" as const,
        suggestedRevision:
          "Existence check did not resolve this authority — do not rely on the proposition until the cite is confirmed.",
        note: `Existence verdict was ${input.consensus}.`,
      })),
      note: "Holding use was not assessed against opinion text because the citation did not resolve as found.",
    };
  }

  if (!input.opinionText || input.opinionText.replace(/\s+/g, "").length < 80) {
    return {
      ...base,
      overall: "unchecked",
      findings: input.propositions.map((proposition) => ({
        proposition,
        fit: "unchecked" as const,
        suggestedRevision: revisionFor("unchecked", proposition),
        note: "Opinion text unavailable.",
      })),
      note: "Could not retrieve opinion text for holding-use scoring.",
    };
  }

  if (mode === "llm") {
    // v1 stub: fall through to heuristic until an LLM scorer is wired.
  }

  const findings = input.propositions.map((p) =>
    scoreOne(p, input.opinionText!),
  );
  return {
    ...base,
    overall: overallFit(findings),
    findings,
    note: "Heuristic holding audit (HOLDING_AUDITOR=heuristic). Not a substitute for reading the opinion.",
  };
}
