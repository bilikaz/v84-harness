import type { FileAttachment, MediaRef } from "./types.ts";

const FILE_TEXT_CAP = 256 * 1024; // cap a single attached file's text so it can't blow the context

// Read picked files: images & video → data-URL attachments (multimodal),
// everything else → text attachments folded into the message. Shared by the
// session composer and the agent runner.
export function readAttachments(list: FileList): Promise<{ images: MediaRef[]; video: MediaRef[]; files: FileAttachment[] }> {
  const images: MediaRef[] = [];
  const video: MediaRef[] = [];
  const files: FileAttachment[] = [];
  return Promise.all(
    Array.from(list).map(
      (f) =>
        new Promise<void>((resolve) => {
          const r = new FileReader();
          if (f.type.startsWith("image/")) {
            r.onload = () => {
              images.push({ url: String(r.result), mime: f.type, name: f.name });
              resolve();
            };
            r.readAsDataURL(f);
          } else if (f.type.startsWith("video/")) {
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
  ).then(() => ({ images, video, files }));
}
