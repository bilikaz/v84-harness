// Renderer-side image downscaling — the ONE place images are fitted to the
// model's longest-side cap (ModelConfig.imageMaxDim; default below). Both
// media doors run it in the renderer: composer attachments
// (lib/attachments.ts) and tool-produced images in the driver
// (core/sessions/driver.ts) — LoadImage reads files at full resolution in
// main and the result is downscaled here on its way to the model. Canvas
// APIs only, so this must never be imported by Electron main.

import { bytesToB64, parseDataUrl } from "./dataUrl.ts";

// Most VLMs are trained around ~2048px on the longest side — anything bigger
// only burns visual tokens for no extra signal.
export const DEFAULT_IMAGE_MAX_DIM = 2048;

// Downscale a data-URL image to fit maxDim on its longest side, keeping the
// aspect ratio. Returns the re-encoded data URL, or null when the image is
// left untouched: already fits, GIF (canvas would keep only the first frame),
// non-data URL, or decode failure — resizing is best-effort and must never
// block a send.
export async function downscaleImage(
  url: string,
  mime: string,
  maxDim: number,
): Promise<{ url: string; mime: string } | null> {
  if (mime === "image/gif" || !parseDataUrl(url)) return null;
  try {
    const blob = await (await fetch(url)).blob();
    const bmp = await createImageBitmap(blob);
    const scale = maxDim / Math.max(bmp.width, bmp.height);
    if (scale >= 1) {
      bmp.close();
      return null;
    }
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    // quality applies to jpeg/webp; png ignores it. An encoder that can't
    // produce the requested type falls back to png — out.type is the truth.
    const out = await canvas.convertToBlob({ type: mime, quality: 0.9 });
    const bytes = new Uint8Array(await out.arrayBuffer());
    return { url: `data:${out.type};base64,${bytesToB64(bytes)}`, mime: out.type };
  } catch {
    return null;
  }
}
