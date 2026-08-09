# Citeproof — Case Law Verification Engine

A web engine that verifies case-law citations against the two sources proven reachable without auth:

1. **CourtListener** — `GET /api/rest/v4/search/`
2. **Caselaw Access Project** — `static.case.law/{reporter}/{volume}/CasesMetadata.json`

Mechanics are drawn from [interactive-litigation-portfolio PR #493](https://github.com/newanforbi/interactive-litigation-portfolio/pull/493). This repo is a standalone product site, not a portfolio ledger.

## Why

AI drafting invents pins. Citeproof checks whether a citation **exists** and whether the **caption matches** the reporter/Westlaw pin before it lands in a filing.

**Paste cites** or **upload a pleading PDF**. The PDF path extracts the text layer, pairs case names to reporter/Westlaw pins (same pairing rules as PR #493), then runs the dual-source existence probe.

Existence ≠ holding. Characterization still needs opinion text. Scanned image-only PDFs need OCR first (no text layer → clear error).

## Consensus statuses

| Status | Meaning |
|---|---|
| `FOUND` | CourtListener + CAP both resolve; caption compatible |
| `PARTIAL` | One working source resolves (common for WL-only pins) |
| `CAPTION_MISMATCH` | Pin resolves to a different case — miscitation signal |
| `NOT_FOUND` | Neither source resolves the pin |
| `UNKNOWN` | Unclassifiable input |

## Method controls

| Control | Expectation |
|---|---|
| *Richardson v. McKnight*, 521 U.S. 399 (1997) | Must resolve |
| *In re Leman*, 66 Cal.App.5th 200 | Must **not** resolve |

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

Open [http://localhost:3000](http://localhost:3000). Use **Paste cites** or **Upload PDF**.

```bash
# paste API
curl -s -X POST http://localhost:3000/api/verify \
  -H 'content-type: application/json' \
  -d '{"citations":"Richardson v. McKnight, 521 U.S. 399 (1997)\nIn re Leman, 66 Cal.App.5th 200"}'

# PDF API
npm run fixture:pdf
curl -s -X POST http://localhost:3000/api/verify-pdf \
  -F file=@fixtures/sample-pleading.pdf
```

```bash
npm run test:unit          # parser + caption matching + citation extract
npm run test:controls      # live Richardson(+) / Leman(−)
npm run test:pdf           # sample pleading PDF → extract → verify controls
npm run build
```

## Deploy (Vercel)

Import the GitHub repo in Vercel (Framework Preset: Next.js). `vercel.json` sets:

| Route | maxDuration | memory |
|---|---|---|
| `/api/verify` | 120s | 1024 MB |
| `/api/verify-pdf` | 300s | 1024 MB |

Notes for a clean deploy:

- **Node 20+** (`engines` in `package.json`)
- **Fluid compute** should stay enabled (Hobby max duration is 300s with Fluid)
- **PDF uploads capped at 4 MB** — Vercel Functions reject bodies over 4.5 MB
- No secrets required; CourtListener search + CAP `static.case.law` are unauthenticated
- Region pinned to `iad1` in `vercel.json` (change if you prefer)

```bash
npx vercel            # preview
npx vercel --prod     # production
```

## Stack

Next.js (App Router) + TypeScript + `pdf-parse`. Verification core in `src/lib/verify/`; citation pairing in `src/lib/citations/` (from PR #493 `build-citation-index.py` / `lookup-citations.py`). UI brand: **Citeproof**.
