import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useCtx } from "../../renderer/ctx.tsx";
import { openLightbox } from "../../core/ui.ts";
import { LAYOUTS, supportedCounts } from "../../core/gallery/catalog.ts";
import { newId } from "../../core/ids.ts";

// The user's layout browser: every gallery layout as preview + handle + name, grouped by image count;
// click opens the full-size preview in the lightbox — so the user knows exactly what to ask the agent
// for ("use 5-3"). Previews come through the GalleryOptions tool (rendered in main, cached there).
export function GallerySection() {
  const { t } = useTranslation();
  const ctx = useCtx();
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    void (async () => {
      for (const count of supportedCounts()) {
        try {
          const res = await ctx.tools.run({ id: newId(), name: "GalleryOptions", arguments: JSON.stringify({ count }), cwd: "" });
          if (!live) return;
          if (!res?.ok || !res.images) {
            setError(res?.output ?? t("gallery.unavailable"));
            return;
          }
          const matches = LAYOUTS.filter((l) => l.count === count);
          setPreviews((prev) => {
            const next = { ...prev };
            res.images?.forEach((im, i) => {
              if (matches[i]) next[matches[i].id] = im.url;
            });
            return next;
          });
        } catch {
          if (live) setError(t("gallery.unavailable"));
          return;
        }
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <p className="text-sm text-neutral-500">{t("gallery.hint")}</p>
      {error && <p className="text-sm text-amber-600">{error}</p>}
      {supportedCounts().map((count) => (
        <div key={count}>
          <h3 className="mb-2 text-sm font-semibold text-neutral-700">{t("gallery.groupTitle", { count })}</h3>
          <div className="grid grid-cols-3 gap-3">
            {LAYOUTS.filter((l) => l.count === count).map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => previews[l.id] && openLightbox(previews[l.id])}
                title={l.description}
                className="rounded-lg border border-neutral-200 p-2 text-left hover:border-neutral-400"
              >
                {previews[l.id] ? (
                  <img src={previews[l.id]} alt={l.name} className="w-full rounded" />
                ) : (
                  <div className="aspect-[210/297] w-full animate-pulse rounded bg-neutral-100" />
                )}
                <div className="mt-1.5 flex items-baseline gap-2">
                  <span className="font-mono text-xs font-bold text-neutral-800">{l.handle}</span>
                  <span className="truncate text-xs text-neutral-500">{l.name}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
