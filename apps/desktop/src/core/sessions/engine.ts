import type { ErrorKind, ToolCallRequest } from "../../llm/types.ts";
import { llmLog } from "../../llm/debug.ts";
import type { Attachments, Session } from "./types.ts";
import { resolveMain } from "../settings.ts";
import type { Ctx } from "../ctx.ts";
import { getAppConfig } from "../config/index.ts";
import { denyApprovalsForSession } from "../approvals.ts";
import { type Agent } from "../agents.ts";
import { getActiveContainerId, getContainer } from "../containers.ts";
import { isConnected } from "../account.ts";
import { type ToolName, type ToolPermission } from "../tools/types.ts";
import { deliveryNudge } from "../prompts.ts";
import { GET_AGENT_CONTENT, aliasOf, childrenOf, collectAgentContent } from "../tools/helpers/agents/catalog.ts";
import { browserFleet } from "../browser.ts";
import { sessionBus as bus } from "./events.ts";
import {
  createSession,
  deleteSession as deleteSessionState,
  ensureLoaded,
  getActiveId,
  getSession,
  getSessions,
  getStreamingIds,
  isFull,
  commitMessages,
  pushToolResult,
  pushTurn,
  setDelivered,
  patchMeta,
  setLastToolCalls,
  setUserPaused,
} from "./store.ts";
import { errorMessage } from "../../lib/errors.ts";
import { downscaleImage } from "../../lib/imageResize.ts";
import { nameSession } from "./naming.ts";
import { compact as compactSession } from "./compaction.ts";
import { LlmSessionLoop } from "./loop/llm.ts";
import { capabilityContext } from "./system.ts";
import type { LoopInput } from "./loop/base.ts";
import { memoryInbox } from "./loop/records.ts";
import type { Settlement } from "./loop/records.ts";

// The step-level single-tool drop rule lives with the llm shape; re-exported for its unit tests.
export { dropExtraSingleCalls } from "./loop/llm.ts";

// Validator for the model's final (no-tool) turn: throw to reject — the engine injects a correction and retries.
export type OutputValidator = (text: string) => void;

// How a turn ended; `text` is the final answer — partial if aborted. `errorKind` is set when errored —
// it tells the orchestrator what to do next (capacity = don't resume; transport = resumable).
export interface TurnResult {
  text: string;
  errored: boolean;
  aborted: boolean;
  errorKind?: ErrorKind;
}

export interface SendOptions extends Attachments {
  autoName?: boolean;
  validate?: OutputValidator;
  // A hidden user message pushed just before the visible turn — carries forwarded context
  // (a browser window snapshot) that the visible comment references.
  context?: string;
}

// The sessions engine: the turn loop, sub-agent orchestration, naming/compaction triggers — all bound to one ctx.
// Constructed once per host (init) and carried on ctx.sessions; the renderer reaches it via useCtx().sessions.
export class SessionEngine {
  private readonly inflight = new Map<string, AbortController>();
  // Async sub-agent delivery: children finish out-of-band, so each finished child is queued here per
  // parent (childSid → short alias) and pushed on the parent's next idle turn — never mid-print.
  private readonly deliveries = new Map<string, Map<string, number>>();
  private tracedConfig = false; // log the live config once (first turn) — the first thing to sanity-check

  constructor(private readonly ctx: Ctx) {
    // The session store's data engine + hydration are injected/orchestrated by init() AFTER
    // ctx.storage is installed (this constructor runs during `new Ctx`, before that).
    // Auto-name the session after its first exchange.
    bus.on("message:done", (e) => {
      if (e.firstExchange && e.autoName && !e.errored) void nameSession(this.ctx, e.sessionId);
    });
    // Compact once a turn ends and the session has grown past its context budget.
    bus.on("turn:end", (e) => {
      // A parent that just went idle can now receive any sub-agent results that finished while it was busy.
      this.pumpDeliveries(e.sessionId);
      const s = getSession(e.sessionId);
      // A child whose turn just FINISHED delivers its result up to its parent — but ONLY in async mode.
      // Skip aborts (a user pause / cascade) — only a terminal success/error is delivered. A GRAPH
      // orchestrator is never a delivery parent: it consumes its heads through its own Call dispatch,
      // so a delivery here would re-drive (and restart) the run. Exclude graph-session parents.
      if (s?.parentId && !getSession(s.parentId)?.graphId) {
        llmLog.debug("agent:child-end", { childSid: e.sessionId, parentSid: s.parentId, errored: e.errored, aborted: e.aborted });
        if (!e.aborted) this.onChildSettled(s.parentId, e.sessionId, aliasOf(s));
      }
      if (e.errored) return;
      const cfg = resolveMain();
      if (cfg && s && isFull(cfg, s)) void this.compact(e.sessionId);
    });
  }

  // Also denies the session's queued approvals — an unanswered approval Promise would keep the turn pending forever.
  stopTurn(sid: string): void {
    // A graph run's Stop is a soft pause of its children, not an orchestrator abort — the graph rides the
    // pauses and continue() resumes them. Delegate to the graph engine when this session has a live run.
    if (this.ctx.graph.hasRun(sid)) {
      this.ctx.graph.stop(sid);
      return;
    }
    this.inflight.get(sid)?.abort();
    denyApprovalsForSession(sid);
  }

  // Abort the raw in-flight turn with NO graph delegation — the graph engine's own Stop path uses this
  // to end a live dialog model turn (its soft-pause semantics own everything else).
  abortTurn(sid: string): void {
    this.inflight.get(sid)?.abort();
    denyApprovalsForSession(sid);
  }

  // Shared turn-lifecycle hooks for the GraphEngine: a graph turn runs its own loop (core/graph/engine.ts)
  // but registers its controller here so stopTurn (and the stop-cascade) abort it like any other turn.
  registerInflight(sid: string, controller: AbortController): void {
    this.inflight.set(sid, controller);
  }
  clearInflight(sid: string): void {
    this.inflight.delete(sid);
  }

  // Per-child user stop: a PAUSE, not a failure. Marks the child user-paused (resume ownership stays
  // with the user — the parent's ResumeAgent won't touch it, and getAgentContent treats it as "not
  // done"), then aborts its in-flight turn. Distinct from deleteSession, which removes the child.
  stopChild(sid: string): void {
    setUserPaused(sid, true);
    this.stopTurn(sid);
  }

  // Async delivery — a child reached a terminal SUCCESS or ERROR. A user pause/abort (outcome.aborted)
  // or a refused start (null) is invisible to the parent, so it queues nothing. Otherwise the child is
  // queued for its parent and the parent is pumped (delivers now if idle, else on its next turn:end).
  // A child reached a terminal SUCCESS or ERROR (the turn:end handler already filtered out aborts and
  // inline-awaited turns) — queue it for its parent and pump (delivers now if idle, else on turn:end).
  private onChildSettled(parentSid: string, childSid: string, alias: number): void {
    llmLog.debug("agent:settled", { parentSid, childSid, alias });
    this.enqueueDelivery(parentSid, childSid, alias);
    this.pumpDeliveries(parentSid);
  }

  private enqueueDelivery(parentSid: string, childSid: string, alias: number): void {
    const q = this.deliveries.get(parentSid) ?? new Map<string, number>();
    q.set(childSid, alias);
    this.deliveries.set(parentSid, q);
  }

  // Drain a parent's finished-child queue into ONE wake-turn — but only while the parent is idle, so a
  // turn mid-print is never interrupted (deliveries stack and arrive together). Re-fires on turn:end.
  private pumpDeliveries(parentSid: string): void {
    const q = this.deliveries.get(parentSid);
    if (!q?.size) return;
    if (!getSession(parentSid)) {
      this.deliveries.delete(parentSid); // parent gone — drop its queue
      return;
    }
    if (getStreamingIds().has(parentSid)) {
      // Busy parent: the delivery rides the pending inbox — the LIVE loop drains it at its next
      // cycle boundary (sooner than turn:end, and one injection path). Nudge form: the model reads
      // the results with getAgentContent, which marks them delivered.
      const aliases = [...q.values()].filter((n) => n > 0).sort((a, b) => a - b);
      this.deliveries.delete(parentSid);
      if (aliases.length) {
        this.inbox.push({ id: crypto.randomUUID(), sessionId: parentSid, text: deliveryNudge(aliases), queuedAt: Date.now(), from: "delivery" });
      }
      return;
    }
    const entries = [...q];
    this.deliveries.delete(parentSid);
    // A throw here (e.g. the history read fails) would otherwise drop the child's result for good —
    // the entries are already off the queue. Re-queue so the parent's next turn:end retries delivery.
    // Real throws only happen BEFORE the synthetic turn is emitted (drive/sendTo are self-guarding and
    // resolve rather than throw), so re-queuing can't double-deliver.
    void this.deliver(parentSid, entries).catch((e) => {
      for (const [cid, n] of entries) this.enqueueDelivery(parentSid, cid, n);
      llmLog.warn("agent:deliver-failed", { parentSid, error: errorMessage(e) });
    });
  }

  // One delivery. Synthetic (default): a getAgentContent call+result fabricated into history so the model
  // wakes having "received" the result with no extra round-trip. Nudge: a runtime notice the model acts on.
  // On a busy/gone race during the read, re-queue (turn:end re-pumps); if the provider rejects the
  // fabricated history, fall back to a nudge. (Validate the synthetic path on the live endpoint — ADR.)
  private async deliver(parentSid: string, entries: [string, number][]): Promise<void> {
    const aliases = entries.map(([, n]) => n).filter((n) => n > 0).sort((a, b) => a - b);
    if (!aliases.length) return;
    llmLog.debug("agent:deliver", { parentSid, mode: getAppConfig().session.asyncDelivery, aliases });
    if (getAppConfig().session.asyncDelivery === "nudge") {
      await this.sendTo(parentSid, deliveryNudge(aliases), { autoName: false });
      return;
    }
    const { output, childIds } = await collectAgentContent(parentSid, aliases);
    if (!getSession(parentSid) || getStreamingIds().has(parentSid)) {
      for (const [cid, n] of entries) this.enqueueDelivery(parentSid, cid, n); // raced busy/gone — turn:end re-pumps
      return;
    }
    const call: ToolCallRequest = { id: crypto.randomUUID(), name: GET_AGENT_CONTENT, arguments: JSON.stringify({ ids: aliases }), cwd: "" };
    bus.emit("turn:deliver", { sessionId: parentSid, call, output, childSessionIds: childIds.length ? childIds : undefined });
    for (const cid of childIds) setDelivered(cid, true); // their result is now in the parent's transcript — a boot won't re-deliver
    const result = await this.drive(parentSid, {}, { firstExchange: false, autoName: false, userText: "" });
    if (result.errored) await this.sendTo(parentSid, deliveryNudge(aliases), { autoName: false }); // provider rejected the fabricated history
  }

  // Boot recovery for async sub-agent runs an app restart interrupted. The in-memory delivery queue and
  // the settlement listeners don't survive a reload, so re-derive each parent's outstanding work
  // from durable state: of the children its committed history knows about (childSessionIds on a spawn
  // ack / prior delivery), the ones not yet delivered (the durable `delivered` flag). A settled one is
  // re-queued for delivery; an unfinished one is resumed and delivers itself on its next turn:end.
  // Content is always read from the children's own transcripts — never reconstructed here. Fire-and-
  // forget from init after hydrate; sync runs (which block the parent turn) have nothing to re-pump.
  async reconcile(): Promise<void> {
    const parents = new Set(getSessions().map((s) => s.parentId).filter((p): p is string => !!p));
    for (const parentSid of parents) {
      const parent = getSession(parentSid);
      if (!parent || parent.graphId) continue; // graph orchestrators drive their own heads (graph engine owns resume)
      await ensureLoaded(parentSid);
      const known = new Set<string>();
      for (const m of getSession(parentSid)?.messages ?? []) for (const id of m.childSessionIds ?? []) known.add(id);
      for (const child of childrenOf(parentSid)) {
        if (child.meta.delivered || !known.has(child.id)) continue; // already in the parent, or an orphan we can't place
        await ensureLoaded(child.id);
        const loaded = getSession(child.id);
        if (!loaded) continue;
        if (isSettled(loaded)) {
          llmLog.debug("reconcile:deliver", { parentSid, childSid: child.id, alias: aliasOf(child) });
          this.onChildSettled(parentSid, child.id, aliasOf(child)); // enqueue + pump (parent is idle on boot)
        } else {
          llmLog.debug("reconcile:resume", { parentSid, childSid: child.id, alias: aliasOf(child) });
          void this.resume(child.id); // unfinished — re-drive; its turn:end delivers up to the parent
        }
      }
    }
  }

  compact(sid: string): Promise<void> {
    return compactSession(this.ctx, sid);
  }

  // Abort the in-flight turn too, or the stream keeps writing to a deleted session. Deleting a parent
  // cascades to the children it spawned.
  deleteSession(id: string): void {
    for (const child of getSessions().filter((s) => s.parentId === id)) this.deleteSession(child.id);
    // Hard-abort the in-flight turn (a graph run's controller too — stopTurn would only soft-pause it),
    // and tear down any resident loop parked on user input — the graph loop included.
    this.inflight.get(id)?.abort();
    this.killLoop(id);
    this.ctx.graph.kill(id);
    denyApprovalsForSession(id);
    this.ctx.runner.drop(id); // release any held slot + queued wait + binding
    // A deleted session's browser windows have no owner left to drive them — close them.
    void browserFleet().closeForSession(id);
    deleteSessionState(id);
  }

  // The per-tool modes exactly as the turn loop computes them — includeDisabled so the UI lists gated tools
  // that are currently off. Async: in electron the gateway resolves the policy in main over the bridge.
  async sessionToolModes(session: Session): Promise<Record<ToolName, ToolPermission>> {
    const { ws, agent } = capabilityContext(session);
    const filtered = await this.ctx.tools.filter({
      hasWorkspace: !!ws,
      workspacePermissions: ws?.permissions as Record<ToolName, ToolPermission> | undefined,
      agentPermissions: agent?.tools,
      includeDisabled: true,
    });
    return Object.fromEntries(
      Object.values(filtered)
        .filter((e) => e.permissioned)
        .map((e) => [e.name, e.effectiveMode]),
    ) as Record<ToolName, ToolPermission>;
  }

  // Returns null when the send is refused: nothing to send / that session already streaming / context full.
  async sendTo(sid: string, text: string, opts: SendOptions = {}): Promise<TurnResult | null> {
    const t = text.trim();
    const session = getSession(sid);
    // Empty text is allowed as long as there's at least one attachment.
    if (!session || (!t && !opts.images?.length && !opts.videos?.length && !opts.files?.length)) return null;
    // Unconfigured (null cfg) falls through — runTurn answers that with a proper turn error.
    const cfg = resolveMain();
    if (cfg && isFull(cfg, session)) return null;
    if (getStreamingIds().has(sid)) {
      // Truly async injection: a busy session never refuses a plain text message — it queues in the
      // pending inbox and the live loop drains it at its next cycle boundary (the message enters the
      // transcript at drain time, so order holds). Attachment sends still refuse: media can't queue yet.
      if (opts.images?.length || opts.videos?.length || opts.files?.length) return null;
      this.inbox.push({ id: crypto.randomUUID(), sessionId: sid, text: t, queuedAt: Date.now(), from: "user" });
      return null;
    }
    // Sessions lazy-load (ADR-0021) — load history before the turn reads it, or the model sees an empty conversation.
    await ensureLoaded(sid);
    return this.runTurn(sid, t, opts);
  }

  // Composer-facing send: targets the active session.
  async send(text: string, opts: SendOptions = {}): Promise<void> {
    await this.sendTo(getActiveId(), text, opts);
  }

  // Targets the created session BY ID — the active session can change between create and send.
  runAgent(
    agent: Agent,
    task: string,
    opts: SendOptions & { parentId?: string; containerId?: string; activate?: boolean } = {},
  ): { sid: string; result: Promise<TurnResult | null> } {
    const { parentId, containerId, activate, ...sendOpts } = opts;
    const sid = createSession(
      {
        title: agent.name,
        system: agent.system,
        containerId: containerId !== undefined ? containerId : getActiveContainerId() ?? "",
        agentId: agent.id,
        parentId,
      },
      { activate },
    );
    llmLog.debug("agent:create", { sid, parentId, agent: agent.name, containerId: getSession(sid)?.containerId, title: getSession(sid)?.title });
    return { sid, result: this.sendTo(sid, task, { ...sendOpts, autoName: false }) };
  }

  private async runTurn(sid: string, userText: string, opts: SendOptions): Promise<TurnResult> {
    const firstExchange = (getSession(sid)?.messages.length ?? 0) === 0;
    const autoName = opts.autoName !== false;
    // Forwarded context is a hidden user message that must precede the visible turn the model reads.
    if (opts.context) bus.emit("context", { sessionId: sid, text: opts.context });
    // turn:start must append the user + assistant placeholder BEFORE history is read.
    bus.emit("turn:start", { sessionId: sid, text: userText, images: opts.images, videos: opts.videos, files: opts.files });
    return this.drive(sid, opts, { firstExchange, autoName, userText });
  }

  // Resume a stalled turn: continue from the EXISTING history with no new user message, so the model
  // finishes the task instead of answering a re-prompt (the "Understood" failure). Drops the errored ⚠️
  // tail so history ends at the already-gathered tool results. Null if the session is gone or busy.
  async resume(sid: string): Promise<TurnResult | null> {
    if (!getSession(sid) || getStreamingIds().has(sid)) return null;
    await ensureLoaded(sid);
    bus.emit("turn:resume", { sessionId: sid });
    return this.drive(sid, {}, { firstExchange: false, autoName: false, userText: "" });
  }

  // The shared turn body. Both runTurn (after pushing the user turn) and resume (after re-opening the
  // tail) call it. The seam is ONE question: is a resident loop waiting on this surface? Yes → the
  // message feeds it (the loop's next segment). No → a graph session routes commands to its graph;
  // anything else is a fresh loop entry.
  private async drive(sid: string, opts: SendOptions, meta: { firstExchange: boolean; autoName: boolean; userText: string }): Promise<TurnResult> {
    const resident = this.loops.get(sid);
    if (getSession(sid)?.graphId) {
      // Mid-interview the graph session is a normal chat surface — except the exact `start` command,
      // which stays the kill-and-restart escape hatch. Everything else routes as a graph command.
      if (resident?.loop.waiting && meta.userText.trim().toLowerCase() !== "start") return resident.loop.feed(opts, meta);
      return this.ctx.graph.command(sid, meta.userText);
    }
    if (resident?.loop.waiting) return resident.loop.feed(opts, meta);
    return this.modelTurn(sid, opts, meta);
  }

  // ── The loop host (LoopHost) — resident loops by surface sid ────────────────

  private readonly loops = new Map<string, { loop: LlmSessionLoop; kill: () => void }>();
  // The pending inbox — injection into a BUSY session queues here and the live loop drains it at its
  // next cycle boundary. In-memory for now (declared-persistence lands with the wait records).
  private readonly inbox = memoryInbox();

  attachLoop(sid: string, loop: LlmSessionLoop): void {
    this.loops.set(sid, { loop, kill: () => loop.poke() });
  }
  detachLoop(sid: string, loop: LlmSessionLoop): void {
    if (this.loops.get(sid)?.loop === loop) this.loops.delete(sid);
  }

  // Tear down a session's resident loop: abort its signal, then wake it so the loop observes the
  // abort and settles (a waiting loop holds no in-flight turn to abort).
  killLoop(sid: string): void {
    this.loops.get(sid)?.kill();
    this.loops.delete(sid);
  }

  // A fresh loop entry for a plain turn: interactive (a user is present — errors and stops PAUSE, the
  // next message continues the same loop), no schema (settles on the first final reply), the validate
  // option riding as the custom classifier.
  private modelTurn(sid: string, opts: SendOptions, meta: { firstExchange: boolean; autoName: boolean; userText: string }): Promise<TurnResult> {
    if (!this.tracedConfig) {
      this.tracedConfig = true;
      llmLog.debug("config", { session: getAppConfig().session, connected: isConnected() });
    }
    const controller = new AbortController();
    const loop = new LlmSessionLoop(
      this.ctx,
      this,
      {
        sid,
        contract: { interactive: true },
        budget: getAppConfig().llm.maxHealAttempts,
        maxSteps: getAppConfig().session.maxSteps,
        signal: controller.signal,
        inbox: this.inbox,
      },
      { meta, opts },
    );
    this.loops.set(sid, { loop, kill: () => (controller.abort(), loop.poke()) });
    void loop.run({ kind: "go" });
    return loop.firstTurn;
  }

  // The public contract API — drive a session (child head, interview surface, one-shot run) to a
  // settled result. The graph's dialog/agent nodes and future Call dispatches come through here.
  runContract(
    sid: string,
    spec: {
      task?: string;
      schema?: Record<string, unknown>;
      interactive: boolean;
      budget?: number;
      // Extension meta keys patched into the session at construction (e.g. comics' generationJob) —
      // ride to tools on every call (see SessionRuntime).
      meta?: Record<string, unknown>;
      seedFiles?: string[];
      signal?: AbortSignal;
      reattach?: boolean;
    },
  ): { settled: Promise<Settlement> } {
    const controller = new AbortController();
    spec.signal?.addEventListener("abort", () => controller.abort(), { once: true });
    if (spec.signal?.aborted) controller.abort();
    const loop = new LlmSessionLoop(
      this.ctx,
      this,
      {
        sid,
        contract: { schema: spec.schema, interactive: spec.interactive },
        budget: spec.budget ?? getAppConfig().llm.maxHealAttempts,
        maxSteps: getAppConfig().session.maxSteps,
        signal: controller.signal,
        inbox: this.inbox,
      },
      { meta: { firstExchange: false, autoName: false, userText: "" }, opts: {} },
    );
    this.loops.set(sid, { loop, kill: () => (controller.abort(), loop.poke()) });
    const settled = (async () => {
      await ensureLoaded(sid);
      if (spec.meta) patchMeta(sid, spec.meta);
      // Never seed a reattach — the surface already carries its transcript; seeding would re-post the task.
      if (!spec.reattach) await this.seedFiles(sid, spec.task, spec.seedFiles);
      const initial: LoopInput =
        spec.reattach || !spec.task ? { kind: "resume" } : spec.seedFiles?.length ? { kind: "resume" } : { kind: "task", text: spec.task };
      return await loop.run(initial);
    })();
    return { settled };
  }

  // Load files into the transcript as REAL tool calls — [assistant: Read/ImageLoad calls] →
  // [tool: contents/images], images downscaled like any tool image. The shared trunk behind
  // contract seeding (below) and graph result showcasing (a finished flow SHOWS its page instead
  // of pointing at a folder).
  async loadFiles(sid: string, files: string[] | undefined): Promise<void> {
    const paths = [...new Set((files ?? []).filter((p) => p.startsWith("/")))];
    if (!paths.length || !this.ctx.tools) return;
    const root = (getContainer(getSession(sid)?.containerId)?.config.root as string | undefined) ?? "";
    const isImage = (p: string): boolean => /\.(png|jpe?g|webp|gif)$/i.test(p);
    const calls = paths.map((path) => ({ id: crypto.randomUUID(), name: isImage(path) ? "ImageLoad" : "Read", arguments: JSON.stringify({ path }), cwd: root, path }));
    setLastToolCalls(sid, calls.map(({ path: _p, ...call }) => call));
    const maxDim = resolveMain()?.imageMaxDim;
    for (const c of calls) {
      const res = await this.ctx.tools.run({ id: c.id, name: c.name, arguments: c.arguments, cwd: root });
      const images = res?.images?.length
        ? await Promise.all(res.images.map(async (g) => {
            const d = maxDim ? await downscaleImage(g.url, g.mime ?? "", maxDim) : undefined;
            return { ...g, url: d?.url ?? g.url, mime: d?.mime ?? g.mime };
          }))
        : undefined;
      pushToolResult(sid, c.id, res?.output ?? `(could not load ${c.path})`, images);
    }
    // Direct store pushes bypass the bus listeners — register the loaded opening NOW, so a head
    // that stalls after seeding still has its task + reference cards on disk.
    commitMessages(sid);
  }

  // Seed the opening with pre-selected files: [task] → loadFiles; the loop then resumes with
  // everything already in context (an agent studies what is in front of it far more reliably than
  // it remembers to fetch it). No-op without files.
  private async seedFiles(sid: string, task: string | undefined, files: string[] | undefined): Promise<void> {
    const paths = (files ?? []).filter((p) => p.startsWith("/"));
    if (!paths.length || !task) return;
    pushTurn(sid, task);
    await this.loadFiles(sid, paths);
  }

}


// A child has reached a terminal, deliverable state: a stored failure (errorKind — delivered as a note)
// or a final answer (its last committed message is an assistant with no pending tool calls). Anything
// else (last message a user task or a tool result) is an interrupted run that needs resuming, not
// delivering. Derived from the durable transcript — no streaming/pause signal (none survive a reload).
function isSettled(s: Session): boolean {
  if (s.meta.errorKind) return true;
  const last = s.messages.at(-1);
  return !!last && last.role === "assistant" && !last.toolCalls?.length;
}

