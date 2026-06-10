// Data-URL + binary helpers — the ONE source for the parse regex, the
// mime→extension mapping, and portable base64. Dependency-free on purpose:
// imported by the renderer (tools, components), the providers, and Electron
// main (saveMedia), so it must not pull in React or Node-only modules.

// Split a `data:<mime>;base64,<data>` URL into its parts. Returns null for
// non-data (http) URLs, which callers pass through as a URL source instead.
export function parseDataUrl(url: string): { mime: string; b64: string } | null {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(url);
  return m ? { mime: m[1], b64: m[2] } : null;
}

// File extension for a media MIME type (jpeg→jpg etc.). Defaults to the
// subtype, falling back to png/mp4 for unparseable image/video types.
export function mimeToExt(mime: string): string {
  if (mime.startsWith("video/")) return mime.includes("webm") ? "webm" : mime.split("/")[1] || "mp4";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return mime.split("/")[1] || "png";
}

// MIME type for a media file extension — the inverse of mimeToExt, for tools
// that load media from disk. Returns undefined for anything that isn't a
// supported image/video type (the caller decides how to reject).
const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};
export function extToMime(ext: string): string | undefined {
  return EXT_MIME[ext.toLowerCase().replace(/^\./, "")];
}

// Portable base64 of binary (works in the renderer AND node, no Buffer
// dependency in the browser) — chunked so large payloads (videos) don't blow
// the call stack.
export function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return typeof btoa !== "undefined" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
}
