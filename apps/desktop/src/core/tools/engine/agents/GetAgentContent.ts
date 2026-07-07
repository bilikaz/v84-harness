import { BaseEngineTool, type EngineCtx, type EngineToolResult } from "../base.ts";
import type { ToolSpec, ToolCallRequest } from "../../types.ts";
import { GET_CONTENT_SCHEMA, childrenOf, collectAgentContent, isChildPending, resolveChild, rosterHint } from "../../helpers/agents/catalog.ts";
import { setDelivered } from "../../../sessions/store.ts";
import { getAppConfig } from "../../../config/index.ts";

// Read-only fetch of a FINISHED sub-agent's result by short id — one or many at once. The pull half of the
// async orchestration flow (the parent is told an agent finished, then reads it here). Distinct from
// AskAgent, which sends a new message and makes the agent work again; this only returns what is already
// there. A still-running / user-paused agent is "not done" and cannot be read (in async mode a premature
// fetch is erased; here it returns a notice). Top-level only; advertised once the session has children.
export class GetAgentContent extends BaseEngineTool {
  get schema(): ToolSpec {
    return GET_CONTENT_SCHEMA;
  }

  // Async-only: in sync mode the parent gets results inline from RunAgent, so this read tool is just noise.
  override available(ec: EngineCtx): boolean {
    return getAppConfig().session.asyncAgents && childrenOf(ec.sessionId).length > 0;
  }

  async run(call: ToolCallRequest, ec: EngineCtx): Promise<EngineToolResult> {
    const sid = ec.sessionId;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
    } catch {
      /* keep {} — the shape check below answers with usage */
    }
    // Lenient: {ids:[2,3]}, {runs:[{id}]}, the flat {id}.
    const raw = Array.isArray(args.ids)
      ? args.ids
      : Array.isArray(args.runs)
        ? args.runs.map((r) => (r as Record<string, unknown>)?.id)
        : args.id !== undefined
          ? [args.id]
          : [];
    if (!raw.length) return { output: `getAgentContent needs ids: [1, 2, …] — the short numbers of the finished agents.\n${rosterHint(sid)}` };

    // Premature fetch: any requested agent still running/paused → erase the whole call and end the turn. It
    // looks like it never happened; the ready ones (if any) arrive via the push anyway. Don't poll.
    if (raw.some((id) => { const c = resolveChild(sid, id); return c && isChildPending(c); })) return { output: "", eraseTurn: true };

    const { output, childIds } = await collectAgentContent(sid, raw);
    for (const cid of childIds) setDelivered(cid, true); // read into the parent's transcript — a boot won't re-deliver
    return { output, childSessionIds: childIds.length ? childIds : undefined };
  }
}
