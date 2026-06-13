export { parseDataUrl } from "../lib/dataUrl.ts";

export function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

// Skip the prefix if base already ends with it — reverse proxies like https://proxy/anthropic/v1 must not be double-suffixed.
export function baseWithPrefix(baseUrl: string, fallback: string, prefix: string): string {
  const b = (baseUrl || fallback).replace(/\/+$/, "");
  return b.endsWith(prefix) ? b : `${b}${prefix}`;
}

// Include the response body in the error — "401 Unauthorized" alone hides the server's actual rejection message.
export async function expectOk(res: Response): Promise<Response> {
  if (res.ok) return res;
  const text = await res.text().catch(() => "");
  throw new Error(`${res.status} ${res.statusText} ${text}`.trim());
}
