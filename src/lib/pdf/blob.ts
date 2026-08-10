/**
 * Vercel Blob helpers for large PDF uploads.
 *
 * Filings go to a private store so they are not world-readable; the verify
 * route pulls them server-side with the read-write token, then deletes them.
 */
import { del, get } from "@vercel/blob";
import { MAX_PDF_BYTES, describeBytes, MAX_PDF_LABEL } from "./limits";

export function blobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/** Only accept URLs that look like our Vercel Blob store. */
export function assertFilingBlobUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid blob URL.");
  }
  const host = parsed.hostname.toLowerCase();
  if (!host.endsWith(".blob.vercel-storage.com") && host !== "blob.vercel-storage.com") {
    throw new Error("That URL is not a Vercel Blob filing upload.");
  }
  if (!parsed.pathname.includes("/filings/")) {
    throw new Error("That blob is not a Citeproof filing upload.");
  }
  return parsed;
}

async function streamToBytes(
  stream: ReadableStream<Uint8Array>,
  limitBytes: number,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limitBytes) {
      throw new Error(
        `That PDF is over the ${MAX_PDF_LABEL} limit (${describeBytes(total)} read so far).`,
      );
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function downloadFilingBlob(url: string): Promise<{
  bytes: Uint8Array;
  size: number;
}> {
  assertFilingBlobUrl(url);
  const result = await get(url, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) {
    throw new Error("Could not download that uploaded PDF from storage.");
  }
  if (result.blob.size != null && result.blob.size > MAX_PDF_BYTES) {
    throw new Error(
      `That PDF is ${describeBytes(result.blob.size)}, over the ${MAX_PDF_LABEL} upload limit.`,
    );
  }
  const bytes = await streamToBytes(result.stream, MAX_PDF_BYTES);
  return { bytes, size: bytes.byteLength };
}

export async function deleteFilingBlob(url: string): Promise<void> {
  try {
    assertFilingBlobUrl(url);
    await del(url);
  } catch {
    // Best-effort cleanup — verify should not fail because delete did.
  }
}
