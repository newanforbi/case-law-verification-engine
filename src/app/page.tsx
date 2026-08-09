import Image from "next/image";
import Link from "next/link";
import { Verifier } from "@/components/Verifier";

export default function Home() {
  return (
    <main className="atmosphere relative min-h-screen overflow-x-hidden">
      <div className="spine-plane" aria-hidden />
      <div className="grain" aria-hidden />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 pb-20 pt-6 md:px-8 md:pt-8">
        <header className="flex items-center justify-between gap-4 anim-rise">
          <Link href="/" className="brand-lockup" aria-label="Citeproof">
            {/* Logo C + iteproof as one written line */}
            <Image
              src="/brand/citeproof-icon-256.png"
              alt=""
              width={64}
              height={64}
              className="brand-lockup-icon"
              priority
            />
            <Image
              src="/brand/citeproof-wordmark-iteproof-header-lg.png"
              alt=""
              width={317}
              height={80}
              className="brand-lockup-wordmark"
              priority
            />
          </Link>
          <a
            href="#method"
            className="text-xs uppercase tracking-[0.14em] text-parchment-dim transition hover:text-brass md:text-sm"
          >
            Method
          </a>
        </header>

        <section className="relative mt-10 flex flex-1 flex-col justify-center pb-10 pt-4 md:mt-6 md:pb-16 md:pt-8">
          <div className="pointer-events-none absolute -left-8 top-8 hidden h-[72%] w-[42%] md:block" aria-hidden>
            <ReporterSilhouette />
          </div>

          <div className="relative max-w-3xl">
            <p className="anim-rise font-[family-name:var(--font-fraunces)] brand-pulse text-5xl leading-[0.95] tracking-tight text-parchment sm:text-6xl md:text-7xl lg:text-8xl">
              Citeproof
            </p>
            <div className="anim-rise-delay-1 line-pulse mt-5 h-px w-24 bg-brass/70" />
            <h1 className="anim-rise-delay-1 mt-6 max-w-xl font-[family-name:var(--font-fraunces)] text-2xl leading-snug text-parchment sm:text-3xl md:text-[2.15rem]">
              Verify case law before the hallucination hits the filing.
            </h1>
            <p className="anim-rise-delay-2 mt-4 max-w-lg text-base leading-relaxed text-parchment-dim md:text-lg">
              Paste cites or upload a pleading PDF. We find the authorities,
              then probe CourtListener and CAP — the two sources that answer
              without a login.
            </p>
          </div>

          <div className="anim-rise-delay-3 relative mt-10">
            <Verifier />
          </div>
        </section>

        <section
          id="method"
          className="mt-8 border-t border-[var(--line)] pt-14 md:mt-4 md:pt-16"
        >
          <div className="max-w-2xl">
            <h2 className="font-[family-name:var(--font-fraunces)] text-3xl text-parchment md:text-4xl">
              How verification works
            </h2>
            <p className="mt-3 text-base leading-relaxed text-parchment-dim">
              Existence first. Caption match second. Holding characterization
              is still a human read of the opinion — this engine stops
              fabricated pins from walking into court.
            </p>
          </div>

          <ol className="mt-10 grid gap-8 md:grid-cols-3 md:gap-10">
            <Step
              n="01"
              title="Extract & identify"
              body="From paste or a PDF text layer, pair case names to reporter/Westlaw pins."
            />
            <Step
              n="02"
              title="Probe both sources"
              body="CourtListener opinion search and CAP CasesMetadata.json on static.case.law run in parallel."
            />
            <Step
              n="03"
              title="Consensus"
              body="FOUND when both hit with a compatible caption; CAPTION_MISMATCH when the pin belongs to a different case; NOT_FOUND when neither resolves."
            />
          </ol>
        </section>

        <section className="mt-16 border-t border-[var(--line)] pt-14 md:mt-20 md:pt-16">
          <div className="max-w-2xl">
            <h2 className="font-[family-name:var(--font-fraunces)] text-3xl text-parchment md:text-4xl">
              Sources that work
            </h2>
            <p className="mt-3 text-base leading-relaxed text-parchment-dim">
              Citeproof probes only sources that answer without a login.
              Justia, Scholar, CAP JSON API, and CourtListener citation-lookup
              stay out of the path — blocked or auth-gated.
            </p>
          </div>
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            <SourceBlock
              name="CourtListener"
              detail="Unauthenticated /api/rest/v4/search/ — opinion search by reporter pin or WL number."
            />
            <SourceBlock
              name="Caselaw Access Project"
              detail="static.case.law volume CasesMetadata.json + HTML opinions — exact first_page match."
            />
          </div>
          <p className="mt-8 max-w-2xl text-sm leading-relaxed text-parchment-dim">
            Method controls:{" "}
            <span className="text-parchment">
              Richardson v. McKnight, 521 U.S. 399
            </span>{" "}
            must resolve;{" "}
            <span className="text-parchment">In re Leman, 66 Cal.App.5th 200</span>{" "}
            must not.
          </p>
        </section>

        <footer className="mt-20 border-t border-[var(--line)] pt-8 text-sm text-parchment-dim">
          <p>
            Citeproof · case-law verification engine · existence ≠ holding
          </p>
        </footer>
      </div>
    </main>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <li>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brass">{n}</p>
      <h3 className="mt-2 font-[family-name:var(--font-fraunces)] text-xl text-parchment">
        {title}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-parchment-dim">{body}</p>
    </li>
  );
}

function SourceBlock({ name, detail }: { name: string; detail: string }) {
  return (
    <div className="border-l border-brass/40 pl-4">
      <h3 className="font-[family-name:var(--font-fraunces)] text-xl text-parchment">
        {name}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-parchment-dim">{detail}</p>
    </div>
  );
}

function ReporterSilhouette() {
  return (
    <svg viewBox="0 0 320 520" className="h-full w-full opacity-[0.22]" fill="none">
      <rect x="24" y="40" width="52" height="440" rx="2" fill="#c9a66b" opacity="0.35" />
      <rect x="88" y="70" width="48" height="410" rx="2" fill="#5faf7a" opacity="0.22" />
      <rect x="148" y="28" width="58" height="452" rx="2" fill="#c9a66b" opacity="0.28" />
      <rect x="218" y="90" width="44" height="390" rx="2" fill="#7eb8c9" opacity="0.18" />
      <rect x="274" y="55" width="36" height="425" rx="2" fill="#c9a66b" opacity="0.2" />
      <path
        d="M20 480h290"
        stroke="#c9a66b"
        strokeOpacity="0.35"
        strokeWidth="2"
      />
    </svg>
  );
}
