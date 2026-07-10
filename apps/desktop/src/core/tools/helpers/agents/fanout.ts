import type { EngineCtx, EngineToolResult } from "../../engine/base.ts";
import type { ToolCallRequest } from "../../types.ts";
import { llmLog } from "../../../../llm/debug.ts";
import { sessionBus as bus } from "../../../sessions/events.ts";

// The shared dispatch loop behind RunAgent / AskAgent / ResumeAgent. Each tool supplies a per-run PLANNER
// that validates one run and DESCRIBES it (child sid + task, or task-less = resume/reattach); fanOut owns
// the dispatch — every child runs through the ONE contract loop (engine.runContract, autonomous: errored
// turns self-heal, a settled result is a settlement event). Dispatch is ALWAYS async: ack now, results
// delivered as children settle (spawns and results register on landing — durable). The old sync
// wait-for-all mode is gone. A 4th orchestration tool is a planner + a verb.

// A planned run: a child DESCRIBED (not yet dispatched), or a per-run error string (bad agent/id,
// missing task, busy/paused child). `name` is the agent's display name; `alias` its short id.
export type Planned = { error: string } | { childSid: string; alias: number; name: string; task?: string };

export type Planner = (run: Record<string, unknown>) => Planned;

// The ack verb — what the tool did to the children ("3 agents <verb> (#1 #2 #3)").
export type Verb = "started" | "re-tasked" | "resumed";

export async function fanOut(ec: EngineCtx, call: ToolCallRequest, runs: Record<string, unknown>[], verb: Verb, plan: Planner): Promise<EngineToolResult> {
  const sid = ec.sessionId;
  const plans = runs.map(plan);
  const dispatch = (p: Extract<Planned, { childSid: string }>) =>
    ec.engine.runContract(p.childSid, { task: p.task, interactive: false, reattach: !p.task }).settled;

  // Ack now, don't block the dispatch turn. Each child's result is pushed to the parent when it
  // settles (the turn:end delivery listener) — fanOut neither awaits nor marks anything.
  const started: number[] = [];
  const childIds: string[] = [];
  const errs: string[] = [];
  for (const p of plans) {
    if ("error" in p) {
      errs.push(p.error);
      continue;
    }
    childIds.push(p.childSid);
    started.push(p.alias);
    bus.emit("tool:child", { sessionId: sid, toolCallId: call.id, childSessionId: p.childSid });
    void dispatch(p).catch(() => {}); // fire-and-forget — settlement/turn:end delivers
  }
  started.sort((a, b) => a - b);
  llmLog.debug("agent:dispatch", { parentSid: sid, verb, started, childIds, errors: errs });
  const tags = started.map((n) => `#${n}`).join(" ");
  const head = started.length
    ? `${started.length} agent${started.length > 1 ? "s" : ""} ${verb} (${tags}). They run in the background — you'll be told as each finishes, then read it with getAgentContent. Carry on; do not wait or poll.`
    : "";
  return { output: [head, ...errs].filter(Boolean).join("\n\n") || `no agents ${verb}.`, childSessionIds: childIds.length ? childIds : undefined };
}
