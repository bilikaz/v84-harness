import { BaseEngineTool, type EngineCtx, type EngineToolResult } from "../base.ts";
import type { ToolSpec, ToolCallRequest } from "../../types.ts";
import { browserFleet } from "../../../browser.ts";
import { sessionWindowsHint } from "./list.ts";

// Soft per-session ceiling so a confused model can't spawn windows endlessly — at the cap, opening is
// refused and the existing windows are listed to reuse instead.
const MAX_WINDOWS = 5;

// The browser ACTION: open a fresh window (id "new") or navigate one of yours in place. Windows are owned
// by the calling session and addressed by short ids (1, 2, …). Returns a short status — read with
// BrowserContent. Gated (ask): loading arbitrary URLs is the consequential bit; the reads are not.
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
          "rather than guessing. After it loads, read the page with BrowserContent.",
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
      await fleet.whenLoaded(newId);
      const w = fleet.record(newId);
      if (!w) return { output: `the window was closed before it finished loading.`, browserWindowId: newId };
      return { output: `opened browser ${w.alias} at ${url} — loaded. Read it with BrowserContent {id: ${w.alias}}.`, browserWindowId: newId };
    }

    const w = fleet.recordByAlias(ec.sessionId, id);
    if (!w) return { output: `no browser "${id}" in this session. ${sessionWindowsHint(ec.sessionId)}` };
    await fleet.navigate(w.id, url);
    await fleet.whenLoaded(w.id);
    if (!fleet.record(w.id)) return { output: `browser ${id} was closed before it finished loading.`, browserWindowId: w.id };
    return { output: `browser ${id} navigated to ${url} — loaded. Read it with BrowserContent {id: ${id}}.`, browserWindowId: w.id };
  }
}
