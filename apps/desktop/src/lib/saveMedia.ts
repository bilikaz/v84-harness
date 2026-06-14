import { mimeToExt, parseDataUrl } from "./dataUrl.ts";
import type { Ctx } from "../core/ctx.ts";

// Save generated media through the host api — electron opens a save dialog, the browser downloads. The default
// filename is computed here (agnostic); platforms that take a name use it, electron ignores it for its dialog.
export async function saveMedia(ctx: Ctx, src: string, kind: "image" | "video", name?: string): Promise<void> {
  const mime = parseDataUrl(src)?.mime;
  const suggested = name ?? `generated.${mime ? mimeToExt(mime) : kind === "image" ? "png" : "mp4"}`;
  await (kind === "image" ? ctx.api.saveImage?.(src, suggested) : ctx.api.saveVideo?.(src, suggested));
}
