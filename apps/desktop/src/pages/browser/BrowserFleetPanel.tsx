import { useTranslation } from "react-i18next";
import { Globe, X } from "lucide-react";

import { browserFleet, useFleetWindows } from "../../core/browser.ts";
import { useSessions } from "../../core/sessions/index.ts";
import { cn } from "../../lib/cn.ts";

// The browser-window god-view: every live window across ALL sessions (agents are scoped to their own
// windows; the user is not), labelled with its owning session. Click a window to view it, X to close it.
// Windows are agent-opened only — there is no URL box. Electron only — no fleet on the web, renders nothing.
export function BrowserFleetPanel() {
  const { t } = useTranslation();
  const windows = useFleetWindows();
  const sessions = useSessions();

  if (!browserFleet().available()) return null;

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4">
      <h3 className="mb-2 text-sm font-semibold text-neutral-900">{t("browser.title")}</h3>
      {windows.length === 0 && <p className="px-1 py-1 text-xs text-neutral-400">{t("browser.empty")}</p>}
      {windows.map((w) => {
        const owner = sessions.find((s) => s.id === w.ownerSessionId);
        return (
          <div
            key={w.id}
            className={cn("group flex items-center gap-0.5 rounded-lg pr-1", w.state === "active" ? "bg-neutral-100" : "hover:bg-neutral-100/70")}
          >
            <button
              type="button"
              onClick={() => browserFleet().view(w.id)}
              className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5 text-left text-sm text-neutral-700"
            >
              <span
                className={cn("h-1.5 w-1.5 shrink-0 rounded-full", w.loading ? "animate-pulse bg-neutral-300" : "bg-green-500")}
                title={w.loading ? t("browser.loading") : t("browser.loaded")}
              />
              <Globe size={15} className="shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{w.title || w.url}</span>
                {owner && <span className="block truncate text-xs text-neutral-400">{owner.title}</span>}
              </span>
            </button>
            <button
              type="button"
              onClick={() => void browserFleet().close(w.id)}
              title={t("browser.close")}
              className="shrink-0 rounded-md p-1 text-neutral-400 opacity-0 hover:bg-neutral-200 hover:text-red-600 group-hover:opacity-100"
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </section>
  );
}
