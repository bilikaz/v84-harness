import { mimeToExt, parseDataUrl } from "./dataUrl.ts";
import { harness, isElectron } from "./harness.ts";

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
