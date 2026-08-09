import { NextResponse } from "next/server";
import { extractCitationsFromPages } from "@/lib/citations/extract";
import { extractPdfText } from "@/lib/pdf/extract";
import { lookupOne, type LookupResult, type Consensus } from "@/lib/verify";
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
    const extracted = await extractPdfText(bytes, name);

    if (!extracted.hasTextLayer) {
      return NextResponse.json(
        {
          error:
            "This PDF has little or no extractable text. Scanned image-only PDFs need OCR before citation detection can run.",
          fileName: extracted.fileName,
          pageCount: extracted.pageCount,
          charCount: extracted.charCount,
          hasTextLayer: false,
        },
        { status: 422 },
      );
    }

    const cites = extractCitationsFromPages(extracted.pages, {
      verifyLimit: limit,
    });

    const results: LookupResult[] = [];
    if (verifyFlag && cites.verifyQueue.length) {
      for (const citation of cites.verifyQueue) {
        results.push(await lookupOne(citation));
      }
    }

    const counts: Record<Consensus, number> = {
      FOUND: 0,
      PARTIAL: 0,
      CAPTION_MISMATCH: 0,
      NOT_FOUND: 0,
      UNKNOWN: 0,
    };
    for (const r of results) counts[r.consensus] += 1;

    // Compact occurrence list for the UI (authorities + reporters first).
    const interesting = cites.citations.filter((c) =>
      ["authority", "case_reporter", "case_westlaw", "case_name"].includes(c.kind),
    );

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      methodology: {
        sources: [
          "CourtListener /api/rest/v4/search/",
          "Caselaw Access Project static.case.law (CasesMetadata.json + HTML)",
        ],
        reference:
          "PDF extract + citation pairing, then dual-source existence probe via CourtListener + CAP static.case.law",
        extraction:
          "pdf-parse text layer → reporter/Westlaw + case-name pairing → dual-source verify",
      },
      document: {
        fileName: extracted.fileName,
        pageCount: extracted.pageCount,
        charCount: extracted.charCount,
        hasTextLayer: extracted.hasTextLayer,
      },
      extraction: {
        totalMatches: cites.citations.length,
        countsByKind: cites.countsByKind,
        verifyQueue: cites.verifyQueue,
        verifyQueueCount: cites.verifyQueue.length,
        occurrences: interesting.slice(0, 200).map((c) => ({
          kind: c.kind,
          citation: c.citation,
          page: c.page,
          context: c.context,
        })),
      },
      verified: verifyFlag,
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
