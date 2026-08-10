/**
 * Structured coverage: machine-readable envelope alongside the prose `coverage`
 * string. Report tooling and outbound exports need to filter "outside the corpus"
 * without parsing English.
 */

import type { ReporterPin } from "./reporters";

export type CoverageReason =
  | "carried"
  | "searched_empty"
  | "absent_volume"
  | "westlaw_only"
  | "no_pin"
  | "unreachable"
  | "unsupported_form";

export type Jurisdiction =
  | "us_supreme"
  | "us_federal"
  | "california"
  | "military"
  | "unknown";

export interface CoverageEnvelope {
  /** Whether this source's corpus includes the citation's reporter/volume. */
  inCorpus: boolean | null;
  reason: CoverageReason;
  reporter?: string;
  volume?: string;
  jurisdiction: Jurisdiction;
}

export function jurisdictionForSlug(slug: string | undefined): Jurisdiction {
  if (!slug) return "unknown";
  if (slug === "us" || slug === "s-ct" || slug === "l-ed-2d") return "us_supreme";
  if (slug.startsWith("f") || slug === "frd") return "us_federal";
  if (slug.startsWith("cal")) return "california";
  if (slug === "mj") return "military";
  return "unknown";
}

export function envelopeForReporter(
  rep: ReporterPin | null,
  partial: Omit<CoverageEnvelope, "jurisdiction" | "reporter" | "volume"> &
    Partial<Pick<CoverageEnvelope, "reporter" | "volume">>,
): CoverageEnvelope {
  return {
    inCorpus: partial.inCorpus,
    reason: partial.reason,
    reporter: partial.reporter ?? rep?.label,
    volume: partial.volume ?? rep?.volume,
    jurisdiction: jurisdictionForSlug(rep?.slug),
  };
}
