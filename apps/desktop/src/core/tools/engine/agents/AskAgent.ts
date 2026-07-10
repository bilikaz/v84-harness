import { BaseEngineTool, type EngineCtx, type EngineToolResult } from "../base.ts";
import type { ToolSpec, ToolCallRequest } from "../../types.ts";
import { ASK_SCHEMA, aliasOf, childrenOf, resolveChild, rosterHint } from "../../helpers/agents/catalog.ts";
import { fanOut, type Planned } from "../../helpers/agents/fanout.ts";
import { getStreamingIds } from "../../../sessions/store.ts";

// Delegation: send a follow-up MESSAGE to sub-agents you already started, by short id — each answers from its
// existing context (reusing its loaded knowledge). Batch (several at once); replies come back tagged. For new
// work / questions; to merely revive a crashed run, use ResumeAgent. Top-level only; advertised when there are
// children. The dispatch/format loop is shared via fanOut; this tool is just the planner.
export class AskAgent extends BaseEngineTool {
  get schema(): ToolSpec {
    return ASK_SCHEMA;
  }

  override available(ec: EngineCtx): boolean {
    return childrenOf(ec.sessionId).length > 0;
  }

  async run(call: ToolCallRequest, ec: EngineCtx): Promise<EngineToolResult> {
    const sid = ec.sessionId;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
    } catch {
      /* keep {} — the shape check below answers with usage */
    }
    // Lenient: {runs:[{id, message}]}, the flat {id, message}.
    const raw = Array.isArray(args.runs) ? args.runs : args.id !== undefined ? [args] : [];
    const runs = raw as Record<string, unknown>[];
    if (!runs.length) return { output: `AskAgent needs runs: [{id, message}, …] — the id is from ActiveAgents or a run result.\n${rosterHint(sid)}` };

    return fanOut(ec, call, runs, "re-tasked", (run) => this.plan(run, ec));
  }

  // Plan one run: resolve the child by short id, then deliver the message (a fresh turn on its existing
  // context). A child already running is skipped — there's nothing to wait on / push.
  private plan(run: Record<string, unknown>, ec: EngineCtx): Planned {
    const sid = ec.sessionId;
    const child = resolveChild(sid, run.id);
    if (!child) return { error: `agent (id: ${String(run.id)}): no such sub-agent. ${rosterHint(sid)}` };
    const alias = aliasOf(child);
    const message = String(run.message ?? "").trim();
    if (!message) return { error: `agent (id: ${alias}): missing message — say what to ask or tell it.` };
    if (getStreamingIds().has(child.id)) return { error: `agent (id: ${alias}): already running — wait for it to finish before re-tasking it.` };
    return { childSid: child.id, alias, name: child.title, task: message };
  }
}
