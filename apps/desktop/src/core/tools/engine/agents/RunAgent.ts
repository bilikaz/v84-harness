import { BaseEngineTool, type EngineCtx, type EngineToolResult } from "../base.ts";
import type { ToolSpec, ToolCallRequest } from "../../types.ts";
import { RUN_SCHEMA, aliasOf, catalogAgents, failureNote, resolveAgent } from "./catalog.ts";
import { cap } from "../../base.ts";
import { getSession } from "../../../sessions/store.ts";
import { sessionBus as bus } from "../../../sessions/events.ts";
import type { TurnResult } from "../../../sessions/engine.ts";

// Orchestration half of the sub-agent pair: spawn stored agents as concurrent child sessions and collect
// their answers. Hard-depends on the engine (it spawns/stops sessions), reached via ec.engine — which is
// exactly why this is an engine tool and not a registry tool. Top-level only (depth-1); the dispatcher
// blocks it for sub-agents.
export class RunAgent extends BaseEngineTool {
  get schema(): ToolSpec {
    return RUN_SCHEMA;
  }

  override available(ec: EngineCtx): boolean {
    return catalogAgents(!!ec.workspace).length > 0;
  }

  async run(call: ToolCallRequest, ec: EngineCtx): Promise<EngineToolResult> {
    const sid = ec.sessionId;
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

    const children: string[] = [];
    const answers = await Promise.all(
      runs.map(async (run, i) => {
        const label = runs.length > 1 ? `${i + 1}. ` : "";
        const resolved = resolveAgent(String(run.agent ?? ""), !!ec.workspace);
        if (typeof resolved === "string") return `${label}${resolved}`;
        const task = String(run.task ?? "").trim();
        if (!task) return `${label}"${resolved.name}": missing task — say what the agent should do, with all the context it needs.`;

        const { sid: childSid, result } = ec.engine.runAgent(resolved, task, {
          parentId: sid,
          // The PARENT SESSION's container, not the capability-masked workspace — children inherit placement, not the mask.
          containerId: getSession(sid)?.containerId ?? "",
          activate: false,
        });
        children.push(childSid);
        bus.emit("tool:child", { sessionId: sid, toolCallId: call.id, childSessionId: childSid });
        const onAbort = (): void => ec.engine.stopTurn(childSid);
        ec.signal.addEventListener("abort", onAbort, { once: true });
        let outcome: TurnResult | null;
        try {
          outcome = await result;
        } finally {
          ec.signal.removeEventListener("abort", onAbort);
        }
        // The child's stable short id — what the model uses to address it later (ActiveAgents/AskAgent/ResumeAgent).
        const alias = aliasOf(getSession(childSid) ?? ({} as never));
        const head = runs.length > 1 ? `agent (id: ${alias}): ` : "";
        if (!outcome) return `${head}the run did not start (empty task or a busy session).`;
        if (outcome.aborted) return `${head}the sub-agent run was stopped.`;
        if (outcome.errored) return `${head}${failureNote(alias, resolved.name, outcome.errorKind, outcome.text)}`;
        return `${head}${cap(outcome.text) || "(the sub-agent returned no text)"}`;
      }),
    );
    return { output: cap(answers.join("\n\n")), childSessionIds: children.length ? children : undefined };
  }
}
