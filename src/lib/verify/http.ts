const UA = "citeproof-case-law-verification-engine/1.0 (+https://github.com/newanforbi/case-law-verification-engine)";

export async function httpGet(
  url: string,
  options: { accept?: string; timeoutMs?: number; retries?: number } = {},
): Promise<{ status: number; contentType: string; body: Buffer }> {
  const accept = options.accept ?? "application/json";
  const timeoutMs = options.timeoutMs ?? 45_000;
  const retries = options.retries ?? 3;
  let last = { status: -1, contentType: "error", body: Buffer.from("") };

  for (let attempt = 0; attempt < retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: accept },
        signal: controller.signal,
        cache: "no-store",
      });
      const ab = await res.arrayBuffer();
      const body = Buffer.from(ab);
      clearTimeout(timer);
      if ([429, 502, 503, 504].includes(res.status) && attempt + 1 < retries) {
        last = {
          status: res.status,
          contentType: res.headers.get("content-type") ?? "",
          body,
        };
        await sleep(1500 * (attempt + 1));
        continue;
      }
      return {
        status: res.status,
        contentType: res.headers.get("content-type") ?? "",
        body,
      };
    } catch (err) {
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : String(err);
      last = { status: -1, contentType: "error", body: Buffer.from(message) };
      if (attempt + 1 < retries) {
        await sleep(750 * (attempt + 1));
        continue;
      }
    }
  }
  return last;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
