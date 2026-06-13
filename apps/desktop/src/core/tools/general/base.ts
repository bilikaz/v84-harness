import { type MediaUseCase, type ToolResult, type ConfigLLM } from "../types.ts";
import { BaseTool } from "../base.ts";

// General tools: available in any session (chat or workspace), never permission-checked, run in the renderer.
export abstract class BaseGeneralTool extends BaseTool {
  // The configured target for a media service, or a "not configured" result the tool returns directly.
  protected requireSlot(service: MediaUseCase, label: string): ConfigLLM | ToolResult {
    const target = this.ctx.config.llm[service];
    if (!target) return { ok: false, output: `${label} is not configured. Assign a model in Settings → Media models.` };
    return target;
  }
}
