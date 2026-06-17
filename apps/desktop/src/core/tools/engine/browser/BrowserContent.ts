import { BaseEngineTool, type EngineCtx, type EngineToolResult } from "../base.ts";
import type { ToolSpec, ToolCallRequest } from "../../types.ts";
import { cap } from "../../base.ts";
import { browserFleet } from "../../../browser.ts";
import { sessionWindowsHint } from "./list.ts";

// The browser GETTER: read one of your windows — its live url/title/extracted text + the links to navigate
// next. Session-scoped: you can only read windows you opened, addressed by short id (1, 2, …).
export class BrowserContent extends BaseEngineTool {
  get schema(): ToolSpec {
    return {
      type: "function",
      function: {
        name: "BrowserContent",
        description:
          "Read a browser window you opened: its current url, title and extracted page text, plus the links " +
          "you can navigate to. Use its id (e.g. 1) from ActiveBrowsers or the Browser result. Returns the " +
          "live page, reflecting any navigation.",
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
    const content = await fleet.getContent(w.id);
    if (!content) return { output: `browser ${id} is no longer open — the user closed it. ${sessionWindowsHint(ec.sessionId)}` };
    const links = content.links.length ? `\n\nLinks on this page (navigate with Browser {id: ${id}, url}):\n${content.links.join("\n")}` : "";
    // Give a vision-capable model the page screenshot alongside the text (its own eyes on the layout).
    // The engine downscales it; text-only models should use BrowserDescribe instead.
    let images: { url: string; mime: string; name: string }[] | undefined;
    if (ec.ctx.resolve("main")?.input?.image !== false) {
      const shot = await fleet.capturePage(w.id);
      if (shot) images = [{ url: shot, mime: "image/png", name: `browser-${id}.png` }];
    }
    return { output: cap(`browser ${id} — ${content.title}\nurl: ${content.url}\n\n${content.text}${links}`), images };
  }
}
