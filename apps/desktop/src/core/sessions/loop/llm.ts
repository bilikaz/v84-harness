// LlmSessionLoop — the llm shape over SessionLoopBase: respond() is ONE model step (config/lease,
// history projection, streaming — the kept engine mechanics), dispatch() is the tool execution
// tier. The loop above owns iteration, healing, waiting, settling. SEGMENTS give the UI its turn
// lifecycle: a segment spans from one fresh input (user message / task / delivery) to the next
// wait-or-settle boundary — every existing event fires exactly where it fired before, per segment.
// An interactive loop stays RESIDENT across segments (the drive seam feeds it); an autonomous loop
// is one run to settlement.

import type { ErrorKind, ToolCallRequest } from "../../../llm/types.ts";
import { healCorrection, type ResponseHandler } from "../../../llm/index.ts";
import { llmLog } from "../../../llm/debug.ts";
import type { Ctx } from "../../ctx.ts";
import type { LLMConfig } from "../../config/index.ts";
import type { SendOptions, TurnResult } from "../engine.ts";
import { resolveMain } from "../../settings.ts";
import { effectiveImageMaxDim } from "../../config/index.ts";
import { denyApprovalsForSession, requestApproval } from "../../approvals.ts";
import { type ToolResult } from "../../tools/types.ts";
import { capabilitiesFor, composeSystem, type SessionCapabilities } from "../system.ts";
import { isEngineTool, runEngineTool } from "../../tools/engine/dispatch.ts";
import type { EngineCtx } from "../../tools/engine/base.ts";
import { sessionBus as bus } from "../events.ts";
import { getSession, removeToolCall, setLastSystem, stampMediaRefs, toChatMessages } from "../store.ts";
import { extractRefTokens, refLabel, resolveRefs } from "../mediaRefs.ts";
import { errorMessage } from "../../../lib/errors.ts";
import { downscaleImage } from "../../../lib/imageResize.ts";
import type { Image, Video } from "../types.ts";
import { SessionLoopBase, type LoopContext, type LoopInput, type ResponseEnvelope, type ToolCallReq, type ToolResultMsg, type LoopState } from "./base.ts";
import type { Verdict } from "./contract.ts";
import { classify } from "./contract.ts";
import type { Settlement } from "./records.ts";

// What the loop needs from its engine — implemented structurally by SessionEngine.
export interface LoopHost {
  registerInflight(sid: string, controller: AbortController): void;
  clearInflight(sid: string): void;
  attachLoop(sid: string, loop: LlmSessionLoop): void;
  detachLoop(sid: string, loop: LlmSessionLoop): void;
}

// One segment = the UI's "turn": opened on a fresh input, closed at the next wait/settle boundary.
interface Segment {
  controller: AbortController;
  meta: { firstExchange: boolean; autoName: boolean; userText: string };
  opts: SendOptions;
  leased: boolean;
  callTarget?: LLMConfig; // the leased binding — undefined falls back to the global `main` assignment
  callTargetModelId?: string;
  imageMaxDim?: number; // from the resolved main config — tool images downscale to it
  turnInput: Record<string, unknown>;
  caps: SessionCapabilities; // derived ONCE per segment (system.ts) — specs for the call, flags for the blocks
  finalText: string;
  finalThinking: string;
  errored: boolean;
  errorKind?: ErrorKind;
  erased: boolean; // an engine tool erased its call — end the segment as if the reply were final
  resolveTurn: (r: TurnResult) => void;
}

export class LlmSessionLoop extends SessionLoopBase {
  private seg?: Segment;
  private pending?: { meta: Segment["meta"]; opts: SendOptions; resolveTurn: (r: TurnResult) => void };
  private waiter?: (input: LoopInput) => void;

  constructor(
    private readonly app: Ctx,
    private readonly host: LoopHost,
    loopCtx: LoopContext,
    first: { meta: Segment["meta"]; opts: SendOptions },
  ) {
    super(loopCtx);
    this.firstTurn = new Promise<TurnResult>((resolve) => {
      this.pending = { meta: first.meta, opts: first.opts, resolveTurn: resolve };
    });
    this.host.attachLoop(this.ctx.sid, this);
  }

  // The FIRST segment's TurnResult — what sendTo/runTurn await (later segments resolve via feed()).
  readonly firstTurn: Promise<TurnResult>;

  // Is the loop parked on nextUserInput (the drive seam's feed target)?
  get waiting(): boolean {
    return !!this.waiter;
  }

  // The pushed seam: a user message on this surface becomes the next input; the returned promise is
  // that segment's TurnResult (resolved at the next wait/settle boundary). runTurn already pushed
  // the user turn into the store, so the loop proceeds from history.
  feed(opts: SendOptions, meta: Segment["meta"]): Promise<TurnResult> {
    return new Promise<TurnResult>((resolve) => {
      this.pending = { meta, opts, resolveTurn: resolve };
      const w = this.waiter;
      this.waiter = undefined;
      w?.({ kind: "go" });
    });
  }

  // Wake a waiting loop with no new input — after aborting its signal this lets the loop observe the
  // abort and settle (the teardown path for a deleted session's resident loop).
  poke(): void {
    const w = this.waiter;
    this.waiter = undefined;
    w?.({ kind: "go" });
  }

  // ── Expansion points ────────────────────────────────────────────────────────

  protected override async respond(input: LoopInput): Promise<ResponseEnvelope> {
    // Apply the input to the session's stored history — the store rides the same events as always.
    if (input.kind === "task") bus.emit("turn:start", { sessionId: this.ctx.sid, text: input.text });
    else if (input.kind === "message") bus.emit("heal", { sessionId: this.ctx.sid, correction: input.text });
    else if (input.kind === "resume") bus.emit("turn:resume", { sessionId: this.ctx.sid });
    else if (input.kind === "messages") {
      for (const m of input.messages) bus.emit("turn:start", { sessionId: this.ctx.sid, text: m.text });
    }

    const seg = this.seg ?? (await this.openSegment());
    if (!seg) return { text: "", aborted: true }; // lease aborted while queued — a clean stop
    if (seg.errored) return { text: "", errored: true, fatal: true }; // opened dead (no model configured)
    if (seg.erased) return { text: seg.finalText }; // an engine tool ended the segment — settle as-is
    if (seg.controller.signal.aborted) return { text: seg.finalText, aborted: true };

    // ONE model step (history + system are rebuilt per step — the model can change mid-session).
    // composeSystem (system.ts) is the ONE owner of the block list — the banner renders the same call.
    const sid = this.ctx.sid;
    const history = toChatMessages(getSession(sid)?.messages ?? [], seg.turnInput);
    const system = composeSystem(getSession(sid), seg.caps);
    setLastSystem(sid, system ?? "");
    // The full outbound tool JSON — the "did the specs reach the wire" question answered per step.
    llmLog.debug("tools→wire", { sessionId: sid, model: seg.callTargetModelId, specs: seg.caps.toolSpecs });

    seg.errored = false;
    seg.errorKind = undefined;
    try {
      const { text, thinking, calls } = await this.app.llm.call({
        service: "main",
        target: seg.callTarget, // the leased pool binding; undefined falls back to the `main` assignment
        messages: history,
        system,
        tools: seg.caps.toolSpecs,
        signal: seg.controller.signal,
        handler: this.chatStepHandler(sid, (kind) => {
          seg.errored = true;
          seg.errorKind = kind;
        }),
      });
      seg.finalText = text;
      seg.finalThinking = thinking;
      if (seg.controller.signal.aborted) return { text, aborted: true };
      if (seg.errored) return { text, errored: true, fatal: seg.errorKind === "capacity" };
      return { text, toolCalls: calls };
    } catch (e) {
      if (seg.controller.signal.aborted) return { text: seg.finalText, aborted: true };
      seg.errored = true;
      seg.errorKind = "other";
      bus.emit("turn:error", { sessionId: sid, message: errorMessage(e), kind: "other" });
      return { text: seg.finalText, errored: true };
    }
  }

  protected override async dispatch(rawCalls: ToolCallReq[]): Promise<ToolResultMsg[]> {
    const seg = this.seg;
    const sid = this.ctx.sid;
    if (!seg) return rawCalls.map((c) => ({ callId: c.id, output: "no live segment" }));
    const maxDim = effectiveImageMaxDim(seg.imageMaxDim);
    // "single" tools run at most ONCE per step — later duplicates are dropped entirely.
    const calls = dropExtraSingleCalls(rawCalls as ToolCallRequest[], (name) => !!seg.caps.filtered[name]?.single);
    bus.emit("tool:calls", { sessionId: sid, calls });
    llmLog.debug("tool:calls", { sessionId: sid, isChild: seg.caps.isChild, calls: calls.map((c) => ({ id: c.id, name: c.name, engine: isEngineTool(c.name), args: c.arguments })) });
    const ec: EngineCtx = { ctx: this.app, sessionId: sid, workspace: seg.caps.ws, signal: seg.controller.signal, isChild: seg.caps.isChild, engine: this.app.sessions };
    const fedImages: Image[] = [];
    const fedVideo: Video[] = [];
    const out: ToolResultMsg[] = [];
    await Promise.all(
      calls.map(async (call) => {
        if (isEngineTool(call.name)) {
          const res = await runEngineTool(call, ec);
          if (res.eraseTurn) {
            seg.erased = true;
            removeToolCall(sid, call.id);
            return;
          }
          const images = await this.downscaleToolImages(res.images, maxDim);
          stampMediaRefs(sid, images, res.videos);
          const output = withMediaRefNote(res.output, images, res.videos);
          bus.emit("tool:result", { sessionId: sid, toolCallId: call.id, output, images, videos: res.videos, childSessionIds: res.childSessionIds, browserWindowId: res.browserWindowId });
          if (images?.length) fedImages.push(...images);
          if (res.videos?.length) fedVideo.push(...res.videos);
          out.push({ callId: call.id, output });
          return;
        }
        const mode = seg.caps.filtered[call.name]?.effectiveMode ?? 0;
        if (mode === 0) {
          const why = !seg.caps.ws
            ? `tool "${call.name}" needs a workspace folder — open one for this session to use it.`
            : `tool "${call.name}" is disabled for this session.`;
          bus.emit("tool:result", { sessionId: sid, toolCallId: call.id, output: why });
          out.push({ callId: call.id, output: why });
          return;
        }
        if (mode === 1 && !(await requestApproval(sid, call))) {
          bus.emit("tool:result", { sessionId: sid, toolCallId: call.id, output: `the user denied the ${call.name} call.` });
          out.push({ callId: call.id, output: "denied" });
          return;
        }
        if (seg.controller.signal.aborted) {
          bus.emit("tool:result", { sessionId: sid, toolCallId: call.id, output: "cancelled by the user." });
          out.push({ callId: call.id, output: "cancelled" });
          return;
        }
        let result: ToolResult;
        const onAbort = (): void => this.app.tools.cancel(call.id);
        seg.controller.signal.addEventListener("abort", onAbort, { once: true });
        try {
          result =
            (await this.app.tools.run({
              id: call.id,
              name: call.name,
              arguments: call.arguments,
              cwd: (seg.caps.ws?.config.root as string | undefined) ?? "",
              imageOutputDir: seg.caps.ws?.config.imageOutputDir as string | undefined,
              mediaRefs: resolveRefs(getSession(sid)?.messages ?? [], extractRefTokens(call.arguments)),
              sessionId: sid,
              meta: getSession(sid)?.meta as Record<string, unknown> | undefined,
            })) ?? { ok: false, output: `tool "${call.name}" is unavailable here.` };
        } catch (e) {
          result = { ok: false, output: `tool execution failed: ${errorMessage(e)}` };
        } finally {
          seg.controller.signal.removeEventListener("abort", onAbort);
        }
        const images = await this.downscaleToolImages(result.images, maxDim);
        const videos = result.videos?.map((g) => ({ ...g }));
        stampMediaRefs(sid, images, videos);
        const output = withMediaRefNote(result.output, images, videos);
        bus.emit("tool:result", { sessionId: sid, toolCallId: call.id, output, images, videos });
        if (images?.length) fedImages.push(...images);
        if (videos?.length) fedVideo.push(...videos);
        out.push({ callId: call.id, output });
      }),
    );
    // Feed back only what the model's declared inputs accept — otherwise the endpoint rejects the turn.
    const feedImages = seg.turnInput.image !== false ? fedImages : [];
    const feedVideo = seg.turnInput.video === true ? fedVideo : [];
    if (feedImages.length || feedVideo.length) {
      bus.emit("mediaFeedback", { sessionId: sid, images: feedImages.length ? feedImages : undefined, videos: feedVideo.length ? feedVideo : undefined });
    }
    bus.emit("assistant:open", { sessionId: sid });
    return out;
  }

  protected override nextUserInput(): Promise<LoopInput> {
    this.closeSegment();
    return new Promise<LoopInput>((resolve) => {
      this.waiter = resolve;
    });
  }

  // A custom output validator (SendOptions.validate) rides ON TOP of the schema contract.
  protected override classifyReply(text: string): Verdict {
    const validate = this.seg?.opts.validate ?? this.pending?.opts.validate;
    if (validate) {
      try {
        validate(text);
      } catch (e) {
        return { ok: false, fault: "invalid", correction: healCorrection(e) };
      }
    }
    return classify(text, this.ctx.contract.schema);
  }

  protected override onState(state: LoopState, round?: number): void {
    bus.emit("runner:state", { sessionId: this.ctx.sid, state, round });
  }

  protected override onSettle(_s: Settlement): void {
    this.closeSegment();
    this.host.detachLoop(this.ctx.sid, this);
  }

  // ── Segment lifecycle (the UI's turn) ───────────────────────────────────────

  private async openSegment(): Promise<Segment | null> {
    const sid = this.ctx.sid;
    const p = this.pending ?? { meta: { firstExchange: false, autoName: false, userText: "" }, opts: {}, resolveTurn: () => {} };
    this.pending = undefined;
    const cfg = resolveMain();
    if (!cfg) {
      bus.emit("turn:error", { sessionId: sid, message: "no chat model is configured — pick a provider and model in Settings.", kind: "other" });
      const seg = this.makeSegment(p, new AbortController());
      seg.errored = true;
      seg.errorKind = "other";
      this.seg = seg;
      return seg; // respond() will step into llm.call and fail? No — flag as errored pre-step:
    }
    const controller = new AbortController();
    this.host.registerInflight(sid, controller);
    const isChild = !!getSession(sid)?.parentId;
    const role = isChild ? "subAgent" : "main";
    const lease = await this.app.runner.acquire(role, sid, getSession(sid)?.meta.usedTokens ?? 0, { signal: controller.signal });
    if (!lease && controller.signal.aborted) {
      this.host.clearInflight(sid);
      bus.emit("message:done", { sessionId: sid, text: "", thinking: "", errored: false, firstExchange: p.meta.firstExchange, autoName: p.meta.autoName, userText: p.meta.userText });
      bus.emit("turn:end", { sessionId: sid, errored: false, aborted: true });
      p.resolveTurn({ text: "", errored: false, aborted: true });
      return null;
    }
    const caps = await capabilitiesFor(this.app, getSession(sid), controller.signal);
    const seg = this.makeSegment(p, controller);
    seg.leased = !!lease;
    seg.callTarget = lease?.config;
    seg.callTargetModelId = lease?.config.model.id ?? cfg.model.id;
    seg.imageMaxDim = cfg.imageMaxDim;
    seg.turnInput = ((lease?.config.input ?? cfg.input) ?? {}) as Record<string, unknown>;
    seg.caps = caps;
    llmLog.debug("turn", { workspace: caps.ws?.name ?? null, tools: caps.toolSpecs.map((t) => t.function.name) });
    this.seg = seg;
    return seg;
  }

  private makeSegment(p: NonNullable<typeof this.pending>, controller: AbortController): Segment {
    return {
      controller,
      meta: p.meta,
      opts: p.opts,
      leased: false,
      turnInput: {},
      caps: { isChild: false, filtered: {}, toolSpecs: [], fsAccess: false, browserAccess: false },
      finalText: "",
      finalThinking: "",
      errored: false,
      erased: false,
      resolveTurn: p.resolveTurn,
    };
  }

  private closeSegment(): void {
    const seg = this.seg;
    if (!seg) {
      // Settled before the first segment opened (e.g. hard abort while queued) — resolve the opener.
      const p = this.pending;
      this.pending = undefined;
      p?.resolveTurn({ text: "", errored: false, aborted: true });
      return;
    }
    this.seg = undefined;
    const sid = this.ctx.sid;
    this.host.clearInflight(sid);
    this.app.runner.release(sid);
    denyApprovalsForSession(sid);
    const aborted = seg.controller.signal.aborted;
    const model = seg.errored ? undefined : seg.callTargetModelId;
    bus.emit("message:done", { sessionId: sid, text: seg.finalText, thinking: seg.finalThinking, errored: seg.errored, firstExchange: seg.meta.firstExchange, autoName: seg.meta.autoName, userText: seg.meta.userText, model });
    bus.emit("turn:end", { sessionId: sid, errored: seg.errored, aborted });
    seg.resolveTurn({ text: seg.finalText, errored: seg.errored, aborted, errorKind: seg.errored ? seg.errorKind : undefined });
  }

  // ── Unit helpers (moved verbatim from the engine) ───────────────────────────

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

  private async downscaleToolImages(images: Image[] | undefined, maxDim: number): Promise<Image[] | undefined> {
    if (!images?.length) return undefined;
    return Promise.all(
      images.map(async (g) => {
        const d = await downscaleImage(g.url, g.mime ?? "", maxDim);
        return { ...g, url: d?.url ?? g.url, mime: d?.mime ?? g.mime };
      }),
    );
  }
}

// ── Pure helpers (shared with the engine's exports) ─────────────────────────

function withMediaRefNote(output: string, images?: Image[], videos?: Video[]): string {
  const labels = [...(images ?? []), ...(videos ?? [])].filter((g) => g.ref).map(refLabel);
  if (!labels.length) return output;
  return `${output}\n[media reference${labels.length > 1 ? "s" : ""}: ${labels.join(", ")} — reuse by alias, e.g. in ImageCompose references]`;
}

export function dropExtraSingleCalls(calls: ToolCallRequest[], isSingle: (name: string) => boolean): ToolCallRequest[] {
  const seen = new Set<string>();
  return calls.filter((c) => {
    if (!isSingle(c.name)) return true;
    if (seen.has(c.name)) return false;
    seen.add(c.name);
    return true;
  });
}
