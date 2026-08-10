"use client";

import { startTransition, useRef, useState } from "react";
import type {
  Consensus,
  ControlRun,
  LookupResult,
  QuoteMatch,
  SourceOutcome,
  Support,
  VerifyResponse,
} from "@/lib/verify";
import { intakeFiling } from "@/lib/pdf/client-upload";
import { filingFormatFromName } from "@/lib/filing/kinds";
import { reportToWordHtml, reportWordFileName } from "@/lib/report/export-word";
import { buildReport, reportFileName } from "@/lib/report/report";
import {
  CONSENSUS_KINDS,
  CONTROL_EXPECTATIONS,
  CONTROLS,
  EXAMPLES,
  METHOD_VERSION,
  tallyConsensus,
  MAX_PDF_BYTES,
  MAX_PDF_LABEL,
  describeBytes,
} from "@/lib/verify/client-constants";

type Mode = "paste" | "pdf";

interface PdfOccurrence {
  kind: string;
  citation: string;
  page: number;
  context: string;
}

interface VerifyItemPayload {
  citation: string;
  passages?: string[];
}

interface PdfVerifyResponse extends VerifyResponse {
  document?: {
    fileName: string;
    format?: "pdf" | "docx";
    pageCount: number;
    charCount: number;
    hasTextLayer: boolean;
    textSource?: "text_layer" | "ocr" | "docx";
    ocr?: { pagesProcessed: number; pagesSkipped: number; elapsedMs: number };
  };
  extraction?: {
    totalMatches: number;
    countsByKind: Record<string, number>;
    verifyQueue: string[];
    verifyItems?: VerifyItemPayload[];
    verifyQueueCount: number;
    occurrences: PdfOccurrence[];
  };
  verified?: boolean;
  error?: string;
  diagnostics?: {
    elapsedMs: number;
    queued: number;
    verifiedInRequest: number;
    textSource?: "text_layer" | "ocr" | "docx";
    ocr?: { pagesProcessed: number; pagesSkipped: number; elapsedMs: number };
  };
}

/**
 * How many authorities go up in one verification request.
 *
 * Each one makes several upstream calls with deliberate pauses between them,
 * so a brief with forty authorities is minutes of work — far past what a
 * serverless function will sit through, and the platform kills it with an
 * error page rather than anything this app can catch. Extraction is fast, so
 * the document is parsed in one request and the verifying is done in batches
 * small enough that no single request can outlive its limit.
 */
const VERIFY_BATCH = 5;

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

/**
 * Read a response that might not be ours.
 *
 * A request can fail before it reaches the route — a body over the platform's
 * limit, a function that ran long, a gateway hiccup — and what comes back then
 * is an HTML error page. Calling res.json() on that throws a parse error about
 * a "<" character, which tells the user nothing about what went wrong. So the
 * body is read as text first, and when it will not parse, the status is the
 * only honest thing left to explain.
 */
async function readJson<T>(res: Response, fallback: string): Promise<T> {
  const body = await res.text();
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(explainNonJson(res.status, fallback));
  }
}

function explainNonJson(status: number, fallback: string): string {
  if (status === 413)
    return `That file was rejected as too large for a direct upload. Files up to ${MAX_PDF_LABEL} are accepted via Blob storage.`;
  if (status === 504 || status === 408)
    return "The server took too long and gave up. Try a shorter document, or one with fewer authorities.";
  if (status === 502 || status === 503)
    return "The server was unavailable. Nothing was checked — try again in a moment.";
  if (status === 500)
    return `${fallback}: the extract engine crashed before it could answer. Retry once; if it persists, paste the citations instead.`;
  return `${fallback} (HTTP ${status}). The server returned a page instead of a result.`;
}

export function Verifier() {
  const [mode, setMode] = useState<Mode>("pdf");
  const [text, setText] = useState(`${CONTROLS.positive}\n${CONTROLS.negative}`);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PdfVerifyResponse | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function emptyMethodology(): VerifyResponse["methodology"] {
    return {
      version: METHOD_VERSION,
      sources: [
        "CourtListener /api/rest/v4/search/",
        "Caselaw Access Project static.case.law (CasesMetadata.json + HTML)",
      ],
      reference: "",
      controls: {
        positive: CONTROLS.positive,
        negative: CONTROLS.negative,
        expected: {
          positive: CONTROL_EXPECTATIONS.positive,
          negative: CONTROL_EXPECTATIONS.negative,
        },
      },
    };
  }

  async function fetchControlRun(): Promise<{
    controlRun?: ControlRun;
    methodology?: VerifyResponse["methodology"];
    methodVersion?: string;
  }> {
    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ controlsOnly: true }),
      });
      const body = await readJson<VerifyResponse>(res, "Method controls failed");
      if (!res.ok) return {};
      return {
        controlRun: body.controlRun,
        methodology: body.methodology,
        methodVersion: body.methodVersion,
      };
    } catch {
      return {};
    }
  }

  async function verifyInBatches(
    items: VerifyItemPayload[],
    base: Partial<PdfVerifyResponse> = {},
  ) {
    const collected: LookupResult[] = [];
    // One control pair for the whole session — travels with the report.
    const controls = await fetchControlRun();
    for (let i = 0; i < items.length; i += VERIFY_BATCH) {
      const slice = items.slice(i, i + VERIFY_BATCH);
      setProgress({ done: i, total: items.length });
      const batchRes = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: slice }),
      });
      const batch = await readJson<VerifyResponse>(batchRes, "Verification failed");
      if (!batchRes.ok) {
        throw new Error(
          (batch as { error?: string }).error ||
            `Verification failed after ${collected.length} of ${items.length} authorities.`,
        );
      }
      collected.push(...batch.results);
      const snapshot = [...collected];
      startTransition(() =>
        setData({
          generatedAt: batch.generatedAt,
          methodVersion: controls.methodVersion ?? batch.methodVersion ?? METHOD_VERSION,
          methodology: controls.methodology ?? batch.methodology ?? emptyMethodology(),
          controlRun: controls.controlRun,
          ...base,
          verified: true,
          results: snapshot,
          resultCount: snapshot.length,
          counts: tallyConsensus(snapshot),
        }),
      );
    }
    setProgress(null);
  }

  async function runVerifyPaste(payload?: string) {
    const citations = (payload ?? text).trim();
    if (!citations) {
      setError("Paste at least one citation.");
      return;
    }
    setLoading(true);
    setError(null);
    setProgress(null);
    try {
      const items = citations
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((citation) => ({ citation }));
      if (!items.length) {
        setError("Paste at least one citation.");
        return;
      }
      startTransition(() =>
        setData({
          generatedAt: new Date().toISOString(),
          methodVersion: METHOD_VERSION,
          methodology: emptyMethodology(),
          resultCount: 0,
          counts: tallyConsensus([]),
          results: [],
          verified: false,
        }),
      );
      document.getElementById("results")?.scrollIntoView({ behavior: "smooth", block: "start" });
      await verifyInBatches(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
      setData(null);
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  async function runVerifyPdf(selected?: File | null) {
    const filing = selected ?? file;
    if (!filing) {
      setError("Choose a PDF or Word (.docx) file to upload.");
      return;
    }
    setLoading(true);
    setError(null);
    setProgress(null);
    try {
      // Small files stay on multipart (works without Blob). Larger ones upload
      // straight to Vercel Blob so they never hit the serverless body wall.
      const intake = await intakeFiling(filing);
      let res: Response;
      if (intake.mode === "blob") {
        res = await fetch("/api/verify-pdf", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            blobUrl: intake.blobUrl,
            fileName: intake.fileName,
            verify: false,
          }),
        });
      } else {
        const body = new FormData();
        body.append("file", intake.file);
        body.append("verify", "false");
        res = await fetch("/api/verify-pdf", { method: "POST", body });
      }
      const base = await readJson<PdfVerifyResponse>(res, "Filing verification failed");
      if (!res.ok) throw new Error(base.error || "Filing verification failed");

      const items =
        base.extraction?.verifyItems ??
        (base.extraction?.verifyQueue ?? []).map((citation) => ({ citation }));
      startTransition(() => setData({ ...base, verified: items.length === 0 }));
      document.getElementById("results")?.scrollIntoView({ behavior: "smooth", block: "start" });
      if (!items.length) return;

      // Then verify in batches, showing each one as it lands rather than
      // holding everything back until the last authority resolves. Passages
      // harvested from the filing travel with each item so quote checks run.
      await verifyInBatches(items, base);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Filing verification failed");
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  function acceptFile(next: File | null) {
    if (!next) return;
    if (!filingFormatFromName(next.name, next.type)) {
      setError("Only PDF and Word (.docx) files are accepted.");
      return;
    }
    // Refuse it here rather than letting the platform reject the request with
    // an error page the client cannot read.
    if (next.size > MAX_PDF_BYTES) {
      setError(
        `That file is ${describeBytes(next.size)}, over the ${MAX_PDF_LABEL} upload limit. Split it, or export a smaller copy.`,
      );
      setFile(null);
      return;
    }
    setError(null);
    setFile(next);
  }

  return (
    <div className="w-full max-w-3xl">
      <div className="no-print mb-3 flex gap-1 border-b border-[var(--line)]">
        <ModeTab active={mode === "pdf"} onClick={() => setMode("pdf")} label="Upload a filing" />
        <ModeTab active={mode === "paste"} onClick={() => setMode("paste")} label="Paste cites" />
      </div>

      {mode === "paste" ? (
        <div className="no-print textarea-shell rounded-sm border border-[var(--line)] bg-[rgba(11,20,16,0.55)] backdrop-blur-sm transition-shadow">
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
          className={`no-print textarea-shell rounded-sm border border-dashed bg-[rgba(11,20,16,0.55)] backdrop-blur-sm transition-shadow ${
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
              Word (.docx) or PDF — we extract the text (or OCR a scan), pair case names to
              reporter/Westlaw pins, then verify each authority against CourtListener and CAP.
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="rounded-sm border border-brass/40 px-4 py-2 text-sm text-brass transition hover:bg-brass/10"
              >
                Choose file
              </button>
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={(e) => acceptFile(e.target.files?.[0] ?? null)}
              />
              {file ? (
                <p className="text-sm text-parchment">
                  {file.name}{" "}
                  <span className="text-parchment-dim">
                    ({describeBytes(file.size)})
                  </span>
                </p>
              ) : (
                <p className="text-sm text-parchment-dim">
                  PDF or .docx up to {MAX_PDF_LABEL} · scans OCR&apos;d automatically
                </p>
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
              label="Parse & verify filing"
              disabled={!file}
            />
          </div>
        </div>
      )}

      {mode === "paste" && (
        <div className="no-print mt-4 flex flex-wrap gap-2">
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
          <PrintHeader data={data} />
          {progress && progress.total > 0 ? (
            <div className="no-print mb-5 border border-[var(--line)] bg-ink-lift/70 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.12em] text-brass">
                Verifying {Math.min(progress.done + VERIFY_BATCH, progress.total)} of{" "}
                {progress.total} authorities
              </p>
              <div className="mt-2 h-px w-full bg-[var(--line)]">
                <div
                  className="h-px bg-brass transition-all"
                  style={{
                    width: `${Math.round((Math.min(progress.done + VERIFY_BATCH, progress.total) / progress.total) * 100)}%`,
                  }}
                />
              </div>
              <p className="mt-2 text-xs text-parchment-dim">
                Sent in batches so no single request outlives the server&apos;s limit. Results
                appear as each batch lands.
              </p>
            </div>
          ) : null}
          {data.document && data.extraction && (
            <div className="mb-6 border border-[var(--line)] bg-ink-lift/70 px-4 py-4 md:px-5">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brass">
                Document
              </p>
              <p className="mt-1 font-[family-name:var(--font-fraunces)] text-xl text-parchment">
                {data.document.fileName}
              </p>
              <p className="mt-1 text-sm text-parchment-dim">
                {data.document.format === "docx" ? "Word" : "PDF"}
                {" · "}
                {data.document.pageCount}{" "}
                {data.document.pageCount === 1 ? "page" : "pages"} ·{" "}
                {data.extraction.totalMatches} citation matches ·{" "}
                {data.extraction.verifyQueueCount} authorities queued for verify
                {data.document.textSource === "ocr"
                  ? ` · text via OCR${
                      data.document.ocr
                        ? ` (${data.document.ocr.pagesProcessed} page${
                            data.document.ocr.pagesProcessed === 1 ? "" : "s"
                          })`
                        : ""
                    }`
                  : data.document.textSource === "docx"
                    ? " · text from Word"
                    : ""}
              </p>
              {data.document.textSource === "ocr" ? (
                <p className="mt-2 text-xs text-parchment-dim">
                  This filing had no selectable text layer, so pages were OCR&apos;d before
                  citation detection. OCR can misread characters — skim the queued authorities
                  before relying on them.
                </p>
              ) : null}
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

          {data.results.length > 0 && <ReportBar data={data} />}
        </section>
      )}
    </div>
  );
}

/**
 * The report controls.
 *
 * JSON is the exact record — every outcome, coverage line and source URL, so a
 * later reader can reconstruct what was known. Print is the filable form: the
 * browser's own PDF export, which needs no server and no dependency, driven by
 * the print stylesheet.
 */
function ReportBar({
  data,
}: {
  data: PdfVerifyResponse;
}) {
  const report = buildReport(data, {
    document: data.document
      ? { fileName: data.document.fileName, pageCount: data.document.pageCount }
      : undefined,
  });

  function downloadBlob(contents: string, type: string, name: string) {
    const blob = new Blob([contents], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="no-print mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-4">
      <p className="text-xs text-parchment-dim">
        Report <span className="text-brass">{report.id}</span> · method{" "}
        <span className="text-brass">{report.methodVersion}</span> · generated{" "}
        {new Date(report.generatedAt).toLocaleString()} · {report.summary.citations}{" "}
        authorit{report.summary.citations === 1 ? "y" : "ies"}
        {report.controlRun
          ? ` · controls ${report.controlRun.ok ? "pass" : "fail"}`
          : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() =>
            downloadBlob(
              JSON.stringify(report, null, 2),
              "application/json",
              reportFileName(report),
            )
          }
          className="rounded-sm border border-[var(--line)] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-parchment-dim transition hover:border-brass hover:text-brass"
        >
          Download JSON
        </button>
        <button
          type="button"
          onClick={() =>
            downloadBlob(
              reportToWordHtml(report),
              "application/msword",
              reportWordFileName(report),
            )
          }
          className="rounded-sm border border-[var(--line)] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-parchment-dim transition hover:border-brass hover:text-brass"
        >
          Download for Word
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-sm border border-[var(--line)] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-parchment-dim transition hover:border-brass hover:text-brass"
        >
          Print / Save as PDF
        </button>
      </div>
    </div>
  );
}

/**
 * The record's header, which only exists on paper. On screen the page already
 * says what this is; printed, the sheet has to stand on its own — when it was
 * run, against what, by what method, and what the method could not reach.
 */
function PrintHeader({ data }: { data: PdfVerifyResponse }) {
  const report = buildReport(data, {
    document: data.document
      ? { fileName: data.document.fileName, pageCount: data.document.pageCount }
      : undefined,
  });

  return (
    <div className="print-only">
      <h1>Citation verification report</h1>
      <p>
        Report {report.id} · method {report.methodVersion} · generated{" "}
        {new Date(report.generatedAt).toISOString()}
        {report.document ? ` · ${report.document.fileName} (${report.document.pageCount} pp.)` : ""}
      </p>
      <p>
        {report.summary.citations} authorit{report.summary.citations === 1 ? "y" : "ies"} checked ·{" "}
        {CONSENSUS_KINDS.filter((k) => report.summary.existence[k] > 0)
          .map((k) => `${report.summary.existence[k]} ${STATUS_LABEL[k].toLowerCase()}`)
          .join(" · ")}
      </p>
      <p>Sources: {(report.methodology.sources ?? []).join("; ")}</p>
      {report.methodology.controls ? (
        <p>
          Method controls: {report.methodology.controls.positive} (expect{" "}
          {report.methodology.controls.expected.positive});{" "}
          {report.methodology.controls.negative} (expect{" "}
          {report.methodology.controls.expected.negative})
          {report.controlRun
            ? ` · run ${report.controlRun.ok ? "passed" : "FAILED"} at ${report.controlRun.runAt}`
            : ""}
        </p>
      ) : null}
      <ul>
        {report.caveats.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>
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

      {(result.courtLabel || result.decisionYear) && (
        <p className="mt-2 text-sm text-parchment-dim">
          {[result.courtLabel, result.decisionYear].filter(Boolean).join(" · ")}
        </p>
      )}

      {result.links && result.links.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brass">
            Open
          </p>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {result.links.map((link) => (
              <li key={link.url}>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-brass-soft underline-offset-2 hover:underline"
                  title={
                    link.kind === "primary"
                      ? "From a voting source or retrieved opinion text"
                      : "Constructed reference — does not affect the verdict"
                  }
                >
                  {link.label}
                  {link.kind === "reference" ? (
                    <span className="text-parchment-dim"> (ref)</span>
                  ) : null}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.support.quotes.length || result.support.pin ? (
        <div className="mt-4 border-l-2 border-[var(--line)] pl-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brass">
            Quoted language
            {result.support.textSource ? (
              <span className="font-normal normal-case tracking-normal text-parchment-dim">
                {" "}
                · read from{" "}
                {result.support.textUrl ? (
                  <a
                    href={result.support.textUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brass-soft underline-offset-2 hover:underline"
                  >
                    {result.support.textSource === "courtlistener"
                      ? "CourtListener"
                      : "CAP"}
                  </a>
                ) : result.support.textSource === "courtlistener" ? (
                  "CourtListener"
                ) : (
                  "CAP"
                )}
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
