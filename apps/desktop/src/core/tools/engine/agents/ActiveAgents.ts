import { BaseEngineTool, type EngineCtx, type EngineToolResult } from "../base.ts";
import type { ToolSpec, ToolCallRequest } from "../../types.ts";
import { ACTIVE_SCHEMA, childrenOf, rosterHint } from "./catalog.ts";

// The orchestrator's live team: each sub-agent's short id, status, and memory %. Pure metadata — never the
// agents' responses (those are already in this conversation; echoing them would duplicate and bloat). Top-level
// only; advertised once there are sub-agents to see.
export class ActiveAgents extends BaseEngineTool {
  get schema(): ToolSpec {
    return ACTIVE_SCHEMA;
  }

  override available(ec: EngineCtx): boolean {
    return childrenOf(ec.sessionId).length > 0;
  }

  async run(_call: ToolCallRequest, ec: EngineCtx): Promise<EngineToolResult> {
    return { output: rosterHint(ec.sessionId) };
  }
}
