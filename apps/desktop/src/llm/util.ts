export { parseDataUrl } from "../lib/dataUrl.ts";

// Returns {} (never throws) so malformed model-emitted tool-call arguments degrade to empty args, not a crashed turn.
export function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

// Append the version prefix only to a bare origin. Any path means the user already supplied the version base
// (https://proxy/anthropic/v1, https://api.edenai.run/v3) and we must not bolt /v1 on top of it.
export function baseWithPrefix(baseUrl: string, fallback: string, prefix: string): string {
  // Strip trailing slashes, then collapse any accidental // inside the path (the scheme's :// is preserved).
  const b = (baseUrl || fallback).replace(/\/+$/, "").replace(/([^:])\/{2,}/g, "$1/");
  const bareOrigin = b === "" || /^[a-z][\w+.-]*:\/\/[^/]+$/i.test(b);
  return bareOrigin ? `${b}${prefix}` : b;
}

// Include the response body in the error — "401 Unauthorized" alone hides the server's actual rejection message.
export async function expectOk(res: Response): Promise<Response> {
  if (res.ok) return res;
  const text = await res.text().catch(() => "");
  throw new Error(`${res.status} ${res.statusText} ${text}`.trim());
}
