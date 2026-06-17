import type { ToolCallRequest, ToolSpec } from "../../llm/types.ts";
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
import { pt, fill } from "../../lib/prompts.ts";
import { engineToolSchemas, isEngineTool, runEngineTool } from "../tools/engine/dispatch.ts";
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
  toChatMessages,
} from "./store.ts";
import { errorMessage } from "../../lib/errors.ts";
import { downscaleImage } from "../../lib/imageResize.ts";
import { nameSession } from "./naming.ts";
import { compact as compactSession } from "./compaction.ts";

// Validator for the model's final (no-tool) turn: throw to reject — the engine injects a correction and retries.
export type OutputValidator = (text: string) => void;

// How a turn ended; `text` is the final answer — partial if aborted.
export interface TurnResult {
  text: string;
  errored: boolean;
  aborted: boolean;
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

  constructor(private readonly ctx: Ctx) {
    // The session store's data engine + hydration are injected/orchestrated by init() AFTER
    // ctx.storage is installed (this constructor runs during `new Ctx`, before that).
    // Auto-name the session after its first exchange.
    bus.on("message:done", (e) => {
      if (e.firstExchange && e.autoName && !e.errored) void nameSession(this.ctx, e.sessionId);
    });
    // Compact once a turn ends and the session has grown past its context budget.
    bus.on("turn:end", (e) => {
      if (e.errored) return;
      const cfg = resolveMain();
      const s = getSession(e.sessionId);
      if (cfg && s && isFull(cfg, s)) void this.compact(e.sessionId);
    });
  }

  // Also denies the session's queued approvals — an unanswered approval Promise would keep the turn pending forever.
  stopTurn(sid: string): void {
    this.inflight.get(sid)?.abort();
    denyApprovalsForSession(sid);
  }

  compact(sid: string): Promise<void> {
    return compactSession(this.ctx, sid);
  }

  // Abort the in-flight turn too, or the stream keeps writing to a deleted session. Deleting a parent
  // cascades to the children it spawned.
  deleteSession(id: string): void {
    for (const child of getSessions().filter((s) => s.parentId === id)) this.deleteSession(child.id);
    this.stopTurn(id);
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
    return { sid, result: this.sendTo(sid, task, { ...sendOpts, autoName: false }) };
  }

  private async runTurn(sid: string, userText: string, opts: SendOptions): Promise<TurnResult> {
    const firstExchange = (getSession(sid)?.messages.length ?? 0) === 0;
    const autoName = opts.autoName !== false;

    // Forwarded context is a hidden user message that must precede the visible turn the model reads.
    if (opts.context) bus.emit("context", { sessionId: sid, text: opts.context });
    // turn:start must append the user + assistant placeholder BEFORE history is read.
    bus.emit("turn:start", { sessionId: sid, text: userText, images: opts.images, videos: opts.videos, files: opts.files });

    const cfg = resolveMain();
    if (!cfg) {
      bus.emit("turn:error", { sessionId: sid, message: "no chat model is configured — pick a provider and model in Settings." });
      bus.emit("message:done", { sessionId: sid, text: "", thinking: "", errored: true, firstExchange, autoName, userText });
      bus.emit("turn:end", { sessionId: sid, errored: true });
      return { text: "", errored: true, aborted: false };
    }

    const isChild = !!getSession(sid)?.parentId; // a sub-agent run — never orchestrates further
    const { ws, agent } = capabilityContext(getSession(sid));
    const controller = new AbortController();
    this.inflight.set(sid, controller);
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
    let healAttempts = 0;

    const maxSteps = getAppConfig().session.maxSteps;
    let step = 0;
    try {
      for (; step < maxSteps; step++) {
        if (controller.signal.aborted) break;
        // History is re-filtered against the CURRENT model's inputs each step — the model can change mid-session, and yesterday's images must not 400 today's text-only endpoint.
        const history = toChatMessages(getSession(sid)?.messages ?? [], cfg.input ?? {});
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
          messages: history,
          system,
          tools: toolSpecs,
          signal: controller.signal,
          handler: this.chatStepHandler(sid, () => {
            errored = true;
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
              bus.emit("turn:error", {
                sessionId: sid,
                message: `output validation failed after ${healAttempts} heal attempt(s): ${errorMessage(e)}`,
              });
            }
          }
          break;
        }
        // Run all calls concurrently — results link back via toolCallId, so completion order doesn't matter.
        bus.emit("tool:calls", { sessionId: sid, calls });
        const fedImages: Image[] = []; // tool-produced images to show the vision agent this step
        const fedVideo: Video[] = []; // tool-produced video — fed back only when the model takes video input
        await Promise.all(
          calls.map(async (call) => {
            // The engine tool tier (sub-agent pair, browser fleet) is driver-level — it needs the live
            // engine/ctx, not the registry. One gated dispatch; the engine emits its result + feeds images.
            if (isEngineTool(call.name)) {
              const res = await runEngineTool(call, ec);
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
              bus.emit("tool:result", { sessionId: sid, toolCallId: call.id, output: why });
              return;
            }
            if (mode === 1 && !(await requestApproval(sid, call))) {
              bus.emit("tool:result", { sessionId: sid, toolCallId: call.id, output: `the user denied the ${call.name} call.` });
              return;
            }
            // The user may have hit Stop while the approval sat in the queue.
            if (controller.signal.aborted) {
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
            const images = await this.downscaleToolImages(result.images, effectiveImageMaxDim(cfg.imageMaxDim));
            const videos = result.videos?.map((g) => ({ url: g.url, mime: g.mime, name: g.name }));
            bus.emit("tool:result", { sessionId: sid, toolCallId: call.id, output, images, videos });
            if (images?.length) fedImages.push(...images);
            if (videos?.length) fedVideo.push(...videos);
          }),
        );
        // Feed back only what the model's declared inputs accept — otherwise the endpoint rejects the turn.
        const feedImages = cfg.input?.image !== false ? fedImages : [];
        const feedVideo = cfg.input?.video === true ? fedVideo : [];
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
        bus.emit("turn:error", {
          sessionId: sid,
          message: `tool loop stopped after ${maxSteps} steps without a final answer — the task may be looping or too complex for one turn.`,
        });
      }
    } catch (e) {
      // A user Stop aborts the controller → the stream throws here; that's a clean stop, not an error.
      if (!controller.signal.aborted) {
        errored = true;
        bus.emit("turn:error", { sessionId: sid, message: errorMessage(e) });
      }
    } finally {
      this.inflight.delete(sid);
      bus.emit("message:done", { sessionId: sid, text: finalText, thinking: finalThinking, errored, firstExchange, autoName, userText });
      bus.emit("turn:end", { sessionId: sid, errored });
    }
    return { text: finalText, errored, aborted: controller.signal.aborted };
  }

  // Streams one chat step's events onto the session bus; `onError` flags a terminal stream error (already emitted) so the turn loop stops.
  private chatStepHandler(sid: string, onError: () => void): ResponseHandler<{ text: string; thinking: string; calls: ToolCallRequest[] }> {
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
            onError();
            bus.emit("turn:error", { sessionId: sid, message: evt.message });
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

// The STRICTER context selection: a chat-only agent is masked (no fs workspace). Only `local`
// containers expose the fs tool tier today (the `remote` VM tier is deferred to a later slice);
// `chat` containers get no workspace, just the general tier.
function capabilityContext(session: Session | undefined): { ws: Container | undefined; agent: Agent | undefined } {
  const agent = session?.agentId ? getAgent(session.agentId) : undefined;
  const container = getContainer(session?.containerId);
  const ws = agent && !agent.workspace ? undefined : container?.type === "local" ? container : undefined;
  return { ws, agent };
}
