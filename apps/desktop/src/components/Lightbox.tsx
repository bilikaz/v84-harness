import { useEffect } from "react";
import { Download, X } from "lucide-react";

import { closeLightbox, useLightbox } from "../lib/ui.ts";
import { harness, isElectron } from "../lib/harness.ts";

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

  // Save the image: native Save dialog in Electron, browser download on the web.
  async function save(e: React.MouseEvent) {
    e.stopPropagation();
    if (!url) return;
    if (isElectron()) {
      await harness!.saveImage(url);
    } else {
      const a = document.createElement("a");
      a.href = url;
      a.download = "generated.png";
      a.click();
    }
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
