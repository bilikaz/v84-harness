import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";

import { openLightbox } from "../lib/ui.ts";
import { saveMedia } from "../lib/saveMedia.ts";

// A media thumbnail/player with a Save button overlaid in the top corner.
export function SavableMedia(props: { kind: "image" | "video"; src: string; name?: string; className?: string }) {
  const { kind, src, name, className } = props;
  const { t } = useTranslation();
  async function save(e: React.MouseEvent) {
    e.stopPropagation();
    await saveMedia(src, kind, name);
  }
  return (
    <div className="group relative inline-block">
      {kind === "image" ? (
        <img src={src} alt={name ?? ""} onClick={() => openLightbox(src)} className={className} />
      ) : (
        <video src={src} controls className={className} />
      )}
      <button
        type="button"
        onClick={save}
        title={kind === "image" ? t("common.saveImage") : t("common.saveVideo")}
        className="absolute right-2 top-2 rounded-full bg-black/50 p-1.5 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100"
      >
        <Download size={16} />
      </button>
    </div>
  );
}
