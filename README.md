# Citeproof — Pre-Filing Citation Audit

A web engine that audits case-law citations in a filing against the two sources proven reachable without auth:

1. **CourtListener** — `GET /api/rest/v4/search/`
2. **Caselaw Access Project** — `static.case.law/{reporter}/{volume}/CasesMetadata.json`

Optional **statute probes** (side channel, not case-law votes):

3. **LII / Cornell** — U.S. Code section pages (`law.cornell.edu/uscode`)
4. **California LegInfo** — `codes_displaySection.xhtml` for mapped CA codes (VEH, PEN, CIV, …)

Upload a pleading (**Word .docx** or PDF) or paste cites. Citeproof extracts authorities, probes existence with **coverage-aware** verdicts, checks quoted language and pin pages against opinion text where available, and exports a **timestamped verification report**.

We check what the opinion says, not whether it supports your argument.

Each result includes **open links**: primary URLs from CourtListener/CAP (or retrieved opinion text), plus constructed Justia / Library of Congress / Google Scholar references. Constructed links never affect the verdict.

Filing uploads also harvest **propositions** — the prose claims tied to each authority (with a role cue: supports / distinguishes / anticipates contrary). With **holding-use audit** enabled (default on filing verify), those claims are scored against retrieved opinion text (`supported` / `aggressive` / `overstated` / `unsupported` / `unchecked`). The heuristic uses content-word overlap and overbreadth cues; set `HOLDING_AUDITOR=llm` later behind the same interface. Holding scores never change existence consensus.

Statutes are queued separately from case-law (`statuteQueue`). With **statute probes** enabled (default on filing verify), U.S.C. cites hit LII and mapped California code cites hit LegInfo. Those outcomes never change CourtListener/CAP consensus.

With **subsequent-treatment** enabled (default on filing verify), Found authorities that return a CourtListener `cluster_id` get a `cites:(cluster)` sample plus `citeCount`. Filing propositions with role `anticipates_contrary` are grouped into **contrary clusters**. Keyword “negative language” flags on citing captions/syllabi are heuristics only — **not** Shepard’s or KeyCite treatment codes — and never change existence consensus.

## Existence verdicts

| Status | Meaning |
|---|---|
| `FOUND` | A source that covers this citation resolved the pin; caption compatible |
| `PARTIAL` | One covering source resolved the pin; another that also covers it did not |
| `CAPTION_MISMATCH` | Pin resolves to a different case — miscitation signal |
| `NOT_FOUND` | A covering source looked and does not have it — fabrication signal |
| `OUT_OF_COVERAGE` | Neither free source covers this citation (e.g. unpublished WL-only) |
| `UNCHECKED` | A source was unreachable; nothing was established |
| `UNKNOWN` | No reporter or Westlaw pin could be parsed |

## Quote / support verdicts

| Status | Meaning |
|---|---|
| `SUPPORTED` | Quoted language (and pin, when checkable) matches the opinion |
| `QUALIFIED` | Match after ellipses/brackets, or pin page not marked in the text |
| `UNSUPPORTED` | Passage not found in the opinion |
| `INDETERMINATE` | Quote too short to judge |
| `NO_QUOTE` | No quoted language supplied |
| `UNCHECKED` | Opinion text could not be retrieved |

## Holding-use fits

| Fit | Meaning |
|---|---|
| `supported` | Filing proposition overlaps the opinion without overbreadth cues |
| `aggressive` | Partial overlap, or the claim stretches beyond clear textual support |
| `overstated` | Absolute language in the claim while the opinion uses limiting language |
| `unsupported` | Little or no overlap with the retrieved opinion (or cite did not resolve) |
| `unchecked` | Opinion text unavailable or proposition too thin to score |

## Subsequent treatment (free sketch)

| Status | Meaning |
|---|---|
| `ok` | CourtListener `cites:(cluster)` sample returned (see `samples` / `citeCount`) |
| `unchecked` | Search unreachable or failed |
| `out_of_coverage` | No cluster id available for a free cites: query |
| `skipped` | Existence did not resolve as found — cites not probed |

Contrary clusters list authorities the **filing** framed with `anticipates_contrary` (e.g. *but see*). They are not citator “disagree” labels.

## Method controls

| Control | Expectation |
|---|---|
| *Richardson v. McKnight*, 521 U.S. 399 (1997) | Must resolve (`FOUND`) |
| *In re Leman*, 66 Cal.App.5th 200 | Must **not** resolve (`NOT_FOUND`) |

## Sources intentionally excluded

| Source | Why |
|---|---|
| Justia | Cloudflare blocked |
| Google Scholar | Unreliable / challenged |
| `api.case.law` JSON | Auth / migration |

## CourtListener token (optional)

Set `COURTLISTENER_API_TOKEN` (server env / Vercel secret) to enable authenticated
`POST /api/rest/v4/citation-lookup/` for existence probes. Use the profile token with
header form `Authorization: Token <key>` (not Bearer). When unset or on auth failure,
Citeproof falls back to unauthenticated `/search/` — same behavior as before.

Never commit the token. Rotate it if it was ever pasted into chat or logs.

## Develop

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). **Upload a filing** is the front door; paste is available as a tab.

```bash
# paste / batch API
curl -s -X POST http://localhost:3000/api/verify \
  -H 'content-type: application/json' \
  -d '{"citations":"Richardson v. McKnight, 521 U.S. 399 (1997)\nIn re Leman, 66 Cal.App.5th 200"}'

# items with harvested quotes + holding audit
curl -s -X POST http://localhost:3000/api/verify \
  -H 'content-type: application/json' \
  -d '{"holdingAudit":true,"items":[{"citation":"Richardson v. McKnight, 521 U.S. 399, 402 (1997)","passages":["private prison guards"],"propositions":[{"text":"Private prison guards do not enjoy the same immunity as public officers.","role":"supports"}]}]}'

# statute probes only (LII / LegInfo)
curl -s -X POST http://localhost:3000/api/verify \
  -H 'content-type: application/json' \
  -d '{"statuteProbe":true,"statutes":[{"citation":"42 U.S.C. § 1983","kind":"statute_federal"},{"citation":"Vehicle Code § 40300.5","kind":"statute_state"}]}'

# subsequent cites + contrary clusters
curl -s -X POST http://localhost:3000/api/verify \
  -H 'content-type: application/json' \
  -d '{"treatmentProbe":true,"items":[{"citation":"Richardson v. McKnight, 521 U.S. 399 (1997)","propositions":[{"text":"But see Richardson for limits on private-guard immunity.","role":"anticipates_contrary"}]}]}'

# PDF extract only (what the UI does first)
npm run fixture:pdf
curl -s -X POST http://localhost:3000/api/verify-pdf \
  -F file=@fixtures/sample-pleading.pdf -F verify=false
```

```bash
npm run test:unit          # parser + consensus + quotes + links + holding + statute + treatment + citation-lookup + report + regression + docx
npm run test:links         # reference-link construction (offline)
npm run test:holding       # holding-use heuristic fixtures (offline)
npm run test:statute       # statute parse / LII-LegInfo classifiers (offline)
npm run test:treatment     # subsequent-cite / contrary-cluster fixtures (offline)
npm run test:citation-lookup  # CourtListener citation-lookup response mapper (offline)
npm run test:ocr           # image-only PDF → tesseract OCR → citation extract
npm run test:docx          # sample pleading .docx → extract → citation queue
npm run test:controls      # live Richardson(+) / Leman(−)
npm run test:pdf           # sample pleading PDF → extract → verify controls
npm run test:smoke         # POST fixture PDF to /api/verify-pdf (needs a running server)
npm run build
```

Reports carry `methodVersion`, per-source `checkedAt`, structured coverage envelopes,
live control-pair results, and can be downloaded as JSON or Word-compatible `.doc`.

**Word (.docx)** filings use mammoth text extract (no OCR). Scanned / image-only PDFs are
OCR'd automatically (pdf-parse screenshots → tesseract.js), up to 12 pages per upload.
Text-layer PDFs skip OCR. PACER/ECF filings that only have a selectable page stamp (with a
scanned body) are treated as image-only and OCR'd. Legacy binary `.doc` is not supported —
save as `.docx` or PDF.

Filing size: up to **40 MB**. Files ≤ 4 MB post as multipart; larger files upload to
**Vercel Blob** (`/api/pdf/upload`) then `/api/verify-pdf` fetches by `blobUrl`.
Requires a Blob store connected to the project (`BLOB_READ_WRITE_TOKEN`).

## Deploy (Vercel)

Import the GitHub repo in Vercel (Framework Preset: Next.js). `vercel.json` sets:

| Route | maxDuration |
|---|---|
| `/api/verify` | 120s |
| `/api/verify-pdf` | 300s |

Function memory is plan-managed on Hobby (do not set `memory` in `vercel.json`).

Notes for a clean deploy:

- **Node 20+** (`engines` in `package.json`)
- **Fluid compute** should stay enabled (Hobby max duration is 300s with Fluid)
- **Filing uploads capped at 40 MB** (PDF / .docx) — files over ~4 MB use Vercel
  Blob (create a Blob store in the project; token is injected as `BLOB_READ_WRITE_TOKEN`)
- **OCR** needs network egress to fetch tesseract language data on cold start
  (cached under `/tmp` afterward)
- CAP `static.case.law` needs no secret. CourtListener search works anonymously;
  set optional `COURTLISTENER_API_TOKEN` for citation-lookup
- Region pinned to `iad1` in `vercel.json` (change if you prefer)

```bash
npx vercel            # preview
npx vercel --prod     # production
```

## Stack

Next.js (App Router) + TypeScript + `pdf-parse` + `tesseract.js`. Verification core in `src/lib/verify/`; citation pairing in `src/lib/citations/`; report artifact in `src/lib/report/`. UI brand: **Citeproof**.
