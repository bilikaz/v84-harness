// Renderer-side image downscaling to the model's longest-side cap — Canvas APIs only, so never import from Electron main.

import { bytesToB64, parseDataUrl } from "./dataUrl.ts";

// A degenerate cap (0/negative/NaN) is also a no-op — a bad config value must never collapse images to 1×1.
export async function downscaleImage(
  url: string,
  mime: string,
  maxDim: number,
): Promise<{ url: string; mime: string } | null> {
  if (!Number.isFinite(maxDim) || maxDim <= 0) return null;
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
    // quality applies to jpeg/webp only; an encoder that can't produce the requested type falls back to png — out.type is the truth.
    const out = await canvas.convertToBlob({ type: mime, quality: 0.9 });
    const bytes = new Uint8Array(await out.arrayBuffer());
    return { url: `data:${out.type};base64,${bytesToB64(bytes)}`, mime: out.type };
  } catch {
    return null;
  }
}
