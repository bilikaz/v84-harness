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
