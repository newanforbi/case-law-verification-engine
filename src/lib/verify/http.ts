const UA = "citeproof-case-law-verification-engine/1.0 (+https://github.com/newanforbi/case-law-verification-engine)";

export type HttpResult = { status: number; contentType: string; body: Buffer };

async function request(
  url: string,
  init: {
    method?: string;
    accept?: string;
    timeoutMs?: number;
    retries?: number;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<HttpResult> {
  const accept = init.accept ?? "application/json";
  const timeoutMs = init.timeoutMs ?? 45_000;
  const retries = init.retries ?? 3;
  let last: HttpResult = { status: -1, contentType: "error", body: Buffer.from("") };

  for (let attempt = 0; attempt < retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: init.method ?? "GET",
        headers: {
          "User-Agent": UA,
          Accept: accept,
          ...(init.headers ?? {}),
        },
        body: init.body,
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

export async function httpGet(
  url: string,
  options: { accept?: string; timeoutMs?: number; retries?: number } = {},
): Promise<HttpResult> {
  return request(url, options);
}

/** Form-encoded POST (CourtListener citation-lookup). */
export async function httpPostForm(
  url: string,
  fields: Record<string, string>,
  options: {
    accept?: string;
    timeoutMs?: number;
    retries?: number;
    authorization?: string;
  } = {},
): Promise<HttpResult> {
  const body = new URLSearchParams(fields).toString();
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (options.authorization) headers.Authorization = options.authorization;
  return request(url, {
    method: "POST",
    accept: options.accept ?? "application/json",
    timeoutMs: options.timeoutMs,
    retries: options.retries ?? 2,
    headers,
    body,
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
