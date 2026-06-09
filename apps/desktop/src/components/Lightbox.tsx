import { useEffect } from "react";
import { X } from "lucide-react";

import { closeLightbox, useLightbox } from "../lib/ui.ts";

// Full-screen image viewer. Opened via openLightbox(url) from any thumbnail;
// dismissed by clicking the backdrop, the close button, or Escape.
export function Lightbox() {
  const url = useLightbox();

  useEffect(() => {
    if (!url) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLightbox();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [url]);

  if (!url) return null;

  return (
    <div
      onClick={closeLightbox}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
    >
      <button
        type="button"
        onClick={closeLightbox}
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
        title="Close (Esc)"
      >
        <X size={20} />
      </button>
      {/* Stop propagation so clicking the image itself doesn't dismiss. */}
      <img
        src={url}
        alt=""
        onClick={(e) => e.stopPropagation()}
        className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
      />
    </div>
  );
}
