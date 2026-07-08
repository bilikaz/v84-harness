// Data-URL + binary helpers — dependency-free on purpose: imported by renderer, providers, AND Electron main, so no React or Node-only modules.

export function parseDataUrl(url: string): { mime: string; b64: string } | null {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(url);
  return m ? { mime: m[1], b64: m[2] } : null;
}

export function mimeToExt(mime: string): string {
  if (mime.startsWith("video/")) return mime.includes("webm") ? "webm" : mime.split("/")[1] || "mp4";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return mime.split("/")[1] || "png";
}

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

// Chunked so large payloads (videos) don't blow the call stack; works in both renderer and Node.
export function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return typeof btoa !== "undefined" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
}

// The inverse of bytesToB64 — decode base64 to raw bytes (renderer + Node). Used to build multipart
// image uploads (e.g. /images/edits) from a base64 payload.
export function b64ToBytes(b64: string): Uint8Array {
  const bin = typeof atob !== "undefined" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
