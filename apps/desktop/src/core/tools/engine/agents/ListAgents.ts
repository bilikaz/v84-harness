import { BaseEngineTool, type EngineCtx, type EngineToolResult } from "../base.ts";
import type { ToolSpec, ToolCallRequest } from "../../types.ts";
import { LIST_SCHEMA, catalogAgents, listAgentsOutput } from "../../helpers/agents/catalog.ts";

// Discovery half of the sub-agent pair: what an orchestrator may run. Top-level only; advertised only
// when the context has a runnable agent catalog.
export class ListAgents extends BaseEngineTool {
  get schema(): ToolSpec {
    return LIST_SCHEMA;
  }

  override available(ec: EngineCtx): boolean {
    return catalogAgents(!!ec.workspace).length > 0;
  }

  async run(_call: ToolCallRequest, ec: EngineCtx): Promise<EngineToolResult> {
    return { output: listAgentsOutput(!!ec.workspace) };
  }
}
