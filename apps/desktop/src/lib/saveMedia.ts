import { mimeToExt, parseDataUrl } from "./dataUrl.ts";
import { harness, isElectron } from "./harness.ts";

// Save a media data-URL: native Save dialog in Electron, browser download on
// the web. The one implementation behind the lightbox and the message
// thumbnails' Save buttons.
export async function saveMedia(src: string, kind: "image" | "video", name?: string): Promise<void> {
  if (isElectron()) {
    await (kind === "image" ? harness!.saveImage(src) : harness!.saveVideo(src));
    return;
  }
  const a = document.createElement("a");
  a.href = src;
  const mime = parseDataUrl(src)?.mime;
  a.download = name ?? `generated.${mime ? mimeToExt(mime) : kind === "image" ? "png" : "mp4"}`;
  a.click();
}
