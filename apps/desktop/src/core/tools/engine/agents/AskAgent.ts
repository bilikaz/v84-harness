import { BaseEngineTool, type EngineCtx, type EngineToolResult } from "../base.ts";
import type { ToolSpec, ToolCallRequest } from "../../types.ts";
import { ASK_SCHEMA, aliasOf, childrenOf, failureNote, resolveChild, rosterHint } from "./catalog.ts";
import { cap } from "../../base.ts";
import { sessionBus as bus } from "../../../sessions/events.ts";
import type { TurnResult } from "../../../sessions/engine.ts";

// Delegation: send a follow-up MESSAGE to sub-agents you already started, by short id — each answers from its
// existing context (reusing its loaded knowledge). Batch (several at once); replies come back tagged. For new
// work / questions; to merely revive a crashed run, use ResumeAgent. Top-level only; advertised when there are children.
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

    const asked: string[] = [];
    const answers = await Promise.all(
      runs.map(async (run) => {
        const child = resolveChild(sid, run.id);
        if (!child) return `agent (id: ${String(run.id)}): no such sub-agent. ${rosterHint(sid)}`;
        const alias = aliasOf(child);
        const message = String(run.message ?? "").trim();
        if (!message) return `agent (id: ${alias}): missing message — say what to ask or tell it.`;
        asked.push(child.id);
        bus.emit("tool:child", { sessionId: sid, toolCallId: call.id, childSessionId: child.id });
        const onAbort = (): void => ec.engine.stopTurn(child.id);
        ec.signal.addEventListener("abort", onAbort, { once: true });
        let outcome: TurnResult | null;
        try {
          outcome = await ec.engine.sendTo(child.id, message, { autoName: false });
        } finally {
          ec.signal.removeEventListener("abort", onAbort);
        }
        const head = `agent (id: ${alias}): `;
        if (!outcome) return `${head}could not deliver — it may already be running.`;
        if (outcome.aborted) return `${head}the run was stopped.`;
        if (outcome.errored) return `${head}${failureNote(alias, child.title, outcome.errorKind, outcome.text)}`;
        return `${head}${cap(outcome.text) || "(the sub-agent returned no text)"}`;
      }),
    );
    return { output: cap(answers.join("\n\n")), childSessionIds: asked.length ? asked : undefined };
  }
}
