import type { ModelConfig, ToolSpec } from "../../providers/client.ts";
import type { ToolCall } from "../../providers/types.ts";
import { MAX_HEAL_ATTEMPTS, healCorrection, streamModel } from "../../providers/client.ts";
import { llmLog } from "../../providers/debug.ts";
import type { FileAttachment, MediaRef } from "./types.ts";
import { harness } from "../../lib/harness.ts";
import { resolveMediaProvider } from "../../core/media.ts";
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

// A validator for the model's final (no-tool) turn. Throws to reject — the
// engine then injects a correction and lets the model retry (see runTurn).
export type Validate = (text: string) => void;

// How a turn ended. `text` is the model's final (no-tool) answer — partial if
// aborted. Callers that consume the answer programmatically (the RunAgent tool)
// branch on `errored`/`aborted`; the chat UI ignores the result (the transcript
// is already built by the listeners).
export interface TurnResult {
  text: string;
  errored: boolean;
  aborted: boolean;
}

// Per-turn options shared by every entry point (composer send, agent runs).
export interface SendOptions {
  images?: MediaRef[];
  video?: MediaRef[];
  files?: FileAttachment[];
  autoName?: boolean;
  validate?: Validate;
}

// The turn loop: drives the model stream and PUBLISHES events; the listeners
// (./listeners.ts) react and update the store. When the session is bound to a
// workspace (and we're in Electron), the model is given the workspace's enabled
// tools and the turn becomes a multi-step loop: stream → run tool calls → feed
// results back → stream again, until the model answers without calling a tool.

const MAX_STEPS = 50; // runaway guard for the tool loop

// In-flight turns by session, so the UI can abort a specific chat's run. The
// AbortController's signal is threaded into streamModel; aborting ends the
// stream and stops the tool loop. See stopTurn().
const inflight = new Map<string, AbortController>();

// Stop a session's running turn (the Send button becomes Stop while streaming).
// Also settles (denies) the session's queued approvals — an unanswered approval
// Promise would keep the turn's Promise.all pending forever.
export function stopTurn(sid: string): void {
  inflight.get(sid)?.abort();
  denyApprovalsForSession(sid);
}

// HMR: a hot reload replaces this module (and its inflight map) — abort what
// the old instance was running so no turn is orphaned mid-stream.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    inflight.forEach((c) => c.abort());
    inflight.clear();
  });
}

// The tool schemas to advertise. With a workspace, the dispatcher's full set
// filtered to what that workspace enables (mode !== 0). With no workspace, only
// the workspace-optional tools (e.g. GenerateImage) — so a plain session can
// still generate without a folder.
//
// Capability gate: the Load* tools exist to put media in front of the model, so
// a model that can't take that input never sees the tool at all. Same defaults
// as the rest of the app — image input is assumed unless declared off, video
// input only when declared on (the composer's attach gate, SessionView).
function allowedByCapability(name: ToolName, cfg: ModelConfig): boolean {
  if (name === "LoadImage") return cfg.input?.image !== false;
  if (name === "LoadVideo") return cfg.input?.video === true;
  return true;
}

async function advertisedTools(ws: Workspace | undefined, agent: Agent | undefined, cfg: ModelConfig, isChild: boolean): Promise<ToolSpec[]> {
  // Permissionless renderer tools (e.g. GenerateImage) are available everywhere —
  // browser build included. The sub-agent pair (ListAgents/RunAgent) joins for
  // top-level sessions only (depth 1: children never orchestrate further).
  const renderer = [
    ...(RENDERER_TOOL_SCHEMAS as ToolSpec[]),
    ...(isChild ? [] : (agentToolSchemas(!!ws) as ToolSpec[])),
  ];
  if (!harness) return renderer; // web: only the renderer-side tools
  // Electron: add the gated tools this workspace enables (they run in main).
  const bridge = await harness.tools.schemas();
  const gated = bridge.filter((s) => {
    const name = s.function.name as ToolName;
    if (PERMISSIONLESS_TOOLS.includes(name)) return false; // handled by the renderer set above
    if (!allowedByCapability(name, cfg)) return false;
    return effectiveMode(ws, agent, name) !== 0;
  }) as ToolSpec[];
  return [...renderer, ...gated];
}

// The approval mode for a tool this turn: the STRICTER of the workspace policy
// and the running agent's ceiling (min) — an agent can restrict what the
// workspace grants (a read-only reviewer in a write-enabled workspace), never
// extend it. Permissionless tools always auto-run (2); gated tools are
// unavailable (0) with no workspace bound.
function effectiveMode(ws: Workspace | undefined, agent: Agent | undefined, name: ToolName): ToolMode {
  if (PERMISSIONLESS_TOOLS.includes(name)) return 2;
  if (!ws) return 0;
  const wsMode = ws.tools[name as GatedTool] ?? 0;
  const ceiling = agent?.tools[name as GatedTool] ?? 2;
  return Math.min(wsMode, ceiling) as ToolMode;
}

async function runTurn(sid: string, cfg: ModelConfig, userText: string, opts: SendOptions): Promise<TurnResult> {
  const firstExchange = (getSession(sid)?.messages.length ?? 0) === 0;
  const autoName = opts.autoName !== false;

  // turn:start appends the user + assistant placeholder; then we read history.
  bus.emit("turn:start", { sessionId: sid, text: userText, images: opts.images, video: opts.video, files: opts.files });

  const ws = getWorkspace(getSession(sid)?.workspaceId);
  const isChild = !!getSession(sid)?.parentId; // a sub-agent run — never orchestrates further
  // The agent this session runs (if any) — its tool ceiling applies to every
  // step of the turn, advertising and execution alike. Looked up live, so
  // editing an agent's permissions affects the next step, and a deleted agent
  // degrades to the plain workspace policy.
  const agent = getSession(sid)?.agentId ? getAgent(getSession(sid)!.agentId!) : undefined;
  // ctx for the bridge (main) tool path — present only in Electron. The media
  // provider is read here and handed in; main never reads the renderer store.
  const toolCtx = harness ? { cwd: ws?.root ?? "", media: resolveMediaProvider() ?? undefined } : null;
  // Tools are advertised even without the bridge — the renderer set (e.g.
  // GenerateImage) runs in-renderer, so the browser build has tools too.
  const toolSpecs = await advertisedTools(ws, agent, cfg, isChild);
  llmLog.debug("turn", { workspace: ws?.name ?? null, electron: !!harness, tools: toolSpecs.map((t) => t.function.name) });
  // Sessions with file tools are TOLD about them: the virtual root convention
  // (/ = the workspace folder, ADR-0007) is invisible to the model otherwise —
  // it would guess host paths. Appended only when gated tools are actually
  // advertised, so a web/chat session never hears about folders it can't touch.
  const fsAccess = toolSpecs.some((t) => (ALL_TOOLS as readonly string[]).includes(t.function.name));

  let finalText = "";
  let finalThinking = "";
  let errored = false;
  let healAttempts = 0;

  const controller = new AbortController();
  inflight.set(sid, controller);
  let step = 0;
  try {
    for (; step < MAX_STEPS; step++) {
      if (controller.signal.aborted) break;
      const history = toChatMessages(getSession(sid)?.messages ?? []);
      const baseSystem = getSession(sid)?.system || ws?.instructions || undefined;
      const system = fsAccess ? [baseSystem, pt("workspace.system")].filter(Boolean).join("\n\n") : baseSystem;
      let text = "";
      let thinking = "";
      let thinkingDone = false;
      const calls: ToolCall[] = [];

      for await (const evt of streamModel(cfg, history, controller.signal, system, toolSpecs.length ? toolSpecs : undefined)) {
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
          // Transport died mid-step and the router is re-sending — discard the
          // attempt's partial output here and in the store.
          text = "";
          thinking = "";
          thinkingDone = false;
          calls.length = 0;
          bus.emit("stream:retry", { sessionId: sid, message: evt.message });
        } else if (evt.type === "usage") {
          bus.emit("usage", { sessionId: sid, usage: evt.usage });
        } else if (evt.type === "error") {
          errored = true;
          bus.emit("turn:error", { sessionId: sid, message: evt.message });
          break;
        }
      }
      if (thinking && !thinkingDone) bus.emit("thinking:done", { sessionId: sid });
      finalText = text;
      finalThinking = thinking;
      if (errored || controller.signal.aborted) break;

      // No tool calls → the model is done. If the caller gave a validator, heal:
      // on a rejected final turn, inject a hidden correction and re-stream, up to
      // MAX_HEAL_ATTEMPTS. When the budget is spent, surface the error like the
      // task-builder loop throws — never accept best-effort output.
      if (!calls.length) {
        if (opts.validate) {
          try {
            opts.validate(text);
          } catch (e) {
            if (healAttempts < MAX_HEAL_ATTEMPTS) {
              healAttempts += 1;
              bus.emit("heal", { sessionId: sid, correction: healCorrection(e) });
              continue; // re-stream into the fresh assistant message
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
      // Attach the calls to the assistant message, then run them all
      // concurrently — results link back via toolCallId, so completion order
      // doesn't matter. Approval-gated calls each queue a prompt; the modal
      // shows them one at a time while the auto-approved calls keep running.
      bus.emit("tool:calls", { sessionId: sid, calls });
      const fedImages: MediaRef[] = []; // tool-produced images to show the vision agent this step
      const fedVideo: MediaRef[] = []; // tool-produced video — fed back only when the model takes video input
      await Promise.all(
        calls.map(async (call) => {
          // The sub-agent pair is driver-level (it spawns sessions, not fs
          // work) — handled before the registry/policy paths. Parallel calls
          // in one step = parallel child runs, via this very Promise.all.
          if (call.name === LIST_AGENTS || call.name === RUN_AGENT) {
            await execAgentTool(sid, call, ws, cfg, controller.signal, isChild);
            return;
          }
          // A model can call a tool it wasn't advertised (hallucinated name from
          // training) — the capability gate must hold at run time too, or the
          // loaded media would silently never reach it.
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
              // Renderer tools are self-contained — run them in-process (web +
              // desktop) and take the turn's signal directly.
              const args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
              result = await rendererTool.execute(args, {
                cwd: ws?.root ?? "",
                media: resolveMediaProvider() ?? undefined,
                signal: controller.signal,
              });
            } else if (toolCtx) {
              // Gated fs/Bash tools run via the main dispatcher. The signal
              // can't cross IPC — on abort we send tools:cancel and main aborts
              // the controller it minted for this call id (ADR-0014).
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
          // Tool media → MediaRef for display + model feedback.
          const images = result.images?.map((g) => ({ url: g.url, mime: g.mime, name: g.name }));
          const video = result.video?.map((g) => ({ url: g.url, mime: g.mime, name: g.name }));
          bus.emit("tool:result", { sessionId: sid, toolCallId: call.id, output, images, video });
          if (images?.length) fedImages.push(...images);
          if (video?.length) fedVideo.push(...video);
        }),
      );
      // Feed tool-produced media back as a hidden user turn so a vision agent
      // can inspect it (tool-role media isn't sent to the model — see
      // toChatMessages). Guardrail: only what the model's declared inputs accept
      // — otherwise the endpoint would reject the turn. Then open a fresh
      // assistant message and loop.
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
    // Fell off the end of the loop: the step budget is spent. Say so — silent
    // truncation reads as a finished answer when the agent never concluded.
    if (step >= MAX_STEPS && !errored && !controller.signal.aborted) {
      errored = true;
      bus.emit("turn:error", {
        sessionId: sid,
        message: `tool loop stopped after ${MAX_STEPS} steps without a final answer — the task may be looping or too complex for one turn.`,
      });
    }
  } catch (e) {
    // A user Stop aborts the controller → the stream throws here; that's a clean
    // stop, not an error.
    if (!controller.signal.aborted) {
      errored = true;
      bus.emit("turn:error", { sessionId: sid, message: errorMessage(e) });
    }
  } finally {
    inflight.delete(sid);
    bus.emit("message:done", { sessionId: sid, text: finalText, thinking: finalThinking, errored, firstExchange, autoName, cfg, userText });
    bus.emit("turn:end", { sessionId: sid, errored });
  }
  return { text: finalText, errored, aborted: controller.signal.aborted };
}

// Execute the sub-agent tool pair for one call. RunAgent takes an ARRAY of
// runs and starts them all concurrently — one tool call IS the fan-out, so
// parallelism never depends on the model emitting several calls per response
// (most don't). Each run spawns a child SESSION (parentId stamped, never
// activated — it must not steal focus from the parent chat) and publishes its
// link immediately (tool:child — the ToolCard's door into the live run); the
// combined answers come back as the tool output, per-run errors inline
// (per-item catch, batches never fail wholesale). Stop cascades: aborting the
// parent stops every child it spawned (and stopTurn denies the children's
// queued approvals). Mirrors the tool contract — never throws.
async function execAgentTool(
  sid: string,
  call: ToolCall,
  ws: Workspace | undefined,
  cfg: ModelConfig,
  signal: AbortSignal,
  isChild: boolean,
): Promise<void> {
  const respond = (output: string, childSessionIds?: string[]): void =>
    bus.emit("tool:result", { sessionId: sid, toolCallId: call.id, output, childSessionIds });
  // Children aren't advertised the pair, but a model can still hallucinate it —
  // the depth-1 rule must hold at run time too.
  if (isChild) return respond(`tool "${call.name}" is not available to sub-agents.`);
  if (call.name === LIST_AGENTS) return respond(listAgentsOutput(!!ws));

  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
  } catch {
    /* keep {} — the shape check below answers with usage */
  }
  // Lenient input: the documented {runs: [...]} — but the previous param name
  // (agents) and the flat {agent, task} shape still work instead of erroring.
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

      const { sid: childSid, result } = runAgent(resolved, task, cfg, {
        parentId: sid,
        workspaceId: ws?.id ?? null,
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

// Run a turn in a NAMED session and resolve with its outcome. The shared entry
// point under every caller: the composer (via send), manual agent runs, and the
// RunAgent tool awaiting a sub-agent's answer. Returns null when the send is
// refused (nothing to send / that session already streaming / context full).
export async function sendTo(sid: string, text: string, cfg: ModelConfig, opts: SendOptions = {}): Promise<TurnResult | null> {
  const t = text.trim();
  const session = getSession(sid);
  // Per-session guard: only block if THIS session is already streaming. Allow a
  // message with no text as long as there's at least one attachment.
  if (!session || (!t && !opts.images?.length && !opts.video?.length && !opts.files?.length)) return null;
  if (getStreamingIds().has(sid) || isFull(cfg, session)) return null;
  // Sessions lazy-load (ADR-0021) — make sure the history is in memory before
  // the turn reads it, or the model would see an empty conversation.
  await ensureLoaded(sid);
  return runTurn(sid, cfg, t, opts);
}

// Composer-facing send: targets the active session.
export async function send(text: string, cfg: ModelConfig, opts: SendOptions = {}): Promise<void> {
  await sendTo(getActiveId(), text, cfg, opts);
}

// Run a stored agent in a fresh session: the agent's system MD is the system
// message, `task` the user message (the saved template for manual runs, the
// orchestrator's text for sub-agent runs). A workspace agent binds to the given
// workspace (manual runs pass the active one); a chat agent ALWAYS runs unbound
// — the toggle is a capability boundary, file tools never leak in by launch
// context. No auto-naming — the agent's name is the title. Targets the created
// session BY ID — the active session can change between create and send.
export function runAgent(
  agent: Agent,
  task: string,
  cfg: ModelConfig,
  opts: SendOptions & { parentId?: string; workspaceId?: string | null; activate?: boolean } = {},
): { sid: string; result: Promise<TurnResult | null> } {
  const { parentId, workspaceId, activate, ...sendOpts } = opts;
  const sid = createSession(
    {
      title: agent.name,
      system: agent.system,
      workspaceId: agent.workspace ? (workspaceId ?? getActiveWorkspaceId()) : null,
      agentId: agent.id,
      parentId,
    },
    { activate },
  );
  return { sid, result: sendTo(sid, task, cfg, { ...sendOpts, autoName: false }) };
}
