// The graph engine — a THIN shell since the driver rewrite (implementation.md, stage 4): it keeps
// the registry of LIVE GraphSessionLoops and routes command messages to them; everything else —
// command interpretation, node advancement, tool-call emission, park/continue, revival — lives in
// the loop (core/graph/loop.ts). The old machinery (segments, runStage, onComplete, openCard card
// simulation, awaitHead) is gone: a graph is a response producer over the ONE session loop.

import type { Ctx } from "../ctx.ts";
import type { TurnResult } from "../sessions/index.ts";
import { sessionBus as bus } from "../sessions/events.ts";
import { createSession, getSession, setErrorKind } from "../sessions/store.ts";
import { getAppConfig } from "../config/app.ts";
import { getGraph } from "./registry.ts";
import { GraphSessionLoop } from "./loop.ts";
import { onSettle } from "../sessions/loop/records.ts";

export class GraphEngine {
  constructor(private readonly ctx: Ctx) {}

  // Live runs by graph-session sid — a run exists while its loop does (parked included).
  private readonly live = new Map<string, { loop: GraphSessionLoop; controller: AbortController }>();

  // Launch a graph: create a graph session stamped graphId, then send it the `start` command (a real
  // chat message, so the run reads as one chat). The command lands at the seam → command() below.
  start(graphId: string, opts: { containerId?: string; activate?: boolean } = {}): { sid: string; result: Promise<TurnResult | null> } {
    const graph = getGraph(graphId);
    const sid = createSession({ graphId, title: graph?.getTitle() ?? graphId, containerId: opts.containerId }, { activate: opts.activate });
    return { sid, result: this.ctx.sessions.sendTo(sid, "start", { autoName: false }) };
  }

  hasRun(sid: string): boolean {
    return this.live.has(sid);
  }

  // The seam target — route a command message to the session's live loop, or construct one.
  // `start` is the escape hatch: kill any live run and begin fresh (the loop reads the command).
  command(sid: string, text: string): Promise<TurnResult> {
    const t = (text ?? "").trim().toLowerCase();
    const entry = this.live.get(sid);
    if (t === "start") {
      this.kill(sid);
      return this.fresh(sid, text);
    }
    if (entry) {
      if (entry.loop.waiting) return entry.loop.feed(text);
      return entry.loop.busyCommand(text); // blocked inside dispatch — continue resumes children
    }
    // No live run — construct one; `continue` revives from the persisted milestone cursor.
    return this.fresh(sid, text, { revive: t === "continue" });
  }

  // Soft Stop — pause the running children and end any in-flight surface turn; the run stays alive
  // and `continue` resumes it.
  stop(sid: string): void {
    const entry = this.live.get(sid);
    entry?.loop.softStop();
    this.ctx.sessions.abortTurn(sid); // a streaming orchestrator-surface dialog segment, if any
  }

  // Hard kill (session delete / a replacing `start`) — the loop observes the abort and settles.
  kill(sid: string): void {
    const entry = this.live.get(sid);
    if (!entry) return;
    this.live.delete(sid);
    entry.controller.abort();
    entry.loop.poke();
  }

  private fresh(sid: string, text: string, opts: { revive?: boolean } = {}): Promise<TurnResult> {
    const graph = getGraph(getSession(sid)?.graphId ?? "");
    if (!graph) {
      bus.emit("assistant:open", { sessionId: sid });
      bus.emit("turn:error", { sessionId: sid, message: `graph "${getSession(sid)?.graphId ?? ""}" is not registered`, kind: "other" });
      bus.emit("message:done", { sessionId: sid, text: "", thinking: "", errored: true, firstExchange: false, autoName: false, userText: "" });
      bus.emit("turn:end", { sessionId: sid, errored: true, aborted: false });
      return Promise.resolve({ text: "", errored: true, aborted: false, errorKind: "other" });
    }
    const controller = new AbortController();
    const loop = new GraphSessionLoop(
      this.ctx,
      graph,
      { sid, contract: { interactive: true }, budget: 0, maxSteps: getAppConfig().session.maxSteps, signal: controller.signal },
      opts,
    );
    this.live.set(sid, { loop, controller });
    this.ctx.sessions.registerInflight(sid, controller);
    setErrorKind(sid, undefined);
    // Cleanup rides the settlement EVENT — synchronous at settle, so hasRun() is already false when
    // anything awaiting the run resumes.
    onSettle(sid, () => {
      if (this.live.get(sid)?.loop === loop) this.live.delete(sid);
      this.ctx.sessions.clearInflight(sid);
    });
    void loop.run({ kind: "task", text });
    return loop.firstTurn;
  }
}
