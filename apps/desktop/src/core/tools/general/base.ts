import { type ToolResult } from "../types.ts";
import type { LLMConfig } from "../../config/llm.ts";
import type { MediaService } from "../../../llm/types.ts";
import { BaseTool } from "../base.ts";

// General tools: available in any session (chat or workspace), never permission-checked, run in the renderer.
export abstract class BaseGeneralTool extends BaseTool {
  // The configured target for a media service, or a "not configured" result the tool returns directly.
  protected requireSlot(service: MediaService, label: string): LLMConfig | ToolResult {
    const target = this.llm.resolve(service);
    if (!target) return { ok: false, output: `${label} is not configured. Assign a model in Settings → Media models.` };
    return target;
  }
}
