/**
 * Browser-side filing intake: small files stay on multipart; larger ones go to
 * Vercel Blob so they never hit the serverless body ceiling.
 */
import { upload } from "@vercel/blob/client";
import {
  contentTypeForFormat,
  ensureFilingExtension,
  filingFormatFromName,
} from "@/lib/filing/kinds";
import {
  DIRECT_BODY_MAX_BYTES,
  MAX_PDF_BYTES,
  MAX_PDF_LABEL,
  describeBytes,
} from "./limits";

export type FilingIntake =
  | { mode: "direct"; file: File }
  | { mode: "blob"; blobUrl: string; fileName: string };

/** @deprecated Use FilingIntake */
export type PdfIntake = FilingIntake;

export function assertFilingFile(file: File): void {
  const format = filingFormatFromName(file.name, file.type);
  if (!format) {
    throw new Error("Only PDF and Word (.docx) files are accepted.");
  }
  if (file.size > MAX_PDF_BYTES) {
    throw new Error(
      `That file is ${describeBytes(file.size)}, over the ${MAX_PDF_LABEL} upload limit. Split it, or export a smaller copy.`,
    );
  }
}

/** @deprecated Use assertFilingFile */
export function assertPdfFile(file: File): void {
  assertFilingFile(file);
  if (filingFormatFromName(file.name, file.type) !== "pdf") {
    throw new Error("Only PDF files are accepted.");
  }
}

/**
 * Choose the intake path. Files that fit under the direct body wall skip Blob
 * so local/dev works without BLOB_READ_WRITE_TOKEN. Larger files require Blob.
 */
export async function intakeFiling(file: File): Promise<FilingIntake> {
  assertFilingFile(file);
  const format = filingFormatFromName(file.name, file.type)!;
  if (file.size <= DIRECT_BODY_MAX_BYTES) {
    return { mode: "direct", file };
  }

  const fileName = ensureFilingExtension(file.name, format);
  const pathname = `filings/${fileName}`;
  try {
    const blob = await upload(pathname, file, {
      access: "private",
      handleUploadUrl: "/api/pdf/upload",
      multipart: file.size > 8 * 1024 * 1024,
      contentType: contentTypeForFormat(format),
    });
    return { mode: "blob", blobUrl: blob.url, fileName: file.name || fileName };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/not configured|503|BLOB_READ_WRITE_TOKEN/i.test(msg)) {
      throw new Error(
        `That file is ${describeBytes(file.size)} and needs Blob storage. Add a Vercel Blob store to this project, or upload a file under 4 MB.`,
      );
    }
    throw new Error(`Could not upload that file to storage (${msg}).`);
  }
}

/** @deprecated Use intakeFiling */
export async function intakePdf(file: File): Promise<FilingIntake> {
  return intakeFiling(file);
}
