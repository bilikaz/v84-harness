// Save a base64 data-URL (image or video) to disk via a native Save dialog.

import { writeFile } from "node:fs/promises";

import { mimeToExt, parseDataUrl } from "../lib/dataUrl.ts";

type Electron = typeof import("electron");

export async function saveDataUrl(dialog: Electron["dialog"], dataUrl: string, suggestedName?: string): Promise<string | null> {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed || !/^(image|video)\//.test(parsed.mime)) return null;
  const isVideo = parsed.mime.startsWith("video/");
  const ext = mimeToExt(parsed.mime);
  const res = await dialog.showSaveDialog({
    defaultPath: suggestedName || `generated.${ext}`,
    filters: [{ name: isVideo ? "Video" : "Image", extensions: [ext] }],
  });
  if (res.canceled || !res.filePath) return null;
  await writeFile(res.filePath, Buffer.from(parsed.b64, "base64"));
  return res.filePath;
}
