import { NextResponse } from "next/server";
import { extractCitationsFromPages } from "@/lib/citations/extract";
import type { VerifyItem } from "@/lib/citations/extract";
import { extractFilingText } from "@/lib/filing/extract";
import { filingFormatFromName, isAcceptedFiling } from "@/lib/filing/kinds";
import { deleteFilingBlob, downloadFilingBlob } from "@/lib/pdf/blob";
import {
  DIRECT_BODY_MAX_BYTES,
  DIRECT_BODY_MAX_LABEL,
  MAX_PDF_BYTES,
  MAX_PDF_LABEL,
  describeBytes,
} from "@/lib/pdf/limits";
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_VERIFY = 40;

type IncomingPdf = {
  bytes: Uint8Array;
  fileName: string;
  blobUrl?: string;
  verifyFlag: boolean;
  limit: number;
};

function clampLimit(raw: unknown): number {
  const n = Number(raw ?? MAX_VERIFY);
  return Math.min(MAX_VERIFY, Math.max(1, Number.isFinite(n) ? Math.floor(n) : MAX_VERIFY));
}

async function readIncoming(request: Request): Promise<IncomingPdf> {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = (await request.json()) as {
      blobUrl?: string;
      url?: string;
      fileName?: string;
      verify?: boolean | string;
      limit?: number;
    };
    const blobUrl = String(body.blobUrl || body.url || "").trim();
    if (!blobUrl) {
      throw Object.assign(new Error("Missing blobUrl. Upload the filing first."), {
        status: 400,
      });
    }
    const fileName =
      String(body.fileName || "").trim() ||
      decodeURIComponent(blobUrl.split("/").pop() || "upload.pdf");
    if (!isAcceptedFiling(fileName)) {
      throw Object.assign(
        new Error("Only PDF and Word (.docx) uploads are supported."),
        { status: 400 },
      );
    }
    const { bytes } = await downloadFilingBlob(blobUrl);
    return {
      bytes,
      fileName,
      blobUrl,
      verifyFlag: String(body.verify ?? "true").toLowerCase() !== "false",
      limit: clampLimit(body.limit),
    };
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    throw Object.assign(
      new Error(
        "Missing filing. Upload a multipart field named file, or send JSON { blobUrl }.",
      ),
      { status: 400 },
    );
  }
  const fileName = file.name || "upload.pdf";
  if (!isAcceptedFiling(fileName, file.type)) {
    throw Object.assign(
      new Error("Only PDF and Word (.docx) uploads are supported."),
      { status: 400 },
    );
  }
  // Direct multipart must stay under the platform body wall. Larger filings
  // go through /api/pdf/upload → Blob → this route with blobUrl.
  if (file.size > DIRECT_BODY_MAX_BYTES) {
    throw Object.assign(
      new Error(
        `That file is ${describeBytes(file.size)}. Files over ${DIRECT_BODY_MAX_LABEL} must upload via Blob storage first.`,
      ),
      { status: 413 },
    );
  }
  if (file.size > MAX_PDF_BYTES) {
    throw Object.assign(
      new Error(
        `That file is ${describeBytes(file.size)}, over the ${MAX_PDF_LABEL} upload limit.`,
      ),
      { status: 413 },
    );
  }
  return {
    bytes: new Uint8Array(await file.arrayBuffer()),
    fileName,
    verifyFlag: String(form.get("verify") ?? "true").toLowerCase() !== "false",
    limit: clampLimit(form.get("limit")),
  };
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  let blobUrl: string | undefined;
  try {
    const incoming = await readIncoming(request);
    blobUrl = incoming.blobUrl;

    const extracted = await extractFilingText(incoming.bytes, incoming.fileName);
    const format =
      extracted.format || filingFormatFromName(incoming.fileName) || "pdf";

    if (!extracted.hasTextLayer) {
      const emptyError =
        format === "docx"
          ? "This Word document has little or no extractable text for citation detection. Try a .docx export, or paste the citations."
          : extracted.textSource === "ocr"
            ? "OCR ran on this scanned PDF but recovered too little text for citation detection. Try a clearer scan, or paste the citations."
            : "This PDF has little or no extractable text, and OCR could not recover enough to continue. Try a text-based export, or paste the citations.";
      return NextResponse.json(
        {
          error: emptyError,
          fileName: extracted.fileName,
          pageCount: extracted.pageCount,
          charCount: extracted.charCount,
          hasTextLayer: false,
          textSource: extracted.textSource,
          format,
          ocr: extracted.ocr,
        },
        { status: 422 },
      );
    }

    const cites = extractCitationsFromPages(extracted.pages, {
      verifyLimit: incoming.limit,
    });

    const verifyItems: VerifyItem[] = cites.verifyItems;
    const results: LookupResult[] = [];
    const controlPromise =
      incoming.verifyFlag && verifyItems.length ? runMethodControls() : null;
    if (incoming.verifyFlag && verifyItems.length) {
      for (const item of verifyItems) {
        results.push(await lookupOneSafe(item.citation, item.passages));
      }
    }
    const controlRun = controlPromise ? await controlPromise : undefined;
    const counts = tallyConsensus(results);
    const interesting = cites.citations.filter((c) =>
      ["authority", "case_reporter", "case_westlaw", "case_name"].includes(c.kind),
    );

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
          "Filing extract (PDF or Word .docx) + citation pairing, then coverage-aware existence probe and quote checking via CourtListener + CAP static.case.law. We check what the opinion says, not whether it supports the argument. Constructed public links (Justia / LOC / Scholar) are references only and never affect the verdict.",
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
          : extracted.textSource === "docx"
            ? "mammoth .docx text → reporter/Westlaw + case-name pairing → quote harvest → coverage-aware verify"
            : "pdf-parse text layer → reporter/Westlaw + case-name pairing → quote harvest → coverage-aware verify",
      document: {
        fileName: extracted.fileName,
        format,
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
      verified: incoming.verifyFlag,
      diagnostics: {
        elapsedMs: Date.now() - startedAt,
        queued: cites.verifyQueue.length,
        verifiedInRequest: results.length,
        textSource: extracted.textSource,
        ocr: extracted.ocr,
        viaBlob: Boolean(blobUrl),
      },
      resultCount: results.length,
      counts,
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Filing verification failed";
    const status =
      typeof err === "object" &&
      err &&
      "status" in err &&
      typeof (err as { status: unknown }).status === "number"
        ? (err as { status: number }).status
        : message.includes("limit") ||
            message.includes("empty") ||
            message.includes("Only PDF") ||
            message.includes("Only .docx") ||
            message.includes("Word") ||
            message.includes("Missing") ||
            message.includes("Invalid")
          ? 400
          : 500;
    return NextResponse.json({ error: message }, { status });
  } finally {
    if (blobUrl) await deleteFilingBlob(blobUrl);
  }
}
