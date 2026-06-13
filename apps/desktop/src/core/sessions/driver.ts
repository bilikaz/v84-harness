import type { ToolCall, ToolSpec } from "../../llm/types.ts";
import type { MainSettings } from "../settings.ts";
import { healCorrection, type ResponseHandler } from "../../llm/index.ts";
import { llmLog } from "../../llm/debug.ts";
import type { FileAttachment, MediaRef, Session } from "./types.ts";
import { harness } from "../../lib/harness.ts";
import { client, resolveMain, toolConfigSnapshot } from "../client.ts";
import { resolveMediaProvider } from "../media.ts";
import { effectiveImageMaxDim, getAppConfig } from "../config/index.ts";
import { denyApprovalsForSession, requestApproval } from "../approvals.ts";
import { getAgent, type Agent } from "../agents.ts";
import { getActiveWorkspaceId, getWorkspace, type Workspace } from "../workspaces.ts";
import { ALL_TOOLS, PERMISSIONLESS_TOOLS, type GatedTool, type ToolName, type ToolMode, type ToolResult } from "../tools/types.ts";
import { pt } from "../../lib/prompts.ts";
import { cap } from "../tools/shared.ts";
import { RENDERER_TOOLS, RENDERER_TOOL_SCHEMAS } from "../tools/renderer.ts";
import { LIST_AGENTS, RUN_AGENT, agentToolSchemas, listAgentsOutput, resolveAgent } from "./agentTools.ts";
import { sessionBus as bus } from "./events.ts";
import { createSession, ensureLoaded, getActiveId, getSession, getStreamingIds, isFull, toChatMessages } from "./store.ts";
import { errorMessage } from "../../lib/errors.ts";
import { downscaleImage } from "../../lib/imageResize.ts";

// Validator for the model's final (no-tool) turn: throw to reject — the engine injects a correction and retries.
export type Validate = (text: string) => void;

// How a turn ended; `text` is the final answer — partial if aborted.
export interface TurnResult {
  text: string;
  errored: boolean;
  aborted: boolean;
}

export interface SendOptions {
  images?: MediaRef[];
  video?: MediaRef[];
  files?: FileAttachment[];
  autoName?: boolean;
  validate?: Validate;
}

const inflight = new Map<string, AbortController>();

// Also denies the session's queued approvals — an unanswered approval Promise would keep the turn pending forever.
export function stopTurn(sid: string): void {
  inflight.get(sid)?.abort();
  denyApprovalsForSession(sid);
}

// HMR replaces this module (and its inflight map) — abort the old instance's turns so none is orphaned mid-stream.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    inflight.forEach((c) => c.abort());
    inflight.clear();
  });
}

// Capability gate — app-wide input defaults apply: image assumed on unless declared off, video only when declared on.
function allowedByCapability(name: ToolName, cfg: MainSettings): boolean {
  if (name === "LoadImage") return cfg.input?.image !== false;
  if (name === "LoadVideo") return cfg.input?.video === true;
  // Media tools gate on their SERVICE — an unassigned service means withheld, not advertised-then-failing.
  if (name === "DescribeImage") return resolveMediaProvider("imageRec") !== null;
  if (name === "DescribeVideo") return resolveMediaProvider("videoRec") !== null;
  if (name === "GenerateImage") return resolveMediaProvider("imageGen") !== null;
  if (name === "GenerateVideo") return resolveMediaProvider("videoGen") !== null;
  return true;
}

async function advertisedTools(ws: Workspace | undefined, agent: Agent | undefined, cfg: MainSettings, isChild: boolean): Promise<ToolSpec[]> {
  // The sub-agent pair joins top-level sessions only — children never orchestrate further (depth 1).
  const renderer = [
    ...(RENDERER_TOOL_SCHEMAS as ToolSpec[]).filter((s) => allowedByCapability(s.function.name as ToolName, cfg)),
    ...(isChild ? [] : (agentToolSchemas(!!ws) as ToolSpec[])),
  ];
  if (!harness) return renderer; // web: only the renderer-side tools
  const bridge = await harness.tools.schemas();
  const gated = bridge.filter((s) => {
    const name = s.function.name as ToolName;
    if (PERMISSIONLESS_TOOLS.includes(name)) return false; // handled by the renderer set above
    if (!allowedByCapability(name, cfg)) return false;
    return effectiveMode(ws, agent, name) !== 0;
  }) as ToolSpec[];
  return [...renderer, ...gated];
}

// Streams one chat step's events onto the session bus; `onError` flags a terminal stream error (already emitted) so the turn loop stops.
function chatStepHandler(sid: string, onError: () => void): ResponseHandler<{ text: string; thinking: string; calls: ToolCall[] }> {
  return {
    async handle(interaction) {
      if (interaction.kind !== "chat") throw new Error("the chat step expects a chat interaction.");
      let text = "";
      let thinking = "";
      let thinkingDone = false;
      const calls: ToolCall[] = [];
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

// The STRICTER of workspace policy and agent ceiling — an agent can restrict what the workspace grants, never extend it.
function effectiveMode(ws: Workspace | undefined, agent: Agent | undefined, name: ToolName): ToolMode {
  if (PERMISSIONLESS_TOOLS.includes(name)) return 2;
  if (!ws) return 0;
  const wsMode = ws.tools[name as GatedTool] ?? 0;
  const ceiling = agent?.tools[name as GatedTool] ?? 2;
  return Math.min(wsMode, ceiling) as ToolMode;
}

// For a chat-only agent the workspace is masked to undefined — workspaceId is placement, never a tool grant.
function capabilityContext(session: Session | undefined): { ws: Workspace | undefined; agent: Agent | undefined } {
  const agent = session?.agentId ? getAgent(session.agentId) : undefined;
  const ws = agent && !agent.workspace ? undefined : getWorkspace(session?.workspaceId);
  return { ws, agent };
}

// The per-tool modes exactly as the turn loop computes them.
export function sessionToolModes(session: Session): Record<GatedTool, ToolMode> {
  const { ws, agent } = capabilityContext(session);
  return Object.fromEntries(ALL_TOOLS.map((t) => [t, effectiveMode(ws, agent, t)])) as Record<GatedTool, ToolMode>;
}

async function runTurn(sid: string, userText: string, opts: SendOptions): Promise<TurnResult> {
  const firstExchange = (getSession(sid)?.messages.length ?? 0) === 0;
  const autoName = opts.autoName !== false;

  // turn:start must append the user + assistant placeholder BEFORE history is read.
  bus.emit("turn:start", { sessionId: sid, text: userText, images: opts.images, video: opts.video, files: opts.files });

  const cfg = resolveMain();
  if (!cfg) {
    bus.emit("turn:error", { sessionId: sid, message: "no chat model is configured — pick a provider and model in Settings." });
    bus.emit("message:done", { sessionId: sid, text: "", thinking: "", errored: true, firstExchange, autoName, userText });
    bus.emit("turn:end", { sessionId: sid, errored: true });
    return { text: "", errored: true, aborted: false };
  }

  const isChild = !!getSession(sid)?.parentId; // a sub-agent run — never orchestrates further
  const { ws, agent } = capabilityContext(getSession(sid));
  // Tool config snapshot resolved here — only the renderer reads the stores; main mints its own client from it.
  const toolConfig = toolConfigSnapshot();
  const toolCtx = harness ? { cwd: ws?.root ?? "", config: toolConfig } : null;
  const toolSpecs = await advertisedTools(ws, agent, cfg, isChild);
  llmLog.debug("turn", { workspace: ws?.name ?? null, electron: !!harness, tools: toolSpecs.map((t) => t.function.name) });
  // The virtual-root convention (ADR-0007) is invisible otherwise — tell the model only when file tools are actually advertised.
  const fsAccess = toolSpecs.some((t) => (ALL_TOOLS as readonly string[]).includes(t.function.name));

  let finalText = "";
  let finalThinking = "";
  let errored = false;
  let healAttempts = 0;

  const controller = new AbortController();
  inflight.set(sid, controller);
  const maxSteps = getAppConfig().session.maxSteps;
  let step = 0;
  try {
    for (; step < maxSteps; step++) {
      if (controller.signal.aborted) break;
      // History is re-filtered against the CURRENT model's inputs each step — the model can change mid-session, and yesterday's images must not 400 today's text-only endpoint.
      const history = toChatMessages(getSession(sid)?.messages ?? [], cfg.input ?? {});
      const baseSystem = getSession(sid)?.system || ws?.instructions || undefined;
      const system = fsAccess ? [baseSystem, pt("workspace.system")].filter(Boolean).join("\n\n") : baseSystem;

      // Heal stays driver-driven (the correction is a SESSION turn via the store), so the handler never throws HealError.
      const { text, thinking, calls } = await client.call({
        service: "main",
        messages: history,
        system,
        tools: toolSpecs,
        signal: controller.signal,
        handler: chatStepHandler(sid, () => {
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
      const fedImages: MediaRef[] = []; // tool-produced images to show the vision agent this step
      const fedVideo: MediaRef[] = []; // tool-produced video — fed back only when the model takes video input
      await Promise.all(
        calls.map(async (call) => {
          // The sub-agent pair is driver-level (it spawns sessions) — handled before the registry/policy paths.
          if (call.name === LIST_AGENTS || call.name === RUN_AGENT) {
            await execAgentTool(sid, call, ws, controller.signal, isChild);
            return;
          }
          // A model can call a tool it wasn't advertised (hallucinated name) — the capability gate must hold at run time too.
          if (!allowedByCapability(call.name as ToolName, cfg)) {
            bus.emit("tool:result", { sessionId: sid, toolCallId: call.id, output: `tool "${call.name}" is not available for this model.` });
            return;
          }
          const mode = effectiveMode(ws, agent, call.name as ToolName);
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
          try {
            const name = call.name as ToolName;
            const rendererTool = RENDERER_TOOLS[name];
            if (rendererTool) {
              const args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
              result = await rendererTool.execute(args, {
                cwd: ws?.root ?? "",
                config: toolConfig,
                client,
                signal: controller.signal,
              });
            } else if (toolCtx) {
              // The signal can't cross IPC — on abort send tools:cancel so main aborts the call's controller (ADR-0014).
              const onAbort = (): void => void harness!.tools.cancel(call.id);
              controller.signal.addEventListener("abort", onAbort, { once: true });
              try {
                result = await harness!.tools.exec(call, toolCtx);
              } finally {
                controller.signal.removeEventListener("abort", onAbort);
              }
            } else {
              result = { ok: false, output: `tool "${name}" is unavailable here.` };
            }
          } catch (e) {
            result = { ok: false, output: `tool execution failed: ${errorMessage(e)}` };
          }
          const output = result.output;
          // Downscale runs in this renderer hop because canvas lives here, not in main.
          const maxDim = effectiveImageMaxDim(cfg.imageMaxDim);
          const images = result.images
            ? await Promise.all(
                result.images.map(async (g) => {
                  // MediaRef.mime is optional; the resizer treats unknown ("") as "try".
                  const d = await downscaleImage(g.url, g.mime ?? "", maxDim);
                  return { url: d?.url ?? g.url, mime: d?.mime ?? g.mime, name: g.name };
                }),
              )
            : undefined;
          const video = result.video?.map((g) => ({ url: g.url, mime: g.mime, name: g.name }));
          bus.emit("tool:result", { sessionId: sid, toolCallId: call.id, output, images, video });
          if (images?.length) fedImages.push(...images);
          if (video?.length) fedVideo.push(...video);
        }),
      );
      // Feed back only what the model's declared inputs accept — otherwise the endpoint rejects the turn.
      const feedImages = cfg.input?.image !== false ? fedImages : [];
      const feedVideo = cfg.input?.video === true ? fedVideo : [];
      if (feedImages.length || feedVideo.length) {
        bus.emit("mediaFeedback", {
          sessionId: sid,
          images: feedImages.length ? feedImages : undefined,
          video: feedVideo.length ? feedVideo : undefined,
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
    inflight.delete(sid);
    bus.emit("message:done", { sessionId: sid, text: finalText, thinking: finalThinking, errored, firstExchange, autoName, userText });
    bus.emit("turn:end", { sessionId: sid, errored });
  }
  return { text: finalText, errored, aborted: controller.signal.aborted };
}

async function execAgentTool(sid: string, call: ToolCall, ws: Workspace | undefined, signal: AbortSignal, isChild: boolean): Promise<void> {
  const respond = (output: string, childSessionIds?: string[]): void =>
    bus.emit("tool:result", { sessionId: sid, toolCallId: call.id, output, childSessionIds });
  // A model can hallucinate the pair even though children aren't advertised it — depth-1 must hold at run time too.
  if (isChild) return respond(`tool "${call.name}" is not available to sub-agents.`);
  if (call.name === LIST_AGENTS) return respond(listAgentsOutput(!!ws));

  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
  } catch {
    /* keep {} — the shape check below answers with usage */
  }
  // Lenient input: {runs: [...]}, the {agents: [...]} alias, and the flat {agent, task} shape all accepted.
  const raw = Array.isArray(args.runs) ? args.runs : Array.isArray(args.agents) ? args.agents : args.agent ? [args] : [];
  const runs = raw as Record<string, unknown>[];
  if (!runs.length) return respond("RunAgent needs runs: [{agent, task}, …] — one entry per sub-agent run.");

  const children: string[] = [];
  const answers = await Promise.all(
    runs.map(async (run, i) => {
      const label = runs.length > 1 ? `${i + 1}. ` : "";
      const resolved = resolveAgent(String(run.agent ?? ""), !!ws);
      if (typeof resolved === "string") return `${label}${resolved}`;
      const task = String(run.task ?? "").trim();
      if (!task) return `${label}"${resolved.name}": missing task — say what the agent should do, with all the context it needs.`;

      const { sid: childSid, result } = runAgent(resolved, task, {
        parentId: sid,
        // The PARENT SESSION's workspace, not the capability-masked `ws` — children inherit placement, not the mask.
        workspaceId: getSession(sid)?.workspaceId ?? null,
        activate: false,
      });
      children.push(childSid);
      bus.emit("tool:child", { sessionId: sid, toolCallId: call.id, childSessionId: childSid });
      const onAbort = (): void => stopTurn(childSid);
      signal.addEventListener("abort", onAbort, { once: true });
      let outcome: TurnResult | null;
      try {
        outcome = await result;
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
      const name = runs.length > 1 ? `${label}"${resolved.name}": ` : "";
      if (!outcome) return `${name}the run did not start (empty task or a busy session).`;
      if (outcome.aborted) return `${name}the sub-agent run was stopped.`;
      if (outcome.errored) {
        const detail = outcome.text ? `; its last output:\n${cap(outcome.text)}` : " — see its session for the error";
        return `${name}sub-agent "${resolved.name}" failed${detail}`;
      }
      return `${name}${cap(outcome.text) || "(the sub-agent returned no text)"}`;
    }),
  );
  respond(cap(answers.join("\n\n")), children.length ? children : undefined);
}

// Returns null when the send is refused: nothing to send / that session already streaming / context full.
export async function sendTo(sid: string, text: string, opts: SendOptions = {}): Promise<TurnResult | null> {
  const t = text.trim();
  const session = getSession(sid);
  // Empty text is allowed as long as there's at least one attachment.
  if (!session || (!t && !opts.images?.length && !opts.video?.length && !opts.files?.length)) return null;
  // Unconfigured (null cfg) falls through — runTurn answers that with a proper turn error.
  const cfg = resolveMain();
  if (getStreamingIds().has(sid) || (cfg && isFull(cfg, session))) return null;
  // Sessions lazy-load (ADR-0021) — load history before the turn reads it, or the model sees an empty conversation.
  await ensureLoaded(sid);
  return runTurn(sid, t, opts);
}

// Composer-facing send: targets the active session.
export async function send(text: string, opts: SendOptions = {}): Promise<void> {
  await sendTo(getActiveId(), text, opts);
}

// Targets the created session BY ID — the active session can change between create and send.
export function runAgent(
  agent: Agent,
  task: string,
  opts: SendOptions & { parentId?: string; workspaceId?: string | null; activate?: boolean } = {},
): { sid: string; result: Promise<TurnResult | null> } {
  const { parentId, workspaceId, activate, ...sendOpts } = opts;
  const sid = createSession(
    {
      title: agent.name,
      system: agent.system,
      workspaceId: workspaceId !== undefined ? workspaceId : getActiveWorkspaceId(),
      agentId: agent.id,
      parentId,
    },
    { activate },
  );
  return { sid, result: sendTo(sid, task, { ...sendOpts, autoName: false }) };
}
