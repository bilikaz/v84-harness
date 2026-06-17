import { BaseEngineTool, type EngineCtx, type EngineToolResult } from "../base.ts";
import type { ToolSpec, ToolCallRequest } from "../../types.ts";
import { browserFleet } from "../../../browser.ts";
import { sessionWindowsHint } from "./list.ts";

// List the live browser windows owned by THIS session (by short id) — a window you opened that is absent
// here has been closed. Session-scoped: you never see another agent's windows. Use it to get the right id
// instead of guessing.
export class ActiveBrowsers extends BaseEngineTool {
  get schema(): ToolSpec {
    return {
      type: "function",
      function: {
        name: "ActiveBrowsers",
        description:
          "List the browser windows you have open in this session, with their ids (1, 2, …), titles and urls. " +
          "Use it to get the right id before reading or navigating. A window you opened that is NOT listed has been closed.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    };
  }

  override available(): boolean {
    return !!browserFleet()?.available();
  }

  async run(_call: ToolCallRequest, ec: EngineCtx): Promise<EngineToolResult> {
    const fleet = browserFleet();
    if (!fleet?.available()) return { output: "the browser-window fleet is not available on this host." };
    await fleet.refresh();
    return { output: sessionWindowsHint(ec.sessionId) };
  }
}
