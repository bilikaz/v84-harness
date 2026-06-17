import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Minus, X } from "lucide-react";

import { useCtx } from "../../renderer/ctx.tsx";
import { browserFleet, buildForward, useFleetWindows, useViewingId } from "../../core/browser.ts";
import { Composer } from "../workspace/Composer.tsx";

// The full-content browser overlay: the native WebContentsView (painted by main) fills the
// frame, the composer persists below with minimize (left) / close (right). Forwarding a page
// sends a hidden snapshot + a visible "regarding window id" comment, then auto-minimizes so
// the agent's reply is visible.
export function BrowserOverlay() {
  const { t } = useTranslation();
  const ctx = useCtx();
  const viewingId = useViewingId();
  const windows = useFleetWindows();
  const frameRef = useRef<HTMLDivElement>(null);

  // Report the frame's live rect to main so it can position the native view over it (and
  // re-position on any resize). Main scales these CSS pixels by the host zoom factor.
  useEffect(() => {
    if (!viewingId) return;
    const el = frameRef.current;
    if (!el) return;
    const place = (): void => {
      const r = el.getBoundingClientRect();
      void browserFleet().show(viewingId, { x: r.left, y: r.top, width: r.width, height: r.height });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    window.addEventListener("resize", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [viewingId]);

  if (!viewingId) return null;
  const id = viewingId;
  const win = windows.find((w) => w.id === id);

  // Route the comment to the window's OWNING session, not the focused one — the agent that opened this
  // window (and is waiting on a login/filter) is the one that needs to continue.
  async function forward(text: string): Promise<void> {
    const fwd = await buildForward(id, text);
    if (fwd && win) void ctx.sessions.sendTo(win.ownerSessionId, fwd.text, { context: fwd.context });
    await browserFleet().unview();
  }

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-white">
      <div ref={frameRef} className="min-h-0 flex-1 bg-neutral-100" />
      <div className="border-t border-neutral-200 bg-white px-3 py-2">
        <div className="mb-1 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void browserFleet().unview()}
            title={t("browser.minimize")}
            className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100"
          >
            <Minus size={16} />
          </button>
          <span className="min-w-0 flex-1 truncate text-center text-xs text-neutral-500">{win?.title || win?.url}</span>
          <button
            type="button"
            onClick={() => void browserFleet().close(id)}
            title={t("browser.close")}
            className="rounded-md p-1.5 text-neutral-500 hover:bg-red-50 hover:text-red-600"
          >
            <X size={16} />
          </button>
        </div>
        <Composer onSubmit={(text) => void forward(text)} />
      </div>
    </div>
  );
}
