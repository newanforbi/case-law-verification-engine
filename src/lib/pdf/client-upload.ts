/**
 * Browser-side PDF intake: small files stay on multipart; larger ones go to
 * Vercel Blob so they never hit the serverless body ceiling.
 */
import { upload } from "@vercel/blob/client";
import {
  DIRECT_BODY_MAX_BYTES,
  MAX_PDF_BYTES,
  MAX_PDF_LABEL,
  describeBytes,
} from "./limits";

export type PdfIntake =
  | { mode: "direct"; file: File }
  | { mode: "blob"; blobUrl: string; fileName: string };

function safeFileName(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
  const trimmed = base.slice(0, 80) || "filing.pdf";
  return trimmed.toLowerCase().endsWith(".pdf") ? trimmed : `${trimmed}.pdf`;
}

export function assertPdfFile(file: File): void {
  if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
    throw new Error("Only PDF files are accepted.");
  }
  if (file.size > MAX_PDF_BYTES) {
    throw new Error(
      `That PDF is ${describeBytes(file.size)}, over the ${MAX_PDF_LABEL} upload limit. Split it, or export a text-only copy.`,
    );
  }
}

/**
 * Choose the intake path. Files that fit under the direct body wall skip Blob
 * so local/dev works without BLOB_READ_WRITE_TOKEN. Larger files require Blob.
 */
export async function intakePdf(file: File): Promise<PdfIntake> {
  assertPdfFile(file);
  if (file.size <= DIRECT_BODY_MAX_BYTES) {
    return { mode: "direct", file };
  }

  const fileName = safeFileName(file.name);
  const pathname = `filings/${fileName}`;
  try {
    const blob = await upload(pathname, file, {
      access: "private",
      handleUploadUrl: "/api/pdf/upload",
      multipart: file.size > 8 * 1024 * 1024,
      contentType: "application/pdf",
    });
    return { mode: "blob", blobUrl: blob.url, fileName: file.name || fileName };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/not configured|503|BLOB_READ_WRITE_TOKEN/i.test(msg)) {
      throw new Error(
        `That PDF is ${describeBytes(file.size)} and needs Blob storage. Add a Vercel Blob store to this project, or upload a file under 4 MB.`,
      );
    }
    throw new Error(`Could not upload that PDF to storage (${msg}).`);
  }
}
