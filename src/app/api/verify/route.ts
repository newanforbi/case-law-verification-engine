import { NextResponse } from "next/server";
import {
  CONTROL_EXPECTATIONS,
  CONTROLS,
  METHOD_VERSION,
  runMethodControls,
  tallyConsensus,
  verifyCitationItems,
  verifyCitations,
  verifyStatuteItems,
  type StatuteKind,
  type StatuteRequestItem,
  type VerifyRequestItem,
} from "@/lib/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      citations?: string;
      text?: string;
      items?: VerifyRequestItem[];
      /** Statute cites for LII / LegInfo probes (side channel). */
      statutes?: StatuteRequestItem[];
      /** When true, also run the method control pair and attach controlRun. */
      includeControlRun?: boolean;
      /** When true, score filing propositions against opinion text. */
      holdingAudit?: boolean;
      /** When true (default if statutes[] present), probe statutes. */
      statuteProbe?: boolean;
      /** Controls-only request: return methodology + controlRun, no citations. */
      controlsOnly?: boolean;
    };

    if (body.controlsOnly) {
      const controlRun = await runMethodControls();
      return NextResponse.json({
        generatedAt: new Date().toISOString(),
        methodVersion: METHOD_VERSION,
        methodology: {
          version: METHOD_VERSION,
          sources: [
            "CourtListener /api/rest/v4/search/",
            "Caselaw Access Project static.case.law (CasesMetadata.json + HTML)",
          ],
          reference:
            "Method control pair only — proves the verifier still resolves a known case and rejects a known fabrication.",
          controls: {
            positive: CONTROLS.positive,
            negative: CONTROLS.negative,
            expected: {
              positive: CONTROL_EXPECTATIONS.positive,
              negative: CONTROL_EXPECTATIONS.negative,
            },
          },
        },
        controlRun,
        resultCount: 0,
        counts: {},
        results: [],
      });
    }

    const includeControlRun = body.includeControlRun === true;
    const holdingAudit = body.holdingAudit === true;
    const statuteItems = Array.isArray(body.statutes)
      ? body.statutes
          .map((item) => {
            const citation = String(item?.citation ?? "").trim();
            const kind: StatuteKind | undefined =
              item?.kind === "statute_state" || item?.kind === "statute_federal"
                ? item.kind
                : undefined;
            return { citation, kind };
          })
          .filter((item) => item.citation)
      : [];
    const wantStatutes =
      statuteItems.length > 0 && body.statuteProbe !== false;

    if (Array.isArray(body.items) && body.items.length) {
      const items = body.items
        .map((item) => ({
          citation: String(item?.citation ?? "").trim(),
          passages: Array.isArray(item?.passages)
            ? item.passages.map((p) => String(p)).filter(Boolean).slice(0, 5)
            : [],
          propositions: Array.isArray(item?.propositions)
            ? item.propositions
                .map((p) => ({
                  text: String(p?.text ?? "").trim(),
                  page:
                    typeof p?.page === "number" && Number.isFinite(p.page)
                      ? p.page
                      : undefined,
                  role:
                    p?.role === "distinguishes" ||
                    p?.role === "anticipates_contrary"
                      ? p.role
                      : ("supports" as const),
                }))
                .filter((p) => p.text.length >= 12)
                .slice(0, 5)
            : [],
        }))
        .filter((item) => item.citation);
      const result = await verifyCitationItems(items, {
        includeControlRun,
        holdingAudit,
      });
      if (wantStatutes) {
        const statuteResults = await verifyStatuteItems(statuteItems);
        return NextResponse.json({
          ...result,
          statuteResultCount: statuteResults.length,
          statuteCounts: tallyConsensus(statuteResults),
          statuteResults,
        });
      }
      return NextResponse.json(result);
    }

    // Statute-only batch (UI probes after case-law batches).
    if (wantStatutes && !(body.citations ?? body.text ?? "").trim()) {
      const statuteResults = await verifyStatuteItems(statuteItems);
      return NextResponse.json({
        generatedAt: new Date().toISOString(),
        methodVersion: METHOD_VERSION,
        methodology: {
          version: METHOD_VERSION,
          sources: [
            "Legal Information Institute (law.cornell.edu) U.S. Code — statute probe only",
            "California LegInfo codes_displaySection — statute probe only",
          ],
          reference:
            "Statute-only probe against free LII / LegInfo pages. Does not touch case-law consensus.",
          controls: {
            positive: CONTROLS.positive,
            negative: CONTROLS.negative,
            expected: {
              positive: CONTROL_EXPECTATIONS.positive,
              negative: CONTROL_EXPECTATIONS.negative,
            },
          },
        },
        resultCount: 0,
        counts: tallyConsensus([]),
        results: [],
        statuteResultCount: statuteResults.length,
        statuteCounts: tallyConsensus(statuteResults),
        statuteResults,
      });
    }

    const raw = (body.citations ?? body.text ?? "").trim();
    if (!raw) {
      return NextResponse.json(
        {
          error:
            "Missing citations. Paste one citation per line, send items[], or statutes[].",
        },
        { status: 400 },
      );
    }
    const result = await verifyCitations(raw, { includeControlRun, holdingAudit });
    if (wantStatutes) {
      const statuteResults = await verifyStatuteItems(statuteItems);
      return NextResponse.json({
        ...result,
        statuteResultCount: statuteResults.length,
        statuteCounts: tallyConsensus(statuteResults),
        statuteResults,
      });
    }
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Verification failed";
    const status = message.includes("at most") || message.includes("at least") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
