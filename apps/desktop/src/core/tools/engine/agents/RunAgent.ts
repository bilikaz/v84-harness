import { BaseEngineTool, type EngineCtx, type EngineToolResult } from "../base.ts";
import type { ToolSpec, ToolCallRequest } from "../../types.ts";
import { RUN_SCHEMA, aliasOf, catalogAgents, resolveAgent } from "../../helpers/agents/catalog.ts";
import { fanOut, type Planned } from "../../helpers/agents/fanout.ts";
import { getSession } from "../../../sessions/store.ts";

// Orchestration half of the sub-agent pair: spawn stored agents as concurrent child sessions and collect
// their answers. Hard-depends on the engine (it spawns/stops sessions), reached via ec.engine — which is
// exactly why this is an engine tool and not a registry tool. Top-level only (depth-1); the dispatcher
// blocks it for sub-agents. The dispatch/format loop is shared via fanOut; this tool is just the planner.
export class RunAgent extends BaseEngineTool {
  get schema(): ToolSpec {
    return RUN_SCHEMA;
  }

  override available(ec: EngineCtx): boolean {
    return catalogAgents(!!ec.workspace).length > 0;
  }

  async run(call: ToolCallRequest, ec: EngineCtx): Promise<EngineToolResult> {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
    } catch {
      /* keep {} — the shape check below answers with usage */
    }
    // Lenient input: {runs: [...]}, the {agents: [...]} alias, and the flat {agent, task} shape all accepted.
    const raw = Array.isArray(args.runs) ? args.runs : Array.isArray(args.agents) ? args.agents : args.agent ? [args] : [];
    const runs = raw as Record<string, unknown>[];
    if (!runs.length) return { output: "RunAgent needs runs: [{agent, task}, …] — one entry per sub-agent run." };

    return fanOut(ec, call, runs, "started", (run) => this.plan(run, ec));
  }

  // Plan one run: resolve the agent, then spawn it as a fresh child session. runAgent starts the turn
  // eagerly and returns its in-flight Promise as the dispatch.
  private plan(run: Record<string, unknown>, ec: EngineCtx): Planned {
    const resolved = resolveAgent(String(run.agent ?? ""), !!ec.workspace);
    if (typeof resolved === "string") return { error: resolved };
    const task = String(run.task ?? "").trim();
    if (!task) return { error: `"${resolved.name}": missing task — say what the agent should do, with all the context it needs.` };
    const { sid: childSid, result } = ec.engine.runAgent(resolved, task, {
      parentId: ec.sessionId,
      // The PARENT SESSION's container, not the capability-masked workspace — children inherit placement, not the mask.
      containerId: getSession(ec.sessionId)?.containerId ?? "",
      activate: false,
    });
    return { childSid, alias: aliasOf(getSession(childSid) ?? ({} as never)), name: resolved.name, dispatch: result };
  }
}
