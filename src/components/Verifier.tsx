"use client";

import { startTransition, useState } from "react";
import type { Consensus, LookupResult, VerifyResponse } from "@/lib/verify";
import { CONTROLS, EXAMPLES } from "@/lib/verify/client-constants";

const STATUS_LABEL: Record<Consensus, string> = {
  FOUND: "Found",
  PARTIAL: "Partial",
  CAPTION_MISMATCH: "Caption mismatch",
  NOT_FOUND: "Not found",
  UNKNOWN: "Unknown",
};

const STATUS_HINT: Record<Consensus, string> = {
  FOUND: "Both CourtListener and CAP resolve this pin with a compatible caption.",
  PARTIAL: "One working source resolves the pin. Common for Westlaw-only citations.",
  CAPTION_MISMATCH: "The pin resolves, but to a different case caption — classic miscitation.",
  NOT_FOUND: "Neither working source found this reporter or Westlaw pin.",
  UNKNOWN: "Could not classify — missing reporter/Westlaw pin or incomplete probe.",
};

export function Verifier() {
  const [text, setText] = useState(`${CONTROLS.positive}\n${CONTROLS.negative}`);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<VerifyResponse | null>(null);

  async function runVerify(payload?: string) {
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
      const json = (await res.json()) as VerifyResponse & { error?: string };
      if (!res.ok) {
        throw new Error(json.error || "Verification failed");
      }
      startTransition(() => {
        setData(json);
      });
      document.getElementById("results")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-3xl">
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
          <button
            type="button"
            onClick={() => void runVerify()}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-sm bg-brass px-5 py-2.5 text-sm font-semibold tracking-wide text-ink transition hover:bg-brass-soft disabled:cursor-wait disabled:opacity-70"
          >
            {loading ? (
              <>
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink/30 border-t-ink" />
                Verifying…
              </>
            ) : (
              "Verify citations"
            )}
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {EXAMPLES.slice(0, 4).map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => {
              setText(ex);
              void runVerify(ex);
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
            void runVerify(batch);
          }}
          className="rounded-sm border border-brass/35 px-3 py-1.5 text-xs text-brass transition hover:bg-brass/10"
        >
          Run method controls
        </button>
      </div>

      {error && (
        <p className="mt-4 border-l-2 border-not-found pl-3 text-sm text-not-found" role="alert">
          {error}
        </p>
      )}

      {data && (
        <section id="results" className="mt-10 scroll-mt-8" aria-live="polite">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-[family-name:var(--font-fraunces)] text-2xl text-parchment md:text-3xl">
                Results
              </h2>
              <p className="mt-1 text-sm text-parchment-dim">
                {data.resultCount} probed · {data.counts.FOUND} found · {data.counts.NOT_FOUND}{" "}
                not found · {data.counts.CAPTION_MISMATCH} caption mismatch
              </p>
            </div>
          </div>
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
        </section>
      )}
    </div>
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
            Parsed as{" "}
            <span className="text-parchment/90">{result.caseNameGuess || "—"}</span>
            {result.reporterPin ? (
              <>
                {" "}
                · pin <span className="text-brass">{result.reporterPin}</span>
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
        <span
          className={`status-${result.consensus} shrink-0 rounded-sm border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.08em]`}
        >
          {STATUS_LABEL[result.consensus]}
        </span>
      </div>

      <p className="mt-3 text-sm text-parchment-dim">{STATUS_HINT[result.consensus]}</p>

      {result.matchedName ? (
        <p className="mt-2 text-sm">
          Matched caption:{" "}
          <span className="text-parchment">{result.matchedName}</span>
          {result.matchedCitations?.length ? (
            <span className="text-parchment-dim">
              {" "}
              ({result.matchedCitations.slice(0, 3).join("; ")})
            </span>
          ) : null}
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {result.sources.map((s) => (
          <div
            key={s.source}
            className="border border-[var(--line)] bg-ink/40 px-3 py-3"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brass">
                {s.source === "courtlistener" ? "CourtListener" : "CAP static.case.law"}
              </p>
              <span
                className={`text-xs font-medium ${s.found ? "text-verified" : "text-not-found"}`}
              >
                {s.found ? "Hit" : "Miss"}
              </span>
            </div>
            {s.caseName ? (
              <p className="mt-2 text-sm text-parchment">{s.caseName}</p>
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
