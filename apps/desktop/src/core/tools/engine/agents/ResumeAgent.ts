import { BaseEngineTool, type EngineCtx, type EngineToolResult } from "../base.ts";
import type { ToolSpec, ToolCallRequest } from "../../types.ts";
import { RESUME_SCHEMA, aliasOf, childrenOf, failureNote, resolveChild, rosterHint } from "./catalog.ts";
import { cap } from "../../base.ts";
import { sessionBus as bus } from "../../../sessions/events.ts";
import type { TurnResult } from "../../../sessions/engine.ts";

// Recovery: bare-continue crashed/stalled sub-agents by their short id — NO message, so each finishes its
// task instead of answering a re-prompt ("Understood"). Reuses the preserved history (continues from the
// gathered tool results). Top-level only; advertised only when this session has children.
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

    const resumed: string[] = [];
    const answers = await Promise.all(
      runs.map(async (run) => {
        const label = runs.length > 1 ? `agent (id: ${String(run.id)}): ` : "";
        const child = resolveChild(sid, run.id);
        if (!child) return `${label}no sub-agent #${String(run.id)} to resume. ${rosterHint(sid)}`;
        const alias = aliasOf(child);
        resumed.push(child.id);
        bus.emit("tool:child", { sessionId: sid, toolCallId: call.id, childSessionId: child.id });
        const onAbort = (): void => ec.engine.stopTurn(child.id);
        ec.signal.addEventListener("abort", onAbort, { once: true });
        let outcome: TurnResult | null;
        try {
          outcome = await ec.engine.resume(child.id);
        } finally {
          ec.signal.removeEventListener("abort", onAbort);
        }
        const head = runs.length > 1 ? `agent (id: ${alias}): ` : "";
        if (!outcome) return `${head}could not resume — agent ${alias} may already be running.`;
        if (outcome.aborted) return `${head}the resumed run was stopped.`;
        if (outcome.errored) return `${head}${failureNote(alias, child.title, outcome.errorKind, outcome.text)}`;
        return `${head}${cap(outcome.text) || "(the sub-agent returned no text)"}`;
      }),
    );
    return { output: cap(answers.join("\n\n")), childSessionIds: resumed.length ? resumed : undefined };
  }
}
