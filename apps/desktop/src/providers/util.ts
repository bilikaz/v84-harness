// Data-URL parsing lives in lib/dataUrl.ts (the one source, shared with main +
// the tools); re-exported here so the mappers keep their single util import.
export { parseDataUrl } from "../lib/dataUrl.ts";

// Parse tool-call arguments (a JSON string). Falls back to {} on malformed JSON
// so a bad arguments blob doesn't crash the request mapping.
export function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

// Normalize a provider base URL: apply the fallback, strip trailing slashes, and
// append the provider's path prefix ("/v1", "/v1beta") unless the base already
// ends with it — reverse proxies like https://proxy/anthropic/v1 must not be
// double-suffixed.
export function baseWithPrefix(baseUrl: string, fallback: string, prefix: string): string {
  const b = (baseUrl || fallback).replace(/\/+$/, "");
  return b.endsWith(prefix) ? b : `${b}${prefix}`;
}

// Guard for non-streaming responses (model listing etc.). Includes the response
// body in the error — "401 Unauthorized" alone hides the server's actual
// rejection message.
export async function expectOk(res: Response): Promise<Response> {
  if (res.ok) return res;
  const text = await res.text().catch(() => "");
  throw new Error(`${res.status} ${res.statusText} ${text}`.trim());
}
