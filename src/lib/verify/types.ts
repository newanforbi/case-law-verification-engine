export type Consensus =
  | "FOUND"
  | "PARTIAL"
  | "CAPTION_MISMATCH"
  | "NOT_FOUND"
  | "UNKNOWN";

export interface SourceHit {
  source: "courtlistener" | "case.law_static";
  found: boolean;
  url?: string;
  caseName?: string;
  citations?: string[];
  notes?: string;
  httpStatus?: number | null;
}

export interface LookupResult {
  query: string;
  caseNameGuess: string;
  reporterPin: string | null;
  wlPin: string | null;
  sources: SourceHit[];
  consensus: Consensus;
  matchedName: string;
  matchedCitations: string[];
}

export interface VerifyResponse {
  generatedAt: string;
  methodology: {
    sources: string[];
    reference: string;
    controls: { positive: string; negative: string };
  };
  resultCount: number;
  counts: Record<Consensus, number>;
  results: LookupResult[];
}
