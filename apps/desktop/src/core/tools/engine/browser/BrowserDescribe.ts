import { BaseEngineTool, type EngineCtx, type EngineToolResult } from "../base.ts";
import type { ToolSpec, ToolCallRequest } from "../../types.ts";
import { textHandler } from "../../../../llm/index.ts";
import { browserFleet } from "../../../browser.ts";
import { sessionWindowsHint } from "./list.ts";

// The BLIND-AGENT view: screenshot the page and run it through the configured image-recognition model,
// returning a TEXT description of the page's structure — forms, fields, buttons, links, layout, what's
// interactive. A text-only agent "sees" the page's logic, not just its scraped text. Mirrors ImageDescribe,
// pointed at a live window instead of a file. Advertised only when an imageRec model is configured.
const SYSTEM =
  "You are a precise web-page analysis assistant. You receive one or more screenshots of a web page (taken " +
  "from the top down — the top of the page first, then lower sections) and an instruction from an automated " +
  "agent that cannot see it — your answer is its only view. Treat the screenshots as one continuous page. Describe the " +
  "page's STRUCTURE and how to act on it: forms and their fields (with labels), buttons and links, " +
  "navigation, and overall layout. Say what is interactive and how a user would accomplish the main task. " +
  "Transcribe key visible text faithfully and give approximate positions (e.g. 'top-right'). Never invent " +
  "elements that aren't visible. Answer compactly, no preamble.";

export class BrowserDescribe extends BaseEngineTool {
  get schema(): ToolSpec {
    return {
      type: "function",
      function: {
        name: "BrowserDescribe",
        description:
          'Describe a browser window\'s page STRUCTURE using the image model — forms, fields, buttons, links, ' +
          "layout, what's interactive. Use it to understand a page's logic beyond its raw text (especially if " +
          "you can't see images yourself). Use the window id (e.g. 1). Optionally ask a specific question.",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "The window id (e.g. 1)." },
            query: { type: "string", description: "What to ask about the page. Omit for a full structural description." },
          },
          required: ["id"],
          additionalProperties: false,
        },
      },
    };
  }

  override available(ec: EngineCtx): boolean {
    return !!browserFleet()?.available() && ec.ctx.resolve("imageRec") != null;
  }

  async run(call: ToolCallRequest, ec: EngineCtx): Promise<EngineToolResult> {
    const fleet = browserFleet();
    if (!fleet?.available()) return { output: "the browser-window fleet is not available on this host." };
    if (!ec.ctx.resolve("imageRec")) return { output: "BrowserDescribe is not configured. Assign an image recognition model in Settings → Media models." };
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
    } catch {
      /* keep {} — the check below answers with usage */
    }
    const id = String(args.id ?? "").trim();
    if (!id) return { output: `BrowserDescribe needs an id. ${sessionWindowsHint(ec.sessionId)}` };
    const w = fleet.recordByAlias(ec.sessionId, id);
    if (!w) return { output: `no browser "${id}" in this session. ${sessionWindowsHint(ec.sessionId)}` };
    const shots = await fleet.withWindow(w.id, () => fleet.capturePage(w.id));
    if (!shots.length) return { output: `browser ${id}: capture failed — the page may still be rendering. Try again, or use BrowserContent for its text. ${sessionWindowsHint(ec.sessionId)}` };
    const query =
      typeof args.query === "string" && args.query.trim()
        ? args.query.trim()
        : "Describe this web page's structure: forms and fields, buttons, links, navigation, layout, and how to accomplish the main task.";
    const answer = await ec.ctx.llm.call({
      service: "imageRec",
      handler: textHandler(),
      system: SYSTEM,
      signal: ec.signal,
      messages: [{ role: "user", content: query, images: shots.map((url) => ({ url, mime: "image/png" })) }],
    });
    return {
      output: answer || "(the image model returned an empty answer)",
      images: shots.map((url, i) => ({ url, mime: "image/png", name: `browser-${id}${i ? `-${i + 1}` : ""}.png` })),
    };
  }
}
