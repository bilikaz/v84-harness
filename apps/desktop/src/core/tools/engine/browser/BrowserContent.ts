import { BaseEngineTool, type EngineCtx, type EngineToolResult } from "../base.ts";
import type { ToolSpec, ToolCallRequest } from "../../types.ts";
import { browserFleet } from "../../../browser.ts";
import { sessionWindowsHint } from "./list.ts";
import { readWindow } from "./read.ts";

// The browser RE-READ: read one of your windows again — its live url/title/extracted text, the links to
// navigate next, and a snapshot. Browser already returns the page on open/navigate, so reach for this
// mainly to pick a window back up after the user interacted with it. Session-scoped (your windows only).
export class BrowserContent extends BaseEngineTool {
  get schema(): ToolSpec {
    return {
      type: "function",
      function: {
        name: "BrowserContent",
        description:
          "Re-read a browser window you opened: its current url, title and extracted page text, plus the " +
          "links you can navigate to, and a snapshot. Browser already returns the page when you open or " +
          "navigate it — use this to pick a window back up later (e.g. after the user acted in it). Use its " +
          "id (e.g. 1) from ActiveBrowsers.",
        parameters: {
          type: "object",
          properties: { id: { type: "string", description: "The window id (e.g. 1)." } },
          required: ["id"],
          additionalProperties: false,
        },
      },
    };
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
      /* keep {} — the check below answers with usage */
    }
    const id = String(args.id ?? "").trim();
    if (!id) return { output: `BrowserContent needs an id. ${sessionWindowsHint(ec.sessionId)}` };
    const w = fleet.recordByAlias(ec.sessionId, id);
    if (!w) return { output: `no browser "${id}" in this session. ${sessionWindowsHint(ec.sessionId)}` };
    const read = await fleet.withWindow(w.id, () => readWindow(fleet, id, w.id));
    if (!read) return { output: `browser ${id} is no longer open — the user closed it. ${sessionWindowsHint(ec.sessionId)}` };
    return read;
  }
}
