import { Download, X } from "lucide-react";

import { closeLightbox, useLightbox } from "../lib/ui.ts";
import { useEscapeKey } from "../lib/hooks.ts";
import { saveMedia } from "../lib/saveMedia.ts";

// Full-screen image viewer. Opened via openLightbox(url) from any thumbnail;
// dismissed by clicking the backdrop, the image, the close button, or Escape.
export function Lightbox() {
  const url = useLightbox();
  useEscapeKey(!!url, closeLightbox);

  if (!url) return null;

  async function save(e: React.MouseEvent) {
    e.stopPropagation();
    if (url) await saveMedia(url, "image");
  }

  return (
    <div
      onClick={closeLightbox}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
    >
      <div className="absolute right-4 top-4 flex gap-2">
        <button
          type="button"
          onClick={save}
          className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          title="Save image"
        >
          <Download size={20} />
        </button>
        <button
          type="button"
          onClick={closeLightbox}
          className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          title="Close (Esc)"
        >
          <X size={20} />
        </button>
      </div>
      {/* Clicking the image dismisses too (back to its original size on the
          page) — same as the backdrop. */}
      <img
        src={url}
        alt=""
        onClick={closeLightbox}
        className="max-h-full max-w-full cursor-zoom-out rounded-lg object-contain shadow-2xl"
      />
    </div>
  );
}
