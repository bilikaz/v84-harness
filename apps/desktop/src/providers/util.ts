// Split a `data:<mime>;base64,<data>` URL into its parts. Returns null for
// non-data (http) URLs, which providers pass through as a URL source instead.
export function parseDataUrl(url: string): { mime: string; b64: string } | null {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(url);
  return m ? { mime: m[1], b64: m[2] } : null;
}

// Parse tool-call arguments (a JSON string). Falls back to {} on malformed JSON
// so a bad arguments blob doesn't crash the request mapping.
export function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
