/** Client-safe constants (no Node fetch / CAP / CourtListener I/O). */

export {
  CONSENSUS_KINDS,
  HOLDING_FITS,
  METHOD_VERSION,
  SUPPORT_KINDS,
  tallyConsensus,
} from "./types";

export {
  DIRECT_BODY_MAX_BYTES,
  DIRECT_BODY_MAX_LABEL,
  MAX_PDF_BYTES,
  MAX_PDF_LABEL,
  describeBytes,
} from "@/lib/pdf/limits";

export const CONTROLS = {
  positive: "Richardson v. McKnight, 521 U.S. 399 (1997)",
  negative: "In re Leman, 66 Cal.App.5th 200",
} as const;

export const CONTROL_EXPECTATIONS = {
  positive: "FOUND" as const,
  negative: "NOT_FOUND" as const,
};

export const EXAMPLES = [
  CONTROLS.positive,
  CONTROLS.negative,
  "Stump v. Sparkman, 435 U.S. 349 (1978)",
  "In re Hudson, 1 Cal.App.4th 1 (2006)",
  "In re Hudson, 143 Cal.App.4th 1 (2006)",
  "Swift v. California, 384 F.3d 1184",
] as const;
