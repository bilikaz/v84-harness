// Save a base64 data-URL (image or video) to disk via a native Save dialog.
// Shared by the `saveImage`/`saveVideo` IPC handlers and the right-click
// context menu so the dialog + write behaviour lives in one place.

import { writeFile } from "node:fs/promises";

type Electron = typeof import("electron");

// Returns the written path, or null if the user cancelled or the input wasn't
// a recognized image/video data URL.
export async function saveDataUrl(dialog: Electron["dialog"], dataUrl: string): Promise<string | null> {
  const m = /^data:((?:image|video)\/[\w.+-]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  const [, mime, b64] = m;
  const isVideo = mime.startsWith("video/");
  const ext = isVideo
    ? mime.includes("webm")
      ? "webm"
      : mime.split("/")[1] || "mp4"
    : mime === "image/jpeg"
      ? "jpg"
      : mime === "image/webp"
        ? "webp"
        : mime.split("/")[1] || "png";
  const res = await dialog.showSaveDialog({
    defaultPath: `generated.${ext}`,
    filters: [{ name: isVideo ? "Video" : "Image", extensions: [ext] }],
  });
  if (res.canceled || !res.filePath) return null;
  await writeFile(res.filePath, Buffer.from(b64, "base64"));
  return res.filePath;
}
