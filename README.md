# Citeproof — Case Law Verification Engine

A web engine that verifies case-law citations against the two sources proven reachable without auth:

1. **CourtListener** — `GET /api/rest/v4/search/`
2. **Caselaw Access Project** — `static.case.law/{reporter}/{volume}/CasesMetadata.json`

Mechanics are drawn from [interactive-litigation-portfolio PR #493](https://github.com/newanforbi/interactive-litigation-portfolio/pull/493). This repo is a standalone product site, not a portfolio ledger.

## Why

AI drafting invents pins. Citeproof checks whether a citation **exists** and whether the **caption matches** the reporter/Westlaw pin before it lands in a filing.

Existence ≠ holding. Characterization still needs opinion text.

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

Open [http://localhost:3000](http://localhost:3000). Paste citations and click **Verify**.

API:

```bash
curl -s -X POST http://localhost:3000/api/verify \
  -H 'content-type: application/json' \
  -d '{"citations":"Richardson v. McKnight, 521 U.S. 399 (1997)\nIn re Leman, 66 Cal.App.5th 200"}'
```

```bash
npm run test:unit          # parser + caption matching
npm run test:controls      # live Richardson(+) / Leman(−) against the API
npm run build
```

## Stack

Next.js (App Router) + TypeScript. Verification core lives in `src/lib/verify/` (ported from PR #493 `lookup-citations.py`). UI brand: **Citeproof**.
