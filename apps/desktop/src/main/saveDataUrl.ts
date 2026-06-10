// Save a base64 data-URL (image or video) to disk via a native Save dialog.
// Shared by the `saveImage`/`saveVideo` IPC handlers and the right-click
// context menu so the dialog + write behaviour lives in one place.

import { writeFile } from "node:fs/promises";

import { mimeToExt, parseDataUrl } from "../lib/dataUrl.ts";

type Electron = typeof import("electron");

// Returns the written path, or null if the user cancelled or the input wasn't
// a recognized image/video data URL.
export async function saveDataUrl(dialog: Electron["dialog"], dataUrl: string): Promise<string | null> {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed || !/^(image|video)\//.test(parsed.mime)) return null;
  const isVideo = parsed.mime.startsWith("video/");
  const ext = mimeToExt(parsed.mime);
  const res = await dialog.showSaveDialog({
    defaultPath: `generated.${ext}`,
    filters: [{ name: isVideo ? "Video" : "Image", extensions: [ext] }],
  });
  if (res.canceled || !res.filePath) return null;
  await writeFile(res.filePath, Buffer.from(parsed.b64, "base64"));
  return res.filePath;
}
