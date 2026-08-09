"use client";

import { startTransition, useRef, useState } from "react";
import type {
  Consensus,
  LookupResult,
  QuoteMatch,
  SourceOutcome,
  Support,
  VerifyResponse,
} from "@/lib/verify";
import { CONSENSUS_KINDS, CONTROLS, EXAMPLES } from "@/lib/verify/client-constants";

type Mode = "paste" | "pdf";

interface PdfOccurrence {
  kind: string;
  citation: string;
  page: number;
  context: string;
}

interface PdfVerifyResponse extends VerifyResponse {
  document?: {
    fileName: string;
    pageCount: number;
    charCount: number;
    hasTextLayer: boolean;
  };
  extraction?: {
    totalMatches: number;
    countsByKind: Record<string, number>;
    verifyQueue: string[];
    verifyQueueCount: number;
    occurrences: PdfOccurrence[];
  };
  verified?: boolean;
  error?: string;
}

const STATUS_LABEL: Record<Consensus, string> = {
  FOUND: "Found",
  PARTIAL: "Sources disagree",
  CAPTION_MISMATCH: "Caption mismatch",
  NOT_FOUND: "Not found",
  OUT_OF_COVERAGE: "Not covered",
  UNCHECKED: "Not checked",
  UNKNOWN: "Unparsed",
};

const STATUS_HINT: Record<Consensus, string> = {
  FOUND:
    "A source that carries this reporter resolved the pin, with a compatible caption.",
  PARTIAL:
    "One source resolved the pin and another that carries the same reporter did not. Worth opening both.",
  CAPTION_MISMATCH:
    "The pin resolves, but to a different case caption — classic miscitation.",
  NOT_FOUND:
    "A source that carries this reporter was able to look and does not have it. This is the fabrication signal.",
  OUT_OF_COVERAGE:
    "Neither free source covers this citation — typically unpublished or Westlaw-only. Absence here is not evidence; check a paid database.",
  UNCHECKED:
    "A source was unreachable, so this citation was never actually checked. Re-run before relying on it.",
  UNKNOWN: "No reporter or Westlaw pin could be parsed from this line.",
};

const SUPPORT_LABEL: Record<Support, string> = {
  SUPPORTED: "Quote checks out",
  QUALIFIED: "Quote altered",
  UNSUPPORTED: "Quote not in opinion",
  INDETERMINATE: "Quote too short to judge",
  NO_QUOTE: "",
  UNCHECKED: "Quote not checked",
};

const SUPPORT_TONE: Record<Support, string> = {
  SUPPORTED: "status-FOUND",
  QUALIFIED: "status-CAPTION_MISMATCH",
  UNSUPPORTED: "status-NOT_FOUND",
  INDETERMINATE: "status-UNKNOWN",
  NO_QUOTE: "status-UNKNOWN",
  UNCHECKED: "status-UNCHECKED",
};

const QUOTE_LABEL: Record<QuoteMatch, string> = {
  VERBATIM: "Verbatim",
  ALTERED: "Altered",
  ABSENT: "Not in opinion",
  INDETERMINATE: "Inconclusive",
};

const QUOTE_TONE: Record<QuoteMatch, string> = {
  VERBATIM: "text-verified",
  ALTERED: "text-mismatch",
  ABSENT: "text-not-found",
  INDETERMINATE: "text-unknown",
};

/** A source reports what it was in a position to say, not merely hit or miss. */
const OUTCOME_LABEL: Record<SourceOutcome, string> = {
  FOUND: "Hit",
  ABSENT: "Searched, absent",
  OUT_OF_SCOPE: "Out of corpus",
  UNAVAILABLE: "Unreachable",
};

const OUTCOME_TONE: Record<SourceOutcome, string> = {
  FOUND: "text-verified",
  ABSENT: "text-not-found",
  OUT_OF_SCOPE: "text-unknown",
  UNAVAILABLE: "text-mismatch",
};

export function Verifier() {
  const [mode, setMode] = useState<Mode>("paste");
  const [text, setText] = useState(`${CONTROLS.positive}\n${CONTROLS.negative}`);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PdfVerifyResponse | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function runVerifyPaste(payload?: string) {
    const citations = (payload ?? text).trim();
    if (!citations) {
      setError("Paste at least one citation.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ citations }),
      });
      const json = (await res.json()) as PdfVerifyResponse;
      if (!res.ok) throw new Error(json.error || "Verification failed");
      startTransition(() => setData(json));
      document.getElementById("results")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  async function runVerifyPdf(selected?: File | null) {
    const pdf = selected ?? file;
    if (!pdf) {
      setError("Choose a PDF to upload.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", pdf);
      body.append("verify", "true");
      const res = await fetch("/api/verify-pdf", { method: "POST", body });
      const json = (await res.json()) as PdfVerifyResponse;
      if (!res.ok) throw new Error(json.error || "PDF verification failed");
      startTransition(() => setData(json));
      document.getElementById("results")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "PDF verification failed");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  function acceptFile(next: File | null) {
    if (!next) return;
    if (!next.name.toLowerCase().endsWith(".pdf") && next.type !== "application/pdf") {
      setError("Only PDF files are accepted.");
      return;
    }
    setError(null);
    setFile(next);
  }

  return (
    <div className="w-full max-w-3xl">
      <div className="mb-3 flex gap-1 border-b border-[var(--line)]">
        <ModeTab active={mode === "paste"} onClick={() => setMode("paste")} label="Paste cites" />
        <ModeTab active={mode === "pdf"} onClick={() => setMode("pdf")} label="Upload PDF" />
      </div>

      {mode === "paste" ? (
        <div className="textarea-shell rounded-sm border border-[var(--line)] bg-[rgba(11,20,16,0.55)] backdrop-blur-sm transition-shadow">
          <label htmlFor="citations" className="sr-only">
            Citations to verify
          </label>
          <textarea
            id="citations"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            spellCheck={false}
            placeholder="One citation per line — e.g. Richardson v. McKnight, 521 U.S. 399 (1997)"
            className="w-full resize-y bg-transparent px-4 py-4 font-[family-name:var(--font-outfit)] text-[15px] leading-relaxed text-parchment placeholder:text-parchment-dim/60 outline-none md:px-5 md:text-base"
          />
          <div className="flex flex-col gap-3 border-t border-[var(--line)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:px-5">
            <p className="text-xs text-parchment-dim md:text-sm">
              Probes CourtListener + CAP <span className="text-brass/80">static.case.law</span>
            </p>
            <ActionButton loading={loading} onClick={() => void runVerifyPaste()} label="Verify citations" />
          </div>
        </div>
      ) : (
        <div
          className={`textarea-shell rounded-sm border border-dashed bg-[rgba(11,20,16,0.55)] backdrop-blur-sm transition-shadow ${
            dragOver ? "border-brass/70" : "border-[var(--line)]"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            acceptFile(e.dataTransfer.files?.[0] ?? null);
          }}
        >
          <div className="px-4 py-8 text-center md:px-5 md:py-10">
            <p className="font-[family-name:var(--font-fraunces)] text-xl text-parchment md:text-2xl">
              Drop a pleading or brief
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-parchment-dim">
              We extract the text layer, pair case names to reporter/Westlaw pins,
              then verify each authority against CourtListener and CAP.
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="rounded-sm border border-brass/40 px-4 py-2 text-sm text-brass transition hover:bg-brass/10"
              >
                Choose PDF
              </button>
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(e) => acceptFile(e.target.files?.[0] ?? null)}
              />
              {file ? (
                <p className="text-sm text-parchment">
                  {file.name}{" "}
                  <span className="text-parchment-dim">
                    ({Math.max(1, Math.round(file.size / 1024))} KB)
                  </span>
                </p>
              ) : (
                <p className="text-sm text-parchment-dim">PDF up to 4 MB · text layer required</p>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-3 border-t border-[var(--line)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:px-5">
            <p className="text-xs text-parchment-dim md:text-sm">
              Extract → identify cites → verify (max 40 authorities)
            </p>
            <ActionButton
              loading={loading}
              onClick={() => void runVerifyPdf()}
              label="Parse & verify PDF"
              disabled={!file}
            />
          </div>
        </div>
      )}

      {mode === "paste" && (
        <div className="mt-4 flex flex-wrap gap-2">
          {EXAMPLES.slice(0, 4).map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => {
                setText(ex);
                void runVerifyPaste(ex);
              }}
              className="rounded-sm border border-[var(--line)] px-3 py-1.5 text-left text-xs text-parchment-dim transition hover:border-brass/50 hover:text-parchment"
            >
              {ex.length > 42 ? `${ex.slice(0, 42)}…` : ex}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              const batch = `${CONTROLS.positive}\n${CONTROLS.negative}`;
              setText(batch);
              void runVerifyPaste(batch);
            }}
            className="rounded-sm border border-brass/35 px-3 py-1.5 text-xs text-brass transition hover:bg-brass/10"
          >
            Run method controls
          </button>
        </div>
      )}

      {error && (
        <p className="mt-4 border-l-2 border-not-found pl-3 text-sm text-not-found" role="alert">
          {error}
        </p>
      )}

      {data && (
        <section id="results" className="mt-10 scroll-mt-8" aria-live="polite">
          {data.document && data.extraction && (
            <div className="mb-6 border border-[var(--line)] bg-ink-lift/70 px-4 py-4 md:px-5">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brass">
                Document
              </p>
              <p className="mt-1 font-[family-name:var(--font-fraunces)] text-xl text-parchment">
                {data.document.fileName}
              </p>
              <p className="mt-1 text-sm text-parchment-dim">
                {data.document.pageCount} pages · {data.extraction.totalMatches} citation
                matches · {data.extraction.verifyQueueCount} authorities queued for verify
              </p>
              {data.extraction.occurrences.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-brass-soft">
                    Show extracted citations with page context
                  </summary>
                  <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
                    {data.extraction.occurrences
                      .filter((o) => o.kind === "authority" || o.kind === "case_reporter" || o.kind === "case_westlaw")
                      .slice(0, 60)
                      .map((o, i) => (
                        <li key={`${o.citation}-${o.page}-${i}`} className="text-sm">
                          <span className="text-parchment-dim">p.{o.page}</span>{" "}
                          <span className="text-parchment">{o.citation}</span>
                          <span className="ml-2 text-[11px] uppercase tracking-wide text-brass/70">
                            {o.kind}
                          </span>
                        </li>
                      ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-[family-name:var(--font-fraunces)] text-2xl text-parchment md:text-3xl">
                Results
              </h2>
              <p className="mt-1 text-sm text-parchment-dim">
                {[
                  `${data.resultCount} probed`,
                  ...CONSENSUS_KINDS.filter((k) => data.counts[k] > 0).map(
                    (k) => `${data.counts[k]} ${STATUS_LABEL[k].toLowerCase()}`,
                  ),
                ].join(" · ")}
              </p>
            </div>
          </div>

          {data.results.length === 0 ? (
            <p className="text-sm text-parchment-dim">
              No case-law authorities were queued for verification from this input.
            </p>
          ) : (
            <ul className="space-y-4">
              {data.results.map((r, i) => (
                <li
                  key={`${r.query}-${i}`}
                  className="result-enter border border-[var(--line)] bg-ink-lift/70 px-4 py-4 md:px-5"
                  style={{ animationDelay: `${i * 70}ms` }}
                >
                  <ResultRow result={r} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function ModeTab({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2 text-sm transition ${
        active
          ? "border-b-2 border-brass text-parchment"
          : "text-parchment-dim hover:text-parchment"
      }`}
    >
      {label}
    </button>
  );
}

function ActionButton({
  loading,
  onClick,
  label,
  disabled,
}: {
  loading: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading || disabled}
      className="inline-flex items-center justify-center gap-2 rounded-sm bg-brass px-5 py-2.5 text-sm font-semibold tracking-wide text-ink transition hover:bg-brass-soft disabled:cursor-not-allowed disabled:opacity-70"
    >
      {loading ? (
        <>
          <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink/30 border-t-ink" />
          Working…
        </>
      ) : (
        label
      )}
    </button>
  );
}

function ResultRow({ result }: { result: LookupResult }) {
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-[family-name:var(--font-fraunces)] text-lg leading-snug text-parchment md:text-xl">
            {result.query}
          </p>
          <p className="mt-1 text-sm text-parchment-dim">
            Parsed as <span className="text-parchment/90">{result.caseNameGuess || "—"}</span>
            {result.reporterPin ? (
              <>
                {" "}
                · cite <span className="text-brass">{result.reporterPin}</span>
              </>
            ) : null}
            {result.wlPin ? (
              <>
                {" "}
                · WL <span className="text-brass">{result.wlPin}</span>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <span
            className={`status-${result.consensus} rounded-sm border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.08em]`}
          >
            {STATUS_LABEL[result.consensus]}
          </span>
          {/* Existence and support are separate questions, so they get
              separate chips: a real case can still be quoted for language it
              does not contain, and one verdict cannot carry both. */}
          {result.support.verdict !== "NO_QUOTE" ? (
            <span
              className={`${SUPPORT_TONE[result.support.verdict]} rounded-sm border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.08em]`}
            >
              {SUPPORT_LABEL[result.support.verdict]}
            </span>
          ) : null}
        </div>
      </div>

      <p className="mt-3 text-sm text-parchment-dim">{STATUS_HINT[result.consensus]}</p>

      {result.matchedName ? (
        <p className="mt-2 text-sm">
          Matched caption: <span className="text-parchment">{result.matchedName}</span>
          {result.matchedCitations?.length ? (
            <span className="text-parchment-dim">
              {" "}
              ({result.matchedCitations.slice(0, 3).join("; ")})
            </span>
          ) : null}
        </p>
      ) : null}

      {result.support.quotes.length || result.support.pin ? (
        <div className="mt-4 border-l-2 border-[var(--line)] pl-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brass">
            Quoted language
            {result.support.textSource ? (
              <span className="font-normal normal-case tracking-normal text-parchment-dim">
                {" "}
                · read from{" "}
                {result.support.textSource === "courtlistener"
                  ? "CourtListener"
                  : "CAP"}
              </span>
            ) : null}
          </p>

          {result.support.quotes.map((q, i) => (
            <div key={i} className="mt-2">
              <p className="text-sm text-parchment">
                <span className={`mr-2 text-xs font-medium ${QUOTE_TONE[q.match]}`}>
                  {QUOTE_LABEL[q.match]}
                </span>
                <span className="text-parchment-dim">“{q.passage}”</span>
              </p>
              {q.note ? (
                <p className="mt-1 text-xs leading-relaxed text-parchment-dim">{q.note}</p>
              ) : null}
            </div>
          ))}

          {result.support.pin ? (
            <p className="mt-2 text-sm text-parchment-dim">
              Pin page {result.support.pin.page}:{" "}
              {result.support.pin.present === null
                ? result.support.textSource
                  ? "the retrieved text carries no pagination markers, so this was not checked"
                  : "the opinion text could not be retrieved, so this was not checked"
                : result.support.pin.present
                  ? "present in the opinion"
                  : "not found in the opinion's pagination"}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {result.sources.map((s) => (
          <div key={s.source} className="border border-[var(--line)] bg-ink/40 px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brass">
                {s.source === "courtlistener" ? "CourtListener" : "CAP static.case.law"}
              </p>
              <span className={`text-xs font-medium ${OUTCOME_TONE[s.outcome]}`}>
                {OUTCOME_LABEL[s.outcome]}
              </span>
            </div>
            {s.caseName ? <p className="mt-2 text-sm text-parchment">{s.caseName}</p> : null}
            {s.coverage ? (
              <p className="mt-2 text-xs leading-relaxed text-parchment">{s.coverage}</p>
            ) : null}
            {s.notes ? (
              <p className="mt-1 text-xs leading-relaxed text-parchment-dim">{s.notes}</p>
            ) : null}
            {s.url ? (
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-xs text-brass-soft underline-offset-2 hover:underline"
              >
                Open source evidence
              </a>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
