import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Globe, Plus, X } from "lucide-react";

import { browserFleet, useFleetWindows } from "../../core/browser.ts";
import { cn } from "../../lib/cn.ts";

// The browser-window fleet, on the agent-fleet rails: one chip per window (active / minimized /
// closed-tombstone), click a live one to view it, plus a URL box to seed a window. Electron
// only — the host has no fleet on the web, so the panel renders nothing there.
export function BrowserFleetPanel() {
  const { t } = useTranslation();
  const windows = useFleetWindows();
  const [url, setUrl] = useState("");

  if (!browserFleet().available()) return null;

  async function open(): Promise<void> {
    const u = url.trim();
    if (!u) return;
    const href = /^https?:\/\//i.test(u) ? u : `https://${u}`;
    setUrl("");
    const id = await browserFleet().open(href);
    if (id) browserFleet().view(id);
  }

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4">
      <h3 className="mb-2 text-sm font-semibold text-neutral-900">{t("browser.title")}</h3>
      {windows.length === 0 && <p className="px-1 py-1 text-xs text-neutral-400">{t("browser.empty")}</p>}
      {windows.map((w) => {
        const closed = w.state === "closed";
        return (
          <div
            key={w.id}
            className={cn("group flex items-center gap-0.5 rounded-lg pr-1", w.state === "active" ? "bg-neutral-100" : "hover:bg-neutral-100/70")}
          >
            <button
              type="button"
              disabled={closed}
              onClick={() => browserFleet().view(w.id)}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5 text-left text-sm",
                closed ? "text-neutral-400 line-through" : "text-neutral-700",
              )}
            >
              <Globe size={15} className="shrink-0" />
              <span className="truncate">{closed ? t("browser.closed") : w.title || w.url}</span>
            </button>
            {!closed && (
              <button
                type="button"
                onClick={() => void browserFleet().close(w.id)}
                title={t("browser.close")}
                className="shrink-0 rounded-md p-1 text-neutral-400 opacity-0 hover:bg-neutral-200 hover:text-red-600 group-hover:opacity-100"
              >
                <X size={13} />
              </button>
            )}
          </div>
        );
      })}
      <div className="mt-2 flex items-center gap-1">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void open();
          }}
          placeholder={t("browser.urlPlaceholder")}
          className="min-w-0 flex-1 rounded-md border border-neutral-200 px-2 py-1 text-sm outline-none placeholder:text-neutral-400"
        />
        <button type="button" onClick={() => void open()} title={t("browser.open")} className="shrink-0 rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100">
          <Plus size={16} />
        </button>
      </div>
    </section>
  );
}
