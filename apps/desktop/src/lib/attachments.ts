import { downscaleImage } from "./imageResize.ts";
import type { FileAttachment, MediaRef } from "./types.ts";

const FILE_TEXT_CAP = 256 * 1024; // cap a single attached file's text so it can't blow the context

// The caps this door enforces — values come from core/config via the caller
// (lib never imports core; the layering arrows are ui→lib and core→lib).
export interface AttachmentLimits {
  imageMaxDim: number; // model pixel cap (already resolved via effectiveImageMaxDim)
  imageMaxBytes: number; // transport bounds (config media.*Bytes)
  gifMaxBytes: number;
  videoMaxBytes: number;
}

// Read picked files: images & video → data-URL attachments (multimodal),
// everything else → text attachments folded into the message. Images over the
// model's longest-side cap are downscaled in place and reported in `resized`
// — dimensions are the model check; the byte caps are transport sanity
// bounds, and media over them is SKIPPED and reported in `skipped` so the
// composer can say so. Shared by the session composer and the agent runner.
export function readAttachments(
  list: FileList,
  limits: AttachmentLimits,
): Promise<{ images: MediaRef[]; video: MediaRef[]; files: FileAttachment[]; skipped: string[]; resized: string[] }> {
  const maxDim = limits.imageMaxDim;
  const images: MediaRef[] = [];
  const video: MediaRef[] = [];
  const files: FileAttachment[] = [];
  const skipped: string[] = [];
  const resized: string[] = [];
  return Promise.all(
    Array.from(list).map(
      (f) =>
        new Promise<void>((resolve) => {
          const r = new FileReader();
          if (f.type.startsWith("image/")) {
            if (f.size > (f.type === "image/gif" ? limits.gifMaxBytes : limits.imageMaxBytes)) {
              skipped.push(f.name);
              return resolve();
            }
            r.onload = () => {
              const url = String(r.result);
              void downscaleImage(url, f.type, maxDim).then((d) => {
                if (d) resized.push(f.name);
                images.push({ url: d?.url ?? url, mime: d?.mime ?? f.type, name: f.name });
                resolve();
              });
            };
            r.readAsDataURL(f);
          } else if (f.type.startsWith("video/")) {
            if (f.size > limits.videoMaxBytes) {
              skipped.push(f.name);
              return resolve();
            }
            r.onload = () => {
              video.push({ url: String(r.result), mime: f.type, name: f.name });
              resolve();
            };
            r.readAsDataURL(f);
          } else {
            r.onload = () => {
              const full = String(r.result);
              const text =
                full.length > FILE_TEXT_CAP
                  ? full.slice(0, FILE_TEXT_CAP) + `\n\n[...truncated; ${full.length - FILE_TEXT_CAP} more bytes]`
                  : full;
              files.push({ name: f.name, text, bytes: full.length });
              resolve();
            };
            r.onerror = () => resolve();
            r.readAsText(f);
          }
        }),
    ),
  ).then(() => ({ images, video, files, skipped, resized }));
}
