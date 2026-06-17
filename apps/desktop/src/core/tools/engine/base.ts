// The engine tool tier — "driver-level" tools that need the live engine/ctx (the browser fleet, the
// sub-agent spawner), not just config, so they can't be BaseTool registry tools (ADR-0048). The engine
// dispatches them before the registry/policy paths. The folder layout mirrors plugins STRUCTURALLY only
// (one file per tool, one folder per family); there is no per-folder service.ts — the "service" is the
// engine/ctx, handed in through the EngineCtx at dispatch.

import type { Ctx } from "../../ctx.ts";
import type { Container } from "../../containers.ts";
import type { SessionEngine } from "../../sessions/engine.ts";
import type { Image, Video, ToolSpec, ToolCallRequest, ToolPermission } from "../types.ts";

// Everything an engine tool gets per call — the live engine/ctx that registry tools are denied.
export interface EngineCtx {
  ctx: Ctx;
  sessionId: string;
  workspace: Container | undefined; // the capability-masked workspace, exactly as the turn computed it
  signal: AbortSignal;
  isChild: boolean; // a sub-agent run — engine tools are top-level only unless childSafe
  engine: SessionEngine; // for tools that spawn/stop sessions (RunAgent)
}

// What an engine tool returns; the engine emits the tool:result and feeds any images to the vision step.
export interface EngineToolResult {
  output: string;
  images?: Image[];
  videos?: Video[];
  childSessionIds?: string[]; // spawned child sessions, for the tool-card links
  browserWindowId?: string; // a browser window this call opened/navigated, for the tool-card link
}

export abstract class BaseEngineTool {
  abstract get schema(): ToolSpec;
  // Top-level only by default: a sub-agent can't reach these (depth-1, ADR-0022). Flip for child-safe tools.
  readonly childSafe: boolean = false;
  // Capability gate for advertisement (fleet present, a model configured). Defaults to always-available.
  available(_ec: EngineCtx): boolean {
    return true;
  }
  // Policy mode when nothing overrides — ask (1) for consequential tools, allow (2) for reads.
  defaultPermission(): ToolPermission {
    return 2;
  }
  abstract run(call: ToolCallRequest, ec: EngineCtx): Promise<EngineToolResult>;
}
