import type { EngineCtx, EngineToolResult } from "../../engine/base.ts";
import type { ToolCallRequest } from "../../types.ts";
import { cap } from "../../base.ts";
import { failureNote } from "./catalog.ts";
import { getAppConfig } from "../../../config/index.ts";
import { llmLog } from "../../../../llm/debug.ts";
import { sessionBus as bus } from "../../../sessions/events.ts";
import type { TurnResult } from "../../../sessions/engine.ts";

// The shared dispatch loop behind RunAgent / AskAgent / ResumeAgent. Each tool supplies a per-run PLANNER
// that validates one run and STARTS its child turn; fanOut owns everything else — the sync/async branch,
// abort wiring, outcome/ack formatting, and the childSessionIds result. A 4th orchestration tool is a
// planner + a verb. See implementation.md / the agents area doc.

// A planned run: a child turn already STARTED (eager — dispatch is its in-flight Promise), or a per-run
// error string (bad agent/id, missing task, busy/paused child). `name` is the agent's display name for the
// failure note; `alias` its short id.
export type Planned = { error: string } | { childSid: string; alias: number; name: string; dispatch: Promise<TurnResult | null> };

export type Planner = (run: Record<string, unknown>) => Planned;

// The ack verb — what the tool did to the children ("3 agents <verb> (#1 #2 #3)").
export type Verb = "started" | "re-tasked" | "resumed";

export async function fanOut(ec: EngineCtx, call: ToolCallRequest, runs: Record<string, unknown>[], verb: Verb, plan: Planner): Promise<EngineToolResult> {
  const sid = ec.sessionId;
  // Eager: planning STARTS each child turn (all concurrent), same as the old per-run map.
  const plans = runs.map(plan);

  // Async: ack now, don't block the dispatch turn. Each child's result is pushed to the parent when its
  // turn ends (engine turn:end handler) — fanOut neither awaits nor marks anything.
  if (getAppConfig().session.asyncAgents) {
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
      void p.dispatch.catch(() => {}); // fire-and-forget — turn:end delivers
    }
    started.sort((a, b) => a - b);
    llmLog.debug("agent:dispatch", { parentSid: sid, mode: "async", verb, started, childIds, errors: errs });
    const tags = started.map((n) => `#${n}`).join(" ");
    const head = started.length
      ? `${started.length} agent${started.length > 1 ? "s" : ""} ${verb} (${tags}). They run in the background — you'll be told as each finishes, then read it with getAgentContent. Carry on; do not wait or poll.`
      : "";
    return { output: [head, ...errs].filter(Boolean).join("\n\n") || `no agents ${verb}.`, childSessionIds: childIds.length ? childIds : undefined };
  }

  // Sync: block on each child's SETTLE (not its raw turn Promise) so a user pause→guide→resume is invisible
  // to the parent — it gets the FINAL result. Gather inline, tagged when there's more than one run.
  const multi = plans.length > 1;
  for (const p of plans) {
    if ("error" in p) continue;
    bus.emit("tool:child", { sessionId: sid, toolCallId: call.id, childSessionId: p.childSid });
  }
  const answers = await Promise.all(
    plans.map(async (p) => {
      if ("error" in p) return p.error;
      const head = multi ? `agent (id: ${p.alias}): ` : "";
      const outcome = await ec.engine.awaitSettled(p.childSid, ec.signal, p.dispatch);
      if (!outcome) return `${head}the run did not start (a busy or full session).`;
      if (outcome.aborted) return `${head}the sub-agent run was stopped.`;
      if (outcome.errored) return `${head}${failureNote(p.alias, p.name, outcome.errorKind, outcome.text)}`;
      return `${head}${cap(outcome.text) || "(the sub-agent returned no text)"}`;
    }),
  );
  const childIds = plans.flatMap((p) => ("error" in p ? [] : [p.childSid]));
  return { output: cap(answers.join("\n\n")), childSessionIds: childIds.length ? childIds : undefined };
}
