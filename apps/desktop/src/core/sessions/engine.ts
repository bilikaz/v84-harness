import type { ErrorKind, ToolCallRequest, ToolSpec } from "../../llm/types.ts";
import { healCorrection, type ResponseHandler } from "../../llm/index.ts";
import { llmLog } from "../../llm/debug.ts";
import type { Attachments, Image, Video, Session } from "./types.ts";
import { resolveMain } from "../settings.ts";
import type { Ctx } from "../ctx.ts";
import { effectiveImageMaxDim, getAppConfig } from "../config/index.ts";
import { denyApprovalsForSession, requestApproval } from "../approvals.ts";
import { getAgent, type Agent } from "../agents.ts";
import { getActiveContainerId, getContainer, type Container } from "../containers.ts";
import { isConnected } from "../account.ts";
import { type ToolName, type ToolPermission, type ToolResult } from "../tools/types.ts";
import { pt, fill, deliveryNudge } from "../prompts.ts";
import { engineToolSchemas, isEngineTool, runEngineTool } from "../tools/engine/dispatch.ts";
import { GET_AGENT_CONTENT, aliasOf, collectAgentContent, lastAgentText } from "../tools/helpers/agents/catalog.ts";
import type { EngineCtx } from "../tools/engine/base.ts";
import { browserFleet } from "../browser.ts";
import { enabledPluginPrompts } from "../plugins/config.ts";
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
  removeToolCall,
  setUserPaused,
  toChatMessages,
} from "./store.ts";
import { errorMessage } from "../../lib/errors.ts";
import { downscaleImage } from "../../lib/imageResize.ts";
import { nameSession } from "./naming.ts";
import { compact as compactSession } from "./compaction.ts";

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
      // Sync mode delivers via awaitSettled's own turn:end subscription instead; pushing here too would
      // double-deliver. Skip aborts (a user pause / cascade) — only a terminal success/error is delivered.
      if (s?.parentId && getAppConfig().session.asyncAgents) {
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
    this.inflight.get(sid)?.abort();
    denyApprovalsForSession(sid);
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

  // Block until a child reaches a TERMINAL, non-aborted end (success or error), then return its final result
  // read from history. This is sync delivery: it rides through any number of user pause→guide→resume cycles —
  // an aborted turn:end is a PAUSE, so we keep waiting (the raw turn Promise can't, it resolves on first
  // abort). `dispatch` (the started turn's Promise) is a liveness guard: if it resolves null the turn never
  // started (busy/full) and no turn:end will come, so resolve null rather than hang. On the PARENT's abort,
  // stop the child and resolve aborted.
  awaitSettled(childSid: string, signal: AbortSignal, dispatch: Promise<TurnResult | null>): Promise<TurnResult | null> {
    return new Promise<TurnResult | null>((resolve) => {
      const finish = (r: TurnResult | null): void => {
        offEnd();
        signal.removeEventListener("abort", onAbort);
        resolve(r);
      };
      const offEnd = bus.on("turn:end", (e) => {
        if (e.sessionId !== childSid || e.aborted) return; // not ours, or a pause — keep waiting
        finish({ text: lastAgentText(childSid), errored: e.errored, aborted: false, errorKind: e.errored ? getSession(childSid)?.errorKind : undefined });
      });
      const onAbort = (): void => {
        this.stopTurn(childSid);
        finish({ text: lastAgentText(childSid), errored: false, aborted: true });
      };
      // A refused dispatch (null) never emits turn:end — don't hang. A non-null result is a single turn
      // ending (possibly a pause); ignore it and let the turn:end subscription decide (it rides pauses).
      void dispatch.then((r) => { if (r === null) finish(null); }).catch(() => finish(null));
      if (signal.aborted) return void onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
    });
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
    if (getStreamingIds().has(parentSid)) return; // busy — retained; turn:end will pump again
    const entries = [...q];
    this.deliveries.delete(parentSid);
    void this.deliver(parentSid, entries).catch(() => {});
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
    const result = await this.drive(parentSid, {}, { firstExchange: false, autoName: false, userText: "" });
    if (result.errored) await this.sendTo(parentSid, deliveryNudge(aliases), { autoName: false }); // provider rejected the fabricated history
  }

  compact(sid: string): Promise<void> {
    return compactSession(this.ctx, sid);
  }

  // Abort the in-flight turn too, or the stream keeps writing to a deleted session. Deleting a parent
  // cascades to the children it spawned.
  deleteSession(id: string): void {
    for (const child of getSessions().filter((s) => s.parentId === id)) this.deleteSession(child.id);
    this.stopTurn(id);
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
    if (getStreamingIds().has(sid) || (cfg && isFull(cfg, session))) return null;
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

  // The shared turn body: setup → step loop → finalize. Both runTurn (after pushing the user turn) and
  // resume (after re-opening the tail) call it — the only difference is how the turn was opened above.
  private async drive(sid: string, opts: SendOptions, meta: { firstExchange: boolean; autoName: boolean; userText: string }): Promise<TurnResult> {
    const { firstExchange, autoName, userText } = meta;
    // First thing to sanity-check: the live config (is async on? which delivery? connected?). Logged once.
    if (!this.tracedConfig) {
      this.tracedConfig = true;
      llmLog.debug("config", { session: getAppConfig().session, connected: isConnected() });
    }
    const cfg = resolveMain();
    if (!cfg) {
      bus.emit("turn:error", { sessionId: sid, message: "no chat model is configured — pick a provider and model in Settings.", kind: "other" });
      bus.emit("message:done", { sessionId: sid, text: "", thinking: "", errored: true, firstExchange, autoName, userText });
      bus.emit("turn:end", { sessionId: sid, errored: true, aborted: false });
      return { text: "", errored: true, aborted: false, errorKind: "other" };
    }

    const isChild = !!getSession(sid)?.parentId; // a sub-agent run — never orchestrates further
    const { ws, agent } = capabilityContext(getSession(sid));
    const controller = new AbortController();
    this.inflight.set(sid, controller);

    // Lease a concurrency slot for the whole turn: foreground draws the `main` pool, a child the
    // `subAgent` pool (held across every step, released in the finally). A null lease is either a
    // user Stop while queued (aborted — clean exit) or an empty pool (no models for this role) —
    // the latter falls back to the primary `main` target so a child still runs un-leased.
    const role = isChild ? "subAgent" : "main";
    const lease = await this.ctx.runner.acquire(role, sid, getSession(sid)?.usedTokens ?? 0, { signal: controller.signal });
    if (!lease && controller.signal.aborted) {
      this.inflight.delete(sid);
      bus.emit("message:done", { sessionId: sid, text: "", thinking: "", errored: false, firstExchange, autoName, userText });
      bus.emit("turn:end", { sessionId: sid, errored: false, aborted: true });
      return { text: "", errored: false, aborted: true };
    }
    const callTarget = lease?.config; // undefined → resolveProvider falls back to the global `main` assignment
    const turnInput = (lease?.config.input ?? cfg.input) ?? {};

    // The engine-call context for the driver-level tool tier (browser fleet, sub-agent spawner).
    const ec: EngineCtx = { ctx: this.ctx, sessionId: sid, workspace: ws, signal: controller.signal, isChild, engine: this };
    // One policy pass: the gateway returns the advertised schemas + each tool's effective mode. The engine
    // tier (sub-agent pair, browser fleet) is driver-level and joins the advertised set here.
    const filtered = await this.ctx.tools.filter({
      checkCanRun: true,
      hasWorkspace: !!ws,
      workspacePermissions: ws?.permissions as Record<ToolName, ToolPermission> | undefined,
      agentPermissions: agent?.tools,
    });
    const toolSpecs: ToolSpec[] = [...Object.values(filtered).map((e) => e.schema as ToolSpec), ...engineToolSchemas(ec)];
    llmLog.debug("turn", { workspace: ws?.name ?? null, tools: toolSpecs.map((t) => t.function.name) });
    // The virtual-root convention (ADR-0007) is invisible otherwise — tell the model only when file tools are actually advertised.
    const fsAccess = Object.values(filtered).some((e) => e.permissioned);
    // Browser guidance (reuse windows, short ids, ask the user for logins) — only when the fleet is live and
    // the browser tools are actually advertised (top-level sessions on the electron host).
    const browserAccess = !isChild && browserFleet().available();

    let finalText = "";
    let finalThinking = "";
    let errored = false;
    let errorKind: ErrorKind | undefined;
    let healAttempts = 0;

    const maxSteps = getAppConfig().session.maxSteps;
    let step = 0;
    try {
      for (; step < maxSteps; step++) {
        if (controller.signal.aborted) break;
        // History is re-filtered against the CURRENT model's inputs each step — the model can change mid-session, and yesterday's images must not 400 today's text-only endpoint.
        const history = toChatMessages(getSession(sid)?.messages ?? [], turnInput);
        // The overridable BASE block, resolved live: the agent's baked system → the session's container
        // (workspace) message → the user's global system prompt (Settings) → the built-in default. Read the
        // session's OWN container (not the fs-masked `ws`) so a workspace message applies even when its file
        // tools are masked. The capability blocks below (workspace fs / browser / memory) append on top
        // regardless, to enforce proper tool usage.
        const containerMessage = getContainer(getSession(sid)?.containerId)?.config.instructions as string | undefined;
        // fill() so {{language}} (and any vars) expand in user/workspace messages too, not just built-ins.
        const baseSystem = fill(
          getSession(sid)?.system || containerMessage || getAppConfig().systemPrompt || pt("defaultChat.system"),
        );
        // Append the workspace prompt when file tools are advertised, and the memory
        // prompt when the account is connected (same gate that advertises the memory tools).
        const system =
          [
            baseSystem,
            fsAccess ? pt("workspace.system") : undefined,
            browserAccess ? pt("browser.system") : undefined,
            isConnected() ? pt("memory.system") : undefined,
            ...enabledPluginPrompts(), // each enabled plugin's own tool guidance
          ]
            .filter(Boolean)
            .join("\n\n") || undefined;

        // Heal stays driver-driven (the correction is a SESSION turn via the store), so the handler never throws HealError.
        const { text, thinking, calls } = await this.ctx.llm.call({
          service: "main",
          target: callTarget,
          messages: history,
          system,
          tools: toolSpecs,
          signal: controller.signal,
          handler: this.chatStepHandler(sid, (kind) => {
            errored = true;
            errorKind = kind;
          }),
        });
        finalText = text;
        finalThinking = thinking;
        if (errored || controller.signal.aborted) break;

        // Rejected final turn → hidden correction + re-stream, up to llm.maxHealAttempts; budget spent → error, never best-effort output.
        if (!calls.length) {
          if (opts.validate) {
            try {
              opts.validate(text);
            } catch (e) {
              if (healAttempts < getAppConfig().llm.maxHealAttempts) {
                healAttempts += 1;
                bus.emit("heal", { sessionId: sid, correction: healCorrection(e) });
                continue;
              }
              errored = true;
              errorKind = "other";
              bus.emit("turn:error", {
                sessionId: sid,
                message: `output validation failed after ${healAttempts} heal attempt(s): ${errorMessage(e)}`,
                kind: "other",
              });
            }
          }
          break;
        }
        // Run all calls concurrently — results link back via toolCallId, so completion order doesn't matter.
        bus.emit("tool:calls", { sessionId: sid, calls });
        llmLog.debug("tool:calls", {
          sessionId: sid,
          isChild,
          step,
          calls: calls.map((c) => ({ id: c.id, name: c.name, engine: isEngineTool(c.name), args: c.arguments })),
        });
        const fedImages: Image[] = []; // tool-produced images to show the vision agent this step
        const fedVideo: Video[] = []; // tool-produced video — fed back only when the model takes video input
        let erased = false; // an engine tool asked to erase its call and end the turn (premature getAgentContent)
        await Promise.all(
          calls.map(async (call) => {
            // The engine tool tier (sub-agent pair, browser fleet) is driver-level — it needs the live
            // engine/ctx, not the registry. One gated dispatch; the engine emits its result + feeds images.
            if (isEngineTool(call.name)) {
              const res = await runEngineTool(call, ec);
              llmLog.debug("tool:result", { sessionId: sid, name: call.name, via: "engine", erase: !!res.eraseTurn, childSessionIds: res.childSessionIds, browserWindowId: res.browserWindowId, output: logTrunc(res.output) });
              // Erase: scrub the call from history and end the turn — no tool:result, looks like it never happened.
              if (res.eraseTurn) {
                erased = true;
                removeToolCall(sid, call.id);
                return;
              }
              const images = await this.downscaleToolImages(res.images, effectiveImageMaxDim(cfg.imageMaxDim));
              bus.emit("tool:result", { sessionId: sid, toolCallId: call.id, output: res.output, images, videos: res.videos, childSessionIds: res.childSessionIds, browserWindowId: res.browserWindowId });
              if (images?.length) fedImages.push(...images);
              if (res.videos?.length) fedVideo.push(...res.videos);
              return;
            }
            const mode = filtered[call.name]?.effectiveMode ?? 0;
            if (mode === 0) {
              const why = !ws
                ? `tool "${call.name}" needs a workspace folder — open one for this session to use it.`
                : `tool "${call.name}" is disabled for this session.`;
              llmLog.debug("tool:result", { sessionId: sid, name: call.name, via: "blocked", output: why });
              bus.emit("tool:result", { sessionId: sid, toolCallId: call.id, output: why });
              return;
            }
            if (mode === 1 && !(await requestApproval(sid, call))) {
              llmLog.debug("tool:result", { sessionId: sid, name: call.name, via: "denied" });
              bus.emit("tool:result", { sessionId: sid, toolCallId: call.id, output: `the user denied the ${call.name} call.` });
              return;
            }
            // The user may have hit Stop while the approval sat in the queue.
            if (controller.signal.aborted) {
              llmLog.debug("tool:result", { sessionId: sid, name: call.name, via: "cancelled" });
              bus.emit("tool:result", { sessionId: sid, toolCallId: call.id, output: "cancelled by the user." });
              return;
            }
            let result: ToolResult;
            // A live AbortSignal can't cross the bridge — Stop cancels the running tool by id.
            const onAbort = (): void => this.ctx.tools.cancel(call.id);
            controller.signal.addEventListener("abort", onAbort, { once: true });
            try {
              // The platform's gateway runs the call — web in-process, electron over the bridge (cancel via ADR-0014).
              result =
                (await this.ctx.tools.run({ id: call.id, name: call.name, arguments: call.arguments, cwd: (ws?.config.root as string | undefined) ?? "" })) ??
                { ok: false, output: `tool "${call.name}" is unavailable here.` };
            } catch (e) {
              result = { ok: false, output: `tool execution failed: ${errorMessage(e)}` };
            } finally {
              controller.signal.removeEventListener("abort", onAbort);
            }
            const output = result.output;
            llmLog.debug("tool:result", { sessionId: sid, name: call.name, via: "registry", ok: result.ok, output: logTrunc(output) });
            const images = await this.downscaleToolImages(result.images, effectiveImageMaxDim(cfg.imageMaxDim));
            const videos = result.videos?.map((g) => ({ url: g.url, mime: g.mime, name: g.name }));
            bus.emit("tool:result", { sessionId: sid, toolCallId: call.id, output, images, videos });
            if (images?.length) fedImages.push(...images);
            if (videos?.length) fedVideo.push(...videos);
          }),
        );
        // A premature getAgentContent erased its own call — end the turn cleanly (no result to react to).
        if (erased) break;
        // Feed back only what the model's declared inputs accept — otherwise the endpoint rejects the turn.
        const feedImages = turnInput.image !== false ? fedImages : [];
        const feedVideo = turnInput.video === true ? fedVideo : [];
        if (feedImages.length || feedVideo.length) {
          bus.emit("mediaFeedback", {
            sessionId: sid,
            images: feedImages.length ? feedImages : undefined,
            videos: feedVideo.length ? feedVideo : undefined,
          });
        }
        bus.emit("assistant:open", { sessionId: sid });
      }
      // Step budget spent: emit an error — silent truncation reads as a finished answer.
      if (step >= maxSteps && !errored && !controller.signal.aborted) {
        errored = true;
        errorKind = "other";
        bus.emit("turn:error", {
          sessionId: sid,
          message: `tool loop stopped after ${maxSteps} steps without a final answer — the task may be looping or too complex for one turn.`,
          kind: "other",
        });
      }
    } catch (e) {
      // A user Stop aborts the controller → the stream throws here; that's a clean stop, not an error.
      if (!controller.signal.aborted) {
        errored = true;
        errorKind = "other";
        bus.emit("turn:error", { sessionId: sid, message: errorMessage(e), kind: "other" });
      }
    } finally {
      this.inflight.delete(sid);
      this.ctx.runner.release(sid); // free the slot; the provider binding lingers for the TTL
      // The model that actually served this turn (leased pool model, or the `main` fallback) — recorded as
      // the session's lastModel so the composer labels the chat by what answered, not the configured head.
      const model = errored ? undefined : callTarget?.model.id ?? cfg.model.id;
      bus.emit("message:done", { sessionId: sid, text: finalText, thinking: finalThinking, errored, firstExchange, autoName, userText, model });
      bus.emit("turn:end", { sessionId: sid, errored, aborted: controller.signal.aborted });
    }
    return { text: finalText, errored, aborted: controller.signal.aborted, errorKind: errored ? errorKind : undefined };
  }

  // Streams one chat step's events onto the session bus; `onError` flags a terminal stream error (already emitted) so the turn loop stops, with its kind.
  private chatStepHandler(sid: string, onError: (kind: ErrorKind) => void): ResponseHandler<{ text: string; thinking: string; calls: ToolCallRequest[] }> {
    return {
      async handle(interaction) {
        if (interaction.kind !== "chat") throw new Error("the chat step expects a chat interaction.");
        let text = "";
        let thinking = "";
        let thinkingDone = false;
        const calls: ToolCallRequest[] = [];
        for await (const evt of interaction.events) {
          if (evt.type === "text") {
            if (thinking && !thinkingDone) {
              thinkingDone = true;
              bus.emit("thinking:done", { sessionId: sid });
            }
            text += evt.delta;
            bus.emit("text", { sessionId: sid, delta: evt.delta });
          } else if (evt.type === "thinking") {
            thinking += evt.delta;
            bus.emit("thinking", { sessionId: sid, delta: evt.delta });
          } else if (evt.type === "tool_call") {
            calls.push(evt.call);
          } else if (evt.type === "retry") {
            // Transport retry re-sends the step from scratch — discard the attempt's partial output.
            text = "";
            thinking = "";
            thinkingDone = false;
            calls.length = 0;
            bus.emit("stream:retry", { sessionId: sid, message: evt.message });
          } else if (evt.type === "usage") {
            bus.emit("usage", { sessionId: sid, usage: evt.usage });
          } else if (evt.type === "error") {
            onError(evt.kind);
            bus.emit("turn:error", { sessionId: sid, message: evt.message, kind: evt.kind });
            break;
          }
        }
        if (thinking && !thinkingDone) bus.emit("thinking:done", { sessionId: sid });
        return { text, thinking, calls };
      },
    };
  }

  // Downscale tool-produced images in this renderer hop (canvas lives here, not main). The item's mime is
  // optional; the resizer treats unknown ("") as "try". Shared by the registry path and the engine tier.
  private async downscaleToolImages(images: Image[] | undefined, maxDim: number): Promise<Image[] | undefined> {
    if (!images?.length) return undefined;
    return Promise.all(
      images.map(async (g) => {
        const d = await downscaleImage(g.url, g.mime ?? "", maxDim);
        return { url: d?.url ?? g.url, mime: d?.mime ?? g.mime, name: g.name };
      }),
    );
  }
}

// Cap a tool result for the debug log — full outputs (file dumps, page text) would swamp the console.
function logTrunc(s: string | undefined, max = 800): string {
  if (!s) return "";
  return s.length > max ? `${s.slice(0, max)}… (+${s.length - max} chars)` : s;
}

// The STRICTER context selection: a chat-only agent is masked (no fs workspace). Only `local`
// containers expose the fs tool tier today (the `remote` VM tier is deferred to a later slice);
// `chat` containers get no workspace, just the general tier.
function capabilityContext(session: Session | undefined): { ws: Container | undefined; agent: Agent | undefined } {
  const agent = session?.agentId ? getAgent(session.agentId) : undefined;
  const container = getContainer(session?.containerId);
  const ws = agent && !agent.workspace ? undefined : container?.type === "local" ? container : undefined;
  return { ws, agent };
}
