import { downscaleImage } from "./imageResize.ts";
import type { FileAttachment, Image, Video } from "./types.ts";
import type { ConfigApp } from "../core/config/defaults.ts";

const FILE_TEXT_CAP = 256 * 1024; // cap a single attached file's text so it can't blow the context

// The attachment size/dimension bounds ARE the app's media config slice; the caller resolves imageMaxDim per-model.
export type AttachmentLimits = ConfigApp["media"];

export function readAttachments(
  list: FileList,
  limits: AttachmentLimits,
): Promise<{ images: Image[]; video: Video[]; files: FileAttachment[]; skipped: string[]; resized: string[] }> {
  const maxDim = limits.imageMaxDim;
  const images: Image[] = [];
  const video: Video[] = [];
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
            r.onerror = () => resolve(); // a failed read must settle, or Promise.all hangs forever
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
            r.onerror = () => resolve(); // a failed read must settle, or Promise.all hangs forever
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
