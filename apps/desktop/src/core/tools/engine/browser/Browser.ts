import { BaseEngineTool, type EngineCtx, type EngineToolResult } from "../base.ts";
import type { ToolSpec, ToolCallRequest } from "../../types.ts";
import { browserFleet } from "../../../browser.ts";
import { sessionWindowsHint } from "./list.ts";
import { readWindow } from "./read.ts";

// Soft per-session ceiling so a confused model can't spawn windows endlessly — at the cap, opening is
// refused and the existing windows are listed to reuse instead.
const MAX_WINDOWS = 5;

// The browser ACTION: open a fresh window (id "new") or navigate one of yours in place. Windows are owned
// by the calling session and addressed by short ids (1, 2, …). Returns the loaded page (text + links +
// snapshot) directly, so no follow-up read is needed. Gated (ask): loading arbitrary URLs is consequential.
export class Browser extends BaseEngineTool {
  get schema(): ToolSpec {
    return {
      type: "function",
      function: {
        name: "Browser",
        description:
          "Open or navigate a browser window and load a URL. To follow a link or move on, REUSE a window you " +
          "already have — pass its id (e.g. 1) to navigate it in place (keeping its session/login). Pass " +
          'id:"new" only when you genuinely need a separate window. Check ActiveBrowsers for your window ids ' +
          "rather than guessing. Returns the loaded page (text, links, snapshot) — no separate read needed.",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: 'The window id to navigate (e.g. 1), or "new" to open a fresh window.' },
            url: { type: "string", description: "Absolute URL to load." },
          },
          required: ["id", "url"],
          additionalProperties: false,
        },
      },
    };
  }

  override defaultPermission(): 0 | 1 | 2 {
    return 1; // ask — loading arbitrary URLs is consequential, unlike the read tools
  }

  override available(): boolean {
    return !!browserFleet()?.available();
  }

  async run(call: ToolCallRequest, ec: EngineCtx): Promise<EngineToolResult> {
    const fleet = browserFleet();
    if (!fleet?.available()) return { output: "the browser-window fleet is not available on this host." };
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
    } catch {
      /* keep {} — the checks below answer with usage */
    }
    const id = String(args.id ?? "").trim();
    const url = String(args.url ?? "").trim();
    if (!url) return { output: 'Browser needs a url to load (and id:"new" for a fresh window).' };
    if (!id) return { output: `Browser needs an id — "new" for a fresh window, or an existing one. ${sessionWindowsHint(ec.sessionId)}` };

    if (id === "new") {
      const open = fleet.windowsForSession(ec.sessionId);
      if (open.length >= MAX_WINDOWS) {
        return { output: `you already have ${open.length} browser windows open — reuse one instead of opening more.\n${sessionWindowsHint(ec.sessionId)}` };
      }
      const newId = await fleet.open(url, ec.sessionId);
      if (!newId) return { output: "could not open a browser window." };
      // Hold the window across load → read so the page is returned here — no separate BrowserContent needed.
      const read = await fleet.withWindow(newId, async () => {
        await fleet.whenLoaded(newId);
        const w = fleet.record(newId);
        return w ? readWindow(fleet, w.alias, newId) : null;
      });
      if (!read) return { output: `the window was closed before it finished loading.`, browserWindowId: newId };
      return { ...read, browserWindowId: newId };
    }

    const w = fleet.recordByAlias(ec.sessionId, id);
    if (!w) return { output: `no browser "${id}" in this session. ${sessionWindowsHint(ec.sessionId)}` };
    const read = await fleet.withWindow(w.id, async () => {
      await fleet.navigate(w.id, url);
      await fleet.whenLoaded(w.id);
      return fleet.record(w.id) ? readWindow(fleet, id, w.id) : null;
    });
    if (!read) return { output: `browser ${id} was closed before it finished loading.`, browserWindowId: w.id };
    return { ...read, browserWindowId: w.id };
  }
}
