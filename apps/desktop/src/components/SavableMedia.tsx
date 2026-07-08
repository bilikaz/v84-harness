import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";

import { openLightbox } from "../core/ui.ts";
import { saveMedia } from "../lib/saveMedia.ts";
import { useCtx } from "../renderer/ctx.tsx";

// A media thumbnail/player with a Save button overlaid in the top corner. `badge` shows the media
// reference alias ("img-3") — the handle the user (and model) can name in a follow-up.
export function SavableMedia(props: { kind: "image" | "video"; src: string; name?: string; className?: string; badge?: string }) {
  const { kind, src, name, className, badge } = props;
  const { t } = useTranslation();
  const ctx = useCtx();
  async function save(e: React.MouseEvent) {
    e.stopPropagation();
    await saveMedia(ctx, src, kind, name);
  }
  return (
    <div className="group relative inline-block">
      {kind === "image" ? (
        <img src={src} alt={name ?? ""} onClick={() => openLightbox(src)} className={className} />
      ) : (
        <video src={src} controls className={className} />
      )}
      {badge && (
        <span className="absolute left-2 top-2 rounded-md bg-black/50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-white">
          {badge}
        </span>
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
