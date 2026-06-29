// The graph executor — event-driven, NOT a loop. Control is message-driven: every run is kicked by a command
// message (`start`, `continue`, or a `<nodeName> {json}` jump) routed here through the sessions seam; the
// engine never drives itself. A run kicks the entry node; each node's start() begins work (a Select, a child
// head, or a sync value) and the engine, when that work finishes, calls end(), which routes onward (goTo /
// splitTo / goToAll, or to the reserved `exit` node = terminal). The graph advances only on completion.
//
// A run can PAUSE without ending: a soft Stop pauses the running children, and a node can reject its response
// via ctx.break (e.g. an empty required Select) which PARKS the run at that node. Either way the RunState stays
// alive in memory and `continue` resumes it — re-running the parked node (re-surfacing the Select) or resuming
// the paused children. A `start`/jump kills any live run first. Per-session state lives in `runs`, keyed by
// sid; nothing is persisted (an app restart does not resume). See implementation.md.

import type { Ctx } from "../ctx.ts";
import type { TurnResult } from "../sessions/index.ts";
import { sessionBus as bus } from "../sessions/events.ts";
import { createSession, ensureLoaded, getSession, pushToolResult, pushTurn, setErrorKind, setLastToolCalls } from "../sessions/store.ts";
import { getAgent } from "../agents.ts";
import { getContainer } from "../containers.ts";
import { getAppConfig } from "../config/app.ts";
import { errorMessage } from "../../lib/errors.ts";
import i18n from "../../lib/i18n.ts";
import { newId } from "../ids.ts";
import { getGraph } from "./registry.ts";
import { cancelSelectsForSession, requestSelect } from "./select.ts";
import type { AgentSpec, Group, JsonSchema, NodeCtx, SelectAnswer, SelectSpec } from "./types.ts";
import { BaseGraph, EXIT, EXIT_NODE, GraphBreak } from "./base.ts";

interface RunState {
  graph: BaseGraph;
  controller: AbortController; // hard abort (session delete / a replacing start) — distinct from a soft Stop
  running: Map<string, string>; // head name → childSid currently executing (chart + stop/continue)
  arrivals: Map<string, Map<string, unknown>>; // `${target}#${groupId}` → (member name → result) — the goToAll join store
  resolveSeg: (r: TurnResult) => void; // resolves the in-flight command's turn; reassigned at each segment
  parked?: { node: string; head: string; input: unknown; group?: Group }; // a broken node awaiting `continue`
  finalText: string;
  done: boolean; // the run has ended (settled/aborted) — guards stale child callbacks from a killed run
}

const runs = new Map<string, RunState>();

export class GraphEngine {
  constructor(private readonly ctx: Ctx) {}

  // Launch a graph: create a graph session stamped graphId, then send it the `start` command (a real chat
  // message, so the run reads as one chat). The command lands at the seam → command() below.
  start(graphId: string, opts: { containerId?: string; activate?: boolean } = {}): { sid: string; result: Promise<TurnResult | null> } {
    const graph = getGraph(graphId);
    const sid = createSession({ graphId, title: graph?.getTitle() ?? graphId, containerId: opts.containerId }, { activate: opts.activate });
    return { sid, result: this.ctx.sessions.sendTo(sid, "start", { autoName: false }) };
  }

  hasRun(sid: string): boolean {
    return runs.has(sid);
  }

  // The seam target — interpret a command message. `start` and `<nodeName>` kill any live run and begin fresh;
  // `continue` resumes the live run; an empty message (a stray resume) is a strict no-op (never a restart);
  // anything else gets a help message listing the commands + this graph's node names.
  command(sid: string, text: string): Promise<TurnResult> {
    const t = (text ?? "").trim();
    if (!t) return this.noop(sid);
    const sp = t.search(/\s/);
    const cmd = sp === -1 ? t : t.slice(0, sp);
    const arg = sp === -1 ? "" : t.slice(sp + 1).trim();
    const lc = cmd.toLowerCase();
    if (lc === "start") return this.freshRun(sid);
    if (lc === "continue") return this.continue(sid);
    const graph = getGraph(getSession(sid)?.graphId ?? "");
    if (graph && (cmd === EXIT || graph.nodes[cmd])) {
      let input: unknown;
      if (arg) {
        try {
          input = JSON.parse(arg);
        } catch {
          return this.help(sid, graph, "badJson");
        }
      }
      return this.freshRun(sid, { node: cmd, input });
    }
    return this.help(sid, graph, "unknown");
  }

  // Soft Stop — pause the running children and end the in-flight turn (the run stays alive; `continue` resumes
  // the children). A pending Select is NOT cancelled — the run is already waiting on the user there.
  stop(sid: string): void {
    const st = runs.get(sid);
    if (!st) {
      this.ctx.sessions.stopTurn(sid);
      return;
    }
    for (const childSid of st.running.values()) this.ctx.sessions.stopChild(childSid);
    this.pauseSegment(st, sid);
  }

  // Continue — resume the live run wherever it is parked: re-run a broken node (re-surfacing its Select), or
  // resume soft-stopped children (each finishing fires its end() and the flow proceeds). Nothing live → help.
  continue(sid: string): Promise<TurnResult> {
    const st = runs.get(sid);
    if (!st) return this.help(sid, getGraph(getSession(sid)?.graphId ?? ""), "nothingToContinue");
    if (st.parked) {
      const p = st.parked;
      st.parked = undefined;
      return this.beginSegment(st, sid, () => this.runStage(st, sid, p.node, p.head, p.input, p.group));
    }
    if (st.running.size) {
      return this.beginSegment(st, sid, () => {
        for (const childSid of st.running.values()) void this.ctx.sessions.resume(childSid);
      });
    }
    return this.help(sid, st.graph, "nothingToContinue");
  }

  // Begin a fresh run, killing any live run first. Starts at the entry node (a plain `start`) or at a named
  // node with the supplied input (a `<nodeName> {json}` jump).
  private freshRun(sid: string, start?: { node?: string; input?: unknown }): Promise<TurnResult> {
    this.killRun(sid);
    const graph = getGraph(getSession(sid)?.graphId ?? "");
    if (!graph) {
      bus.emit("assistant:open", { sessionId: sid }); // a target for the turn:error append
      bus.emit("turn:error", { sessionId: sid, message: `graph "${getSession(sid)?.graphId ?? ""}" is not registered`, kind: "other" });
      this.emitEnd(sid, "", true, false);
      return Promise.resolve({ text: "", errored: true, aborted: false, errorKind: "other" });
    }
    const controller = new AbortController();
    const st: RunState = { graph, controller, running: new Map(), arrivals: new Map(), resolveSeg: () => {}, finalText: "", done: false };
    runs.set(sid, st); // synchronous — hasRun() now sees the live run
    this.ctx.sessions.registerInflight(sid, controller);
    setErrorKind(sid, undefined);
    // Hard abort (session delete / a replacing start) ends the run; a soft Stop never reaches here.
    controller.signal.addEventListener("abort", () => this.abortRun(st, sid), { once: true });
    const node = start?.node ?? graph.entry;
    return this.beginSegment(st, sid, () => {
      void ensureLoaded(sid)
        .then(() => {
          if (!st.done) this.runStage(st, sid, node, node, start?.input, undefined);
        })
        .catch(() => this.fail(st, sid, "failed to load session"));
    });
  }

  // One command turn: a fresh Promise the engine resolves when the run next reaches a stable point
  // (exit / park / stop / abort / error). An assistant placeholder opens so the first card or an early
  // turn:error has a target.
  private beginSegment(st: RunState, sid: string, kick: () => void): Promise<TurnResult> {
    return new Promise<TurnResult>((resolve) => {
      st.resolveSeg = resolve;
      bus.emit("assistant:open", { sessionId: sid });
      kick();
    });
  }

  private killRun(sid: string): void {
    const st = runs.get(sid);
    if (st && !st.done) st.controller.abort(); // → abortRun
  }

  private abortRun(st: RunState, sid: string): void {
    if (st.done) return;
    cancelSelectsForSession(sid);
    this.endRun(st, sid);
    this.emitEnd(sid, st.finalText, false, true);
    st.resolveSeg({ text: st.finalText, errored: false, aborted: true });
  }

  // Terminal cleanup — drop the run and release its inflight slot. Distinct from a pause (which keeps both).
  private endRun(st: RunState, sid: string): void {
    st.done = true;
    runs.delete(sid);
    this.ctx.sessions.clearInflight(sid);
  }

  private emitEnd(sid: string, text: string, errored: boolean, aborted: boolean): void {
    bus.emit("message:done", { sessionId: sid, text, thinking: "", errored, firstExchange: false, autoName: false, userText: "" });
    bus.emit("turn:end", { sessionId: sid, errored, aborted });
  }

  // Empty drive on a graph session (a stray resume / pump) — never restart; just close the turn.
  private noop(sid: string): Promise<TurnResult> {
    this.emitEnd(sid, "", false, false);
    return Promise.resolve({ text: "", errored: false, aborted: false });
  }

  // Pause the in-flight turn without ending the run (Stop, or a node break). The RunState stays alive so
  // `continue` can resume it; the segment Promise resolves so the command's turn completes.
  private pauseSegment(st: RunState, sid: string, message?: string): void {
    if (st.done) return;
    if (message) {
      bus.emit("assistant:open", { sessionId: sid });
      bus.emit("text", { sessionId: sid, delta: message });
    }
    const text = message ?? st.finalText;
    this.emitEnd(sid, text, false, false);
    st.resolveSeg({ text, errored: false, aborted: false });
  }

  // A node rejected its response (ctx.break) — park the run at this node and pause; `continue` re-runs it.
  private park(st: RunState, sid: string, node: string, head: string, input: unknown, group: Group | undefined, message: string): void {
    if (st.done) return;
    st.parked = { node, head, input, group };
    this.pauseSegment(st, sid, message);
  }

  // Reaching the reserved exit node ends the run: render its input as the final ```json output, then settle.
  private finish(st: RunState, sid: string, headName: string, input: unknown): void {
    if (st.done) return;
    this.openCard(sid, EXIT, headName, input); // the chart shows the run landing on the exit endpoint
    void Promise.resolve(EXIT_NODE.start(this.nodeCtx(sid, headName, undefined), input))
      .then((action) => {
        if (st.done) return;
        const text = "value" in action ? String(action.value) : "";
        st.finalText = text;
        bus.emit("assistant:open", { sessionId: sid });
        bus.emit("text", { sessionId: sid, delta: text });
        this.endRun(st, sid);
        this.emitEnd(sid, text, false, false);
        st.resolveSeg({ text, errored: false, aborted: false });
      })
      .catch((e) => this.fail(st, sid, errorMessage(e)));
  }

  private fail(st: RunState, sid: string, message: string): void {
    if (st.done) return;
    bus.emit("turn:error", { sessionId: sid, message, kind: "other" });
    this.endRun(st, sid);
    this.emitEnd(sid, st.finalText, true, false);
    st.resolveSeg({ text: st.finalText, errored: true, aborted: false, errorKind: "other" });
  }

  // A thrown error from start()/end(): a GraphBreak parks the run (resumable), anything else fails it.
  private onError(st: RunState, sid: string, nodeName: string, headName: string, input: unknown, group: Group | undefined, e: unknown): void {
    if (e instanceof GraphBreak) this.park(st, sid, nodeName, headName, input, group, e.userMessage);
    else this.fail(st, sid, errorMessage(e));
  }

  private help(sid: string, graph: BaseGraph | undefined, reason: "unknown" | "badJson" | "nothingToContinue"): Promise<TurnResult> {
    const msg = buildHelp(graph, reason);
    bus.emit("assistant:open", { sessionId: sid });
    bus.emit("text", { sessionId: sid, delta: msg });
    this.emitEnd(sid, msg, false, false);
    return Promise.resolve({ text: msg, errored: false, aborted: false });
  }

  // Run one node instance: call its start(), then dispatch on the action it returns; when the work completes,
  // hand the result to onComplete (which calls end()). The reserved exit node is terminal.
  private runStage(st: RunState, sid: string, nodeName: string, headName: string, input: unknown, group: Group | undefined): void {
    if (nodeName === EXIT) {
      this.finish(st, sid, headName, input);
      return;
    }
    const node = st.graph.nodes[nodeName];
    if (!node) {
      this.fail(st, sid, `graph node "${nodeName}" is not defined`);
      return;
    }
    // Deferred via .then so a SYNCHRONOUS throw from start() (e.g. ctx.break) becomes a catchable rejection.
    void Promise.resolve()
      .then(() => node.start(this.nodeCtx(sid, headName, group), input))
      .then((action) => {
        if (st.done) return;
        if ("value" in action) {
          this.onComplete(st, sid, nodeName, headName, action.value, group, input);
          return;
        }
        if ("modal" in action) {
          const callId = this.openCard(sid, nodeName, headName, input);
          void this.resolveSelect(sid, action.modal, st.controller.signal).then((ans) => {
            if (st.done) return;
            bus.emit("tool:result", { sessionId: sid, toolCallId: callId, output: JSON.stringify({ id: action.modal.id, selected: ans?.selected ?? [] }) });
            this.onComplete(st, sid, nodeName, headName, ans, group, input);
          });
          return;
        }
        // agent — a visible child head (seeded with the selected files when asked)
        const callId = this.openCard(sid, nodeName, headName, input);
        const agentSpec = action.agent;
        void this.spawnAgent(sid, headName, agentSpec).then(({ childSid, dispatch }) => {
          if (st.done) return;
          st.running.set(headName, childSid);
          bus.emit("tool:child", { sessionId: sid, toolCallId: callId, childSessionId: childSid });
          void this.awaitHead(agentSpec, childSid, dispatch, st.controller.signal).then((res) => {
            if (st.done) return;
            st.running.delete(headName);
            bus.emit("tool:result", { sessionId: sid, toolCallId: callId, output: res.ok ? "done" : "failed", childSessionIds: [childSid] });
            this.onComplete(st, sid, nodeName, headName, res, group, input);
          });
        });
      })
      .catch((e) => this.onError(st, sid, nodeName, headName, input, group, e));
  }

  // The node finished its work → call end() and route. A break thrown in end() parks the run at THIS node.
  private onComplete(st: RunState, sid: string, nodeName: string, headName: string, result: unknown, group: Group | undefined, input: unknown): void {
    const node = st.graph.nodes[nodeName];
    // Deferred via .then so a SYNCHRONOUS throw from end() (e.g. ctx.break on an empty select) is catchable.
    void Promise.resolve()
      .then(() => node.end(this.nodeCtx(sid, headName, group), input, result))
      .then((route) => {
        if (st.done) return;
        if ("goTo" in route) {
          this.runStage(st, sid, route.goTo, headName, route.input ?? result, group);
          return;
        }
        if ("splitTo" in route) {
          const g: Group = { id: newId(), size: route.inputs.length };
          for (const m of route.inputs) this.runStage(st, sid, route.splitTo, m.name, m.input, g);
          return;
        }
        // goToAll — arrival-driven join. Outside a group it degrades to a plain goTo.
        if (!group) {
          this.runStage(st, sid, route.goToAll, route.goToAll, route.input ?? result, undefined);
          return;
        }
        const key = `${route.goToAll}#${group.id}`;
        const bucket = st.arrivals.get(key) ?? new Map<string, unknown>();
        bucket.set(headName, route.input ?? result);
        st.arrivals.set(key, bucket);
        // Fire only when EVERY member of the group has arrived — count, never poll liveness.
        if (bucket.size >= group.size) {
          st.arrivals.delete(key);
          this.runStage(st, sid, route.goToAll, route.goToAll, [...bucket.values()], undefined);
        }
      })
      .catch((e) => this.onError(st, sid, nodeName, headName, input, group, e));
  }

  private nodeCtx(sid: string, name: string, group: Group | undefined): NodeCtx {
    return {
      sid,
      name,
      group,
      scan: (opts) => this.scanWorkspace(sid, opts),
      break: (message: string): never => {
        throw new GraphBreak(message);
      },
    };
  }

  // Walk the workspace via the List tool, descending only into non-ignored directories (so node_modules &c.
  // are never entered — no output-cap blowups) and keeping only files with the given extensions. Empty when
  // there's no tool gateway (tests) or no workspace.
  private async scanWorkspace(sid: string, opts?: { ignore?: string[]; extensions?: string[] }): Promise<string[]> {
    const tools = this.ctx.tools;
    if (!tools) return [];
    const root = (getContainer(getSession(sid)?.containerId)?.config.root as string | undefined) ?? "";
    const ignore = new Set(opts?.ignore ?? []);
    const exts = opts?.extensions;
    const out: string[] = [];
    const visit = async (dir: string): Promise<void> => {
      const res = await tools.run({ id: newId(), name: "List", arguments: JSON.stringify({ path: dir }), cwd: root });
      if (!res?.ok) return;
      for (const raw of res.output.split("\n").slice(1)) {
        const line = raw.trim();
        if (!line) continue;
        if (line.endsWith("/")) {
          const name = line.slice(0, -1);
          if (!ignore.has(name)) await visit(`${dir}/${name}`);
        } else if (!exts || exts.some((e) => line.endsWith(e))) {
          out.push(`${dir}/${line}`);
        }
      }
    };
    await visit("/workspace");
    return out;
  }

  // Open one tool card on the orchestrator transcript so the chart shows which head/node activated, with the
  // actual input it received (the card's IN).
  private openCard(sid: string, nodeName: string, headName: string, input: unknown): string {
    const callId = newId();
    bus.emit("assistant:open", { sessionId: sid });
    bus.emit("tool:calls", { sessionId: sid, calls: [{ id: callId, name: nodeName, arguments: JSON.stringify({ head: headName, input: input ?? null }), cwd: "" }] });
    return callId;
  }

  private resolveSelect(sid: string, spec: SelectSpec, signal: AbortSignal): Promise<SelectAnswer | null> {
    if (signal.aborted) return Promise.resolve(null);
    if (spec.source === "pattern") return Promise.resolve({ id: spec.id, selected: spec.patternAnswer ?? [] });
    if (spec.source === "ai") return Promise.resolve({ id: spec.id, selected: [] }); // TODO(ai): consult the model — never a silent auto-pick
    return requestSelect(sid, spec);
  }

  private async spawnAgent(sid: string, headName: string, spec: AgentSpec): Promise<{ childSid: string; dispatch: Promise<TurnResult | null> }> {
    const agent = spec.agentId ? getAgent(spec.agentId) : undefined;
    const parent = getSession(sid);
    const childSid = createSession({ title: agent?.name ?? headName, system: agent?.system ?? spec.system ?? "", agentId: agent?.id, parentId: sid, containerId: parent?.containerId }, { activate: false });

    // Seed the opening with the pre-selected files, READ FOR REAL (the design's "task message + Read calls
    // that execute"): the head's history becomes [task] → [assistant: Read calls] → [tool: file contents],
    // then it continues (resume) with the files already in context. Falls back to a plain send off-workspace.
    const files = spec.seedFiles?.filter((p) => p.startsWith("/")) ?? [];
    if (files.length && this.ctx.tools) {
      const root = (getContainer(parent?.containerId)?.config.root as string | undefined) ?? "";
      const reads = files.map((path) => ({ id: newId(), name: "Read", arguments: JSON.stringify({ path }), cwd: root, path }));
      pushTurn(childSid, spec.task);
      setLastToolCalls(childSid, reads.map(({ path: _p, ...call }) => call));
      for (const r of reads) {
        const res = await this.ctx.tools.run({ id: r.id, name: r.name, arguments: r.arguments, cwd: root });
        pushToolResult(childSid, r.id, res?.output ?? `(could not read ${r.path})`);
      }
      return { childSid, dispatch: this.ctx.sessions.resume(childSid) };
    }
    return { childSid, dispatch: this.ctx.sessions.sendTo(childSid, spec.task, { autoName: false }) };
  }

  // Await a head to settle, then heal a strict-JSON contract (tiered, never echoing the bad output):
  // parse/shape failure → bare resume; valid JSON missing fields → a targeted correction. `ok` reflects the
  // CONTRACT (valid + settled), not just that the turn ended.
  private async awaitHead(spec: AgentSpec, childSid: string, dispatch: Promise<TurnResult | null>, signal: AbortSignal): Promise<{ ok: boolean; text: string }> {
    let result = await this.ctx.sessions.awaitSettled(childSid, signal, dispatch);
    let valid = !spec.schema;
    let text = result?.text ?? "";
    if (spec.schema) {
      const maxHeals = getAppConfig().llm.maxHealAttempts;
      for (let attempt = 0; ; attempt++) {
        if (!result || result.aborted || result.errored) break; // a failed/aborted turn is not a healable JSON output
        const extracted = extractJson(result.text); // pull the JSON out of any prose/fences ONCE
        const check = validateJson(extracted, spec.schema);
        if (check.ok) {
          valid = true;
          text = extracted; // forward the clean JSON, not the prose-wrapped reply
          break;
        }
        if (attempt >= maxHeals) break;
        // Missing fields → the JSON parses, so a correction message is safe to re-send. Unparseable → BARE
        // RESUME: resumeTail drops the broken reply from history and retries — never re-send broken JSON. (The
        // provider's chat renderer json.loads message content and 400s on it, so re-sending it makes the model
        // unrecoverable; dropping it is the only way out.)
        const redo =
          check.kind === "fields"
            ? this.ctx.sessions.sendTo(childSid, `Your JSON is missing required field(s): ${check.missing.join(", ")}. Return the corrected JSON.`, { autoName: false })
            : this.ctx.sessions.resume(childSid);
        result = await this.ctx.sessions.awaitSettled(childSid, signal, redo);
      }
    }
    const ok = !!result && !result.errored && !result.aborted && valid;
    return { ok, text: ok ? text : "" }; // a failed head forwards nothing — never the error/garbage downstream
  }
}

// The help/fallback message: the fixed commands + this graph's node names (so `<nodeName>` jumps are
// discoverable). `nothingToContinue` stands alone; `unknown`/`badJson` lead with the reason.
function buildHelp(graph: BaseGraph | undefined, reason: "unknown" | "badJson" | "nothingToContinue"): string {
  if (reason === "nothingToContinue") return i18n.t("graphs.help.nothingToContinue");
  const lead = reason === "badJson" ? i18n.t("graphs.help.badJson") : i18n.t("graphs.help.unknown");
  const names = graph ? [...Object.keys(graph.nodes), EXIT] : [];
  const lines = [lead, i18n.t("graphs.help.commands")];
  if (names.length) lines.push(i18n.t("graphs.help.nodes", { nodes: names.join(", ") }));
  return lines.join("\n");
}

type JsonCheck = { ok: true } | { ok: false; kind: "parse" | "shape" } | { ok: false; kind: "fields"; missing: string[] };

function validateJson(text: string, schema: JsonSchema): JsonCheck {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text); // caller already extracted the JSON from any prose/fences
  } catch {
    return { ok: false, kind: "parse" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { ok: false, kind: "shape" };
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  const missing = required.filter((k) => !(k in (parsed as Record<string, unknown>)));
  return missing.length ? { ok: false, kind: "fields", missing } : { ok: true };
}

function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : text.trim();
}
