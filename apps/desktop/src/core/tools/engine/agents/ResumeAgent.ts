import { BaseEngineTool, type EngineCtx, type EngineToolResult } from "../base.ts";
import type { ToolSpec, ToolCallRequest } from "../../types.ts";
import { RESUME_SCHEMA, aliasOf, childrenOf, resolveChild, rosterHint } from "../../helpers/agents/catalog.ts";
import { fanOut, type Planned } from "../../helpers/agents/fanout.ts";
import { getStreamingIds, getUserPausedIds } from "../../../sessions/store.ts";

// Recovery: bare-continue crashed/stalled sub-agents by their short id — NO message, so each finishes its
// task instead of answering a re-prompt ("Understood"). Reuses the preserved history (continues from the
// gathered tool results). Top-level only; advertised only when this session has children. The dispatch/format
// loop is shared via fanOut; this tool is just the planner.
export class ResumeAgent extends BaseEngineTool {
  get schema(): ToolSpec {
    return RESUME_SCHEMA;
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
    // Lenient: {runs:[{id}]}, {ids:[2,3]}, the flat {id}.
    const raw = Array.isArray(args.runs)
      ? args.runs
      : Array.isArray(args.ids)
        ? args.ids.map((id) => ({ id }))
        : args.id !== undefined
          ? [{ id: args.id }]
          : [];
    const runs = raw as Record<string, unknown>[];
    if (!runs.length) return { output: `ResumeAgent needs runs: [{id}, …] — the id is the short number from the failure message.\n${rosterHint(sid)}` };

    return fanOut(ec, call, runs, "resumed", (run) => this.plan(run, ec));
  }

  // Plan one run: resolve the child by short id, then bare-continue it. A child the USER paused is theirs to
  // continue — the parent must not yank it back mid-guidance; one already running has nothing to resume.
  private plan(run: Record<string, unknown>, ec: EngineCtx): Planned {
    const sid = ec.sessionId;
    const child = resolveChild(sid, run.id);
    if (!child) return { error: `no sub-agent #${String(run.id)} to resume. ${rosterHint(sid)}` };
    const alias = aliasOf(child);
    if (getUserPausedIds().has(child.id)) return { error: `agent ${alias} was paused by the user and is theirs to continue — leave it to them.` };
    if (getStreamingIds().has(child.id)) return { error: `agent ${alias} is already running — nothing to resume.` };
    return { childSid: child.id, alias, name: child.title, dispatch: ec.engine.resume(child.id) };
  }
}
