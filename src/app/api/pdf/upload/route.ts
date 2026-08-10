import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { allowedUploadContentTypes, isAcceptedFiling } from "@/lib/filing/kinds";
import { blobConfigured } from "@/lib/pdf/blob";
import { MAX_PDF_BYTES } from "@/lib/pdf/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Client-upload token exchange for large filings (PDF / Word .docx).
 *
 * The browser uploads straight to Vercel Blob so the file never rides through
 * the serverless request body (the ~4.5 MB wall). This route only mints a
 * short-lived token constrained to accepted types under the product size cap.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!blobConfigured()) {
    return NextResponse.json(
      {
        error:
          "Blob storage is not configured. Add a Vercel Blob store (BLOB_READ_WRITE_TOKEN) to accept files over 4 MB.",
      },
      { status: 503 },
    );
  }

  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const base = pathname.split("/").pop() || pathname;
        if (!isAcceptedFiling(base)) {
          throw new Error("Only PDF and Word (.docx) uploads are allowed.");
        }
        if (!pathname.startsWith("filings/")) {
          throw new Error("Invalid upload path.");
        }
        return {
          allowedContentTypes: allowedUploadContentTypes(),
          maximumSizeInBytes: MAX_PDF_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ kind: "filing" }),
        };
      },
      onUploadCompleted: async () => {
        // Filings are pulled immediately by /api/verify-pdf and deleted there.
        // No persistence needed.
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload token failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
