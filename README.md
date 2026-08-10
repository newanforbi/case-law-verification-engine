# Citeproof — Pre-Filing Citation Audit

A web engine that audits case-law citations in a filing against the two sources proven reachable without auth:

1. **CourtListener** — `GET /api/rest/v4/search/`
2. **Caselaw Access Project** — `static.case.law/{reporter}/{volume}/CasesMetadata.json`

Upload a pleading (**Word .docx** or PDF) or paste cites. Citeproof extracts authorities, probes existence with **coverage-aware** verdicts, checks quoted language and pin pages against opinion text where available, and exports a **timestamped verification report**.

We check what the opinion says, not whether it supports your argument.

Each result includes **open links**: primary URLs from CourtListener/CAP (or retrieved opinion text), plus constructed Justia / Library of Congress / Google Scholar references. Constructed links never affect the verdict.

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
| CourtListener citation-lookup | API token required |

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

# items with harvested quotes
curl -s -X POST http://localhost:3000/api/verify \
  -H 'content-type: application/json' \
  -d '{"items":[{"citation":"Richardson v. McKnight, 521 U.S. 399, 402 (1997)","passages":["private prison guards"]}]}'

# PDF extract only (what the UI does first)
npm run fixture:pdf
curl -s -X POST http://localhost:3000/api/verify-pdf \
  -F file=@fixtures/sample-pleading.pdf -F verify=false
```

```bash
npm run test:unit          # parser + consensus + quotes + links + report + regression + docx
npm run test:links         # reference-link construction (offline)
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
- No secrets required; CourtListener search + CAP `static.case.law` are unauthenticated
- Region pinned to `iad1` in `vercel.json` (change if you prefer)

```bash
npx vercel            # preview
npx vercel --prod     # production
```

## Stack

Next.js (App Router) + TypeScript + `pdf-parse` + `tesseract.js`. Verification core in `src/lib/verify/`; citation pairing in `src/lib/citations/`; report artifact in `src/lib/report/`. UI brand: **Citeproof**.
