// The graph executor — event-driven, NOT a loop. A run kicks the entry node; each node's start() begins work
// (a Select, a child head, or a sync value) and the engine, when that work finishes, calls end(), which routes
// onward (goTo / fan / goToAll / done). The graph advances only on completion. Joins are arrival-driven: a
// goToAll fires once EVERY member of the head's fan-out group has arrived — never by polling who is running
// (a head between stages is momentarily idle but not done). Stop/Continue act only on the child sessions:
// pausing a child leaves the engine's awaitSettled riding the pause, so a resumed child finishing just fires
// its end() and the flow proceeds. Per-session state (running heads, gathered results) lives in memory keyed
// by sid. See implementation.md.

import type { Ctx } from "../ctx.ts";
import type { TurnResult } from "../sessions/index.ts";
import { sessionBus as bus } from "../sessions/events.ts";
import { createSession, ensureLoaded, getSession, notify, pushToolResult, pushTurn, setErrorKind, setLastToolCalls, setStreaming } from "../sessions/store.ts";
import { getAgent } from "../agents.ts";
import { getContainer } from "../containers.ts";
import { getAppConfig } from "../config/app.ts";
import { errorMessage } from "../../lib/errors.ts";
import { newId } from "../ids.ts";
import { getGraph } from "./registry.ts";
import { cancelSelectsForSession, requestSelect } from "./select.ts";
import type { AgentSpec, Group, JsonSchema, NodeCtx, SelectAnswer, SelectSpec } from "./types.ts";
import type { BaseGraph } from "./base.ts";

interface RunState {
  graph: BaseGraph;
  controller: AbortController; // hard abort (session delete) — distinct from a soft Stop (pause children)
  running: Map<string, string>; // head name → childSid currently executing (chart + stop/continue)
  arrivals: Map<string, Map<string, unknown>>; // `${target}#${groupId}` → (member name → result) — the ONLY runner storage, for goToAll
  promise: Promise<TurnResult>; // the run's result promise — returned again on re-entry so resume never restarts
  finalText: string;
  done: boolean;
  settle: (r: TurnResult) => void;
}

const runs = new Map<string, RunState>();

export class GraphEngine {
  constructor(private readonly ctx: Ctx) {}

  // Launch a graph: create a graph session stamped graphId and begin at its entry node.
  start(graphId: string, opts: { containerId?: string; activate?: boolean } = {}): { sid: string; result: Promise<TurnResult> } {
    const graph = getGraph(graphId);
    const sid = createSession({ graphId, title: graph?.getTitle() ?? graphId, containerId: opts.containerId }, { activate: opts.activate });
    return { sid, result: this.run(sid) };
  }

  hasRun(sid: string): boolean {
    return runs.has(sid);
  }

  // Soft Stop — pause the running children. The graph is untouched: its awaitSettled rides the pauses, so
  // continue() resumes them and the flow proceeds on completion. A pending Select is NOT cancelled — the run
  // is already waiting on the user there; cancelling would make the graph proceed with an empty answer.
  stop(sid: string): void {
    const st = runs.get(sid);
    if (!st) {
      this.ctx.sessions.stopTurn(sid);
      return;
    }
    for (const childSid of st.running.values()) this.ctx.sessions.stopChild(childSid);
    setStreaming(sid, false);
    notify();
  }

  // Continue — resume the paused children; each finishing fires its end() and the flow advances.
  continue(sid: string): void {
    const st = runs.get(sid);
    if (!st) {
      void this.ctx.sessions.resume(sid);
      return;
    }
    setStreaming(sid, true);
    notify();
    for (const childSid of st.running.values()) void this.ctx.sessions.resume(childSid);
  }

  run(sid: string): Promise<TurnResult> {
    // Re-entry (resume / the turn-loop seam) must NOT restart from the entry — resume the live run's children
    // and hand back the SAME promise. A fresh run only happens when none exists.
    const existing = runs.get(sid);
    if (existing) {
      this.continue(sid);
      return existing.promise;
    }
    let resolveRun!: (r: TurnResult) => void;
    const promise = new Promise<TurnResult>((res) => (resolveRun = res));
    const graph = getGraph(getSession(sid)?.graphId ?? "");
    const controller = new AbortController();
    const st: RunState = { graph: graph as BaseGraph, controller, running: new Map(), arrivals: new Map(), promise, finalText: "", done: false, settle: () => {} };
    st.settle = (r) => {
      if (st.done) return;
      st.done = true;
      runs.delete(sid);
      this.ctx.sessions.clearInflight(sid);
      bus.emit("message:done", { sessionId: sid, text: st.finalText, thinking: "", errored: r.errored, firstExchange: false, autoName: false, userText: "" });
      bus.emit("turn:end", { sessionId: sid, errored: r.errored, aborted: r.aborted });
      resolveRun(r);
    };
    runs.set(sid, st); // synchronous — a re-entrant run() now sees the live run and resumes instead of restarting
    this.ctx.sessions.registerInflight(sid, controller);
    setErrorKind(sid, undefined);
    setStreaming(sid, true);
    notify();
    bus.emit("assistant:open", { sessionId: sid }); // a placeholder so an early turn:error has a target
    if (!graph) {
      bus.emit("turn:error", { sessionId: sid, message: `graph "${getSession(sid)?.graphId ?? ""}" is not registered`, kind: "other" });
      st.settle({ text: "", errored: true, aborted: false, errorKind: "other" });
      return promise;
    }
    // Hard abort (session delete) ends the run; a soft Stop never reaches here (it pauses children).
    controller.signal.addEventListener(
      "abort",
      () => {
        cancelSelectsForSession(sid);
        st.settle({ text: st.finalText, errored: false, aborted: true });
      },
      { once: true },
    );
    void ensureLoaded(sid)
      .then(() => {
        if (!st.done) this.runStage(st, sid, graph.entry, graph.entry, undefined, undefined);
      })
      .catch(() => st.settle({ text: "", errored: true, aborted: false, errorKind: "other" }));
    return promise;
  }

  // Run one node instance: call its start(), then dispatch on the action it returns; when the work completes,
  // hand the result to onComplete (which calls end()).
  private runStage(st: RunState, sid: string, nodeName: string, headName: string, input: unknown, group: Group | undefined): void {
    const node = st.graph.nodes[nodeName];
    if (!node) {
      this.fail(st, sid, `graph node "${nodeName}" is not defined`);
      return;
    }
    void Promise.resolve(node.start(this.nodeCtx(sid, headName, group), input))
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
      .catch((e) => this.fail(st, sid, errorMessage(e)));
  }

  // The node finished its work → call end() and route.
  private onComplete(st: RunState, sid: string, nodeName: string, headName: string, result: unknown, group: Group | undefined, input: unknown): void {
    const node = st.graph.nodes[nodeName];
    void Promise.resolve(node.end(this.nodeCtx(sid, headName, group), input, result))
      .then((route) => {
        if (st.done) return;
        if ("done" in route) {
          st.finalText = route.done;
          bus.emit("assistant:open", { sessionId: sid });
          bus.emit("text", { sessionId: sid, delta: route.done });
          st.settle({ text: route.done, errored: false, aborted: false });
          return;
        }
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
      .catch((e) => this.fail(st, sid, errorMessage(e)));
  }

  private fail(st: RunState, sid: string, message: string): void {
    if (st.done) return;
    bus.emit("turn:error", { sessionId: sid, message, kind: "other" });
    st.settle({ text: st.finalText, errored: true, aborted: false, errorKind: "other" });
  }

  private nodeCtx(sid: string, name: string, group: Group | undefined): NodeCtx {
    return { sid, name, group, scan: (opts) => this.scanWorkspace(sid, opts) };
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
    if (spec.source === "ai") return Promise.resolve({ id: spec.id, selected: spec.options[0] ? [spec.options[0].id] : [] }); // TODO(ai): consult the model
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
