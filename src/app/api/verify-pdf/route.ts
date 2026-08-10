import { NextResponse } from "next/server";
import { extractCitationsFromPages } from "@/lib/citations/extract";
import { extractPdfText } from "@/lib/pdf/extract";
import {
  CONTROL_EXPECTATIONS,
  CONTROLS,
  METHOD_VERSION,
  lookupOneSafe,
  runMethodControls,
  tallyConsensus,
  type LookupResult,
  type VerifyResponse,
} from "@/lib/verify";
import type { VerifyItem } from "@/lib/citations/extract";
import {
  MAX_PDF_BYTES,
  MAX_PDF_LABEL,
  describeBytes,
} from "@/lib/verify/client-constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_VERIFY = 40;

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const form = await request.formData();
    const file = form.get("file");
    const verifyFlag = String(form.get("verify") ?? "true").toLowerCase() !== "false";
    const limitRaw = Number(form.get("limit") ?? MAX_VERIFY);
    const limit = Math.min(
      MAX_VERIFY,
      Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : MAX_VERIFY),
    );

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Missing PDF file. Upload a multipart field named file." },
        { status: 400 },
      );
    }

    const name = file.name || "upload.pdf";
    if (!name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      return NextResponse.json(
        { error: "Only PDF uploads are supported." },
        { status: 400 },
      );
    }

    // Vercel refuses an oversized body before this route runs, and its refusal
    // is an HTML page. This one is for every other way the request can arrive
    // — local, self-hosted, a platform that lets it through — so the answer is
    // JSON the client can actually read.
    if (file.size > MAX_PDF_BYTES) {
      return NextResponse.json(
        {
          error: `That PDF is ${describeBytes(file.size)}, over the ${MAX_PDF_LABEL} upload limit.`,
          fileName: file.name,
          bytes: file.size,
          limitBytes: MAX_PDF_BYTES,
        },
        { status: 413 },
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    // Text layer first; scanned image-only filings fall through to OCR.
    const extracted = await extractPdfText(bytes, name);

    if (!extracted.hasTextLayer) {
      return NextResponse.json(
        {
          error:
            extracted.textSource === "ocr"
              ? "OCR ran on this scanned PDF but recovered too little text for citation detection. Try a clearer scan, or paste the citations."
              : "This PDF has little or no extractable text, and OCR could not recover enough to continue. Try a text-based export, or paste the citations.",
          fileName: extracted.fileName,
          pageCount: extracted.pageCount,
          charCount: extracted.charCount,
          hasTextLayer: false,
          textSource: extracted.textSource,
          ocr: extracted.ocr,
        },
        { status: 422 },
      );
    }

    const cites = extractCitationsFromPages(extracted.pages, {
      verifyLimit: limit,
    });

    const verifyItems: VerifyItem[] = cites.verifyItems;
    const results: LookupResult[] = [];
    // Stamp the method controls once alongside the filing — they travel with
    // the exportable report so a later reader can see the method still held.
    const controlPromise =
      verifyFlag && verifyItems.length ? runMethodControls() : null;
    if (verifyFlag && verifyItems.length) {
      for (const item of verifyItems) {
        results.push(await lookupOneSafe(item.citation, item.passages));
      }
    }
    const controlRun = controlPromise ? await controlPromise : undefined;

    const counts = tallyConsensus(results);

    // Compact occurrence list for the UI (authorities + reporters first).
    const interesting = cites.citations.filter((c) =>
      ["authority", "case_reporter", "case_westlaw", "case_name"].includes(c.kind),
    );

    // methodVersion is present even on extract-only responses so deploy smoke
    // and clients can pin the method without forcing a full verify.
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
          "PDF extract + citation pairing, then coverage-aware existence probe and quote checking via CourtListener + CAP static.case.law. We check what the opinion says, not whether it supports the argument.",
        controls: {
          positive: CONTROLS.positive,
          negative: CONTROLS.negative,
          expected: {
            positive: CONTROL_EXPECTATIONS.positive,
            negative: CONTROL_EXPECTATIONS.negative,
          },
        },
      } satisfies VerifyResponse["methodology"],
      controlRun,
      extractionMethod:
        extracted.textSource === "ocr"
          ? "pdf-parse screenshot → tesseract OCR → reporter/Westlaw + case-name pairing → quote harvest → coverage-aware verify"
          : "pdf-parse text layer → reporter/Westlaw + case-name pairing → quote harvest → coverage-aware verify",
      document: {
        fileName: extracted.fileName,
        pageCount: extracted.pageCount,
        charCount: extracted.charCount,
        hasTextLayer: extracted.hasTextLayer,
        textSource: extracted.textSource,
        ocr: extracted.ocr,
      },
      extraction: {
        totalMatches: cites.citations.length,
        countsByKind: cites.countsByKind,
        verifyQueue: cites.verifyQueue,
        verifyItems,
        verifyQueueCount: cites.verifyQueue.length,
        occurrences: interesting.slice(0, 200).map((c) => ({
          kind: c.kind,
          citation: c.citation,
          page: c.page,
          context: c.context,
        })),
      },
      verified: verifyFlag,
      // So the next failure report says what the request was actually doing.
      diagnostics: {
        elapsedMs: Date.now() - startedAt,
        queued: cites.verifyQueue.length,
        verifiedInRequest: results.length,
        textSource: extracted.textSource,
        ocr: extracted.ocr,
      },
      resultCount: results.length,
      counts,
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "PDF verification failed";
    const status =
      message.includes("limit") || message.includes("empty") || message.includes("Only PDF")
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
