import type { ModelConfig, ToolSpec } from "../../providers/index.ts";
import type { ToolCall } from "../../providers/types.ts";
import { streamModel } from "../../providers/index.ts";
import { dlog } from "../../providers/debug.ts";
import type { FileAttachment, ImageRef } from "../../lib/types.ts";
import { harness } from "../../lib/harness.ts";
import { resolveMediaProvider } from "../../lib/media.ts";
import { requestApproval } from "../approvals.ts";
import { getWorkspace, type Workspace } from "../workspaces.ts";
import { PERMISSIONLESS_TOOLS, type GatedTool, type ToolName, type ToolMode, type ToolResult } from "../tools/shared.ts";
import { RENDERER_TOOLS, RENDERER_TOOL_SCHEMAS } from "../tools/renderer.ts";
import { sessionBus as bus } from "./events.ts";
import { createSession, getActiveId, getSession, getStreamingIds, isFull, toChatMessages } from "./store.ts";
import { MAX_HEAL_ATTEMPTS, healCorrection } from "../heal.ts";

// A validator for the model's final (no-tool) turn. Throws to reject — the
// engine then injects a correction and lets the model retry (see runTurn).
export type Validate = (text: string) => void;

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
export function stopTurn(sid: string): void {
  inflight.get(sid)?.abort();
}

// The tool schemas to advertise. With a workspace, the dispatcher's full set
// filtered to what that workspace enables (mode !== 0). With no workspace, only
// the workspace-optional tools (e.g. GenerateImage) — so a plain session can
// still generate without a folder.
async function advertisedTools(ws: Workspace | undefined): Promise<ToolSpec[]> {
  // Permissionless renderer tools (e.g. GenerateImage) are available everywhere —
  // browser build included.
  const renderer = RENDERER_TOOL_SCHEMAS as ToolSpec[];
  if (!harness) return renderer; // web: only the renderer tools
  // Electron: add the gated tools this workspace enables (they run in main).
  const bridge = await harness.tools.schemas();
  const gated = bridge.filter((s) => {
    const name = s.function.name as ToolName;
    if (PERMISSIONLESS_TOOLS.includes(name)) return false; // handled by the renderer set above
    return ws ? (ws.tools[name as GatedTool] ?? 0) !== 0 : false;
  }) as ToolSpec[];
  return [...renderer, ...gated];
}

// The approval mode for a tool this turn. Permissionless tools always auto-run
// (2). Gated tools use the workspace's per-tool policy, and are unavailable (0)
// with no workspace bound.
function toolMode(ws: Workspace | undefined, name: ToolName): ToolMode {
  if (PERMISSIONLESS_TOOLS.includes(name)) return 2;
  return ws ? (ws.tools[name as GatedTool] ?? 0) : 0;
}

async function runTurn(
  sid: string,
  cfg: ModelConfig,
  userText: string,
  opts: { images?: ImageRef[]; video?: ImageRef[]; files?: FileAttachment[]; autoName?: boolean; validate?: Validate },
): Promise<void> {
  const firstExchange = (getSession(sid)?.messages.length ?? 0) === 0;
  const autoName = opts.autoName !== false;

  // turn:start appends the user + assistant placeholder; then we read history.
  bus.emit("turn:start", { sessionId: sid, text: userText, images: opts.images, video: opts.video, files: opts.files });

  const ws = getWorkspace(getSession(sid)?.workspaceId);
  // ctx for the bridge (main) tool path — present only in Electron. The media
  // provider is read here and handed in; main never reads the renderer store.
  const toolCtx = harness ? { cwd: ws?.root ?? "", media: resolveMediaProvider() ?? undefined } : null;
  // Tools are advertised even without the bridge — the renderer set (e.g.
  // GenerateImage) runs in-renderer, so the browser build has tools too.
  const toolSpecs = await advertisedTools(ws);
  dlog("turn", { workspace: ws?.name ?? null, electron: !!harness, tools: toolSpecs.map((t) => t.function.name) });

  let finalText = "";
  let finalThinking = "";
  let errored = false;
  let healAttempts = 0;

  const controller = new AbortController();
  inflight.set(sid, controller);
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      if (controller.signal.aborted) break;
      const history = toChatMessages(getSession(sid)?.messages ?? []);
      const system = getSession(sid)?.system || ws?.instructions || undefined;
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
              bus.emit("heal", { sessionId: sid, correction: healCorrection(e as Error) });
              continue; // re-stream into the fresh assistant message
            }
            errored = true;
            bus.emit("turn:error", {
              sessionId: sid,
              message: `output validation failed after ${healAttempts} heal attempt(s): ${(e as Error).message}`,
            });
          }
        }
        break;
      }
      // Attach the calls to the assistant message, then run each.
      bus.emit("tool:calls", { sessionId: sid, calls });
      const fedImages: ImageRef[] = []; // tool-produced images to show the vision agent this step
      for (const call of calls) {
        const mode = toolMode(ws, call.name as ToolName);
        if (mode === 0) {
          const why = !ws
            ? `tool "${call.name}" needs a workspace folder — open one for this session to use it.`
            : `tool "${call.name}" is disabled in this workspace.`;
          bus.emit("tool:result", { sessionId: sid, toolCallId: call.id, output: why });
          continue;
        }
        if (mode === 1 && !(await requestApproval(sid, call))) {
          bus.emit("tool:result", { sessionId: sid, toolCallId: call.id, output: `the user denied the ${call.name} call.` });
          continue;
        }
        let result: ToolResult;
        try {
          const name = call.name as ToolName;
          const rendererTool = RENDERER_TOOLS[name];
          if (rendererTool) {
            // Renderer tools are self-contained — run them in-process (web + desktop).
            const args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
            result = await rendererTool.execute(args, { cwd: ws?.root ?? "", media: resolveMediaProvider() ?? undefined });
          } else if (toolCtx) {
            // Gated fs/Bash tools run via the main dispatcher.
            result = await harness!.tools.exec(call, toolCtx);
          } else {
            result = { ok: false, output: `tool "${name}" is unavailable here.` };
          }
        } catch (e) {
          result = { ok: false, output: `tool execution failed: ${(e as Error).message}` };
        }
        const output = result.output;
        // GeneratedImage → ImageRef for display + model feedback.
        const images = result.images?.map((g) => ({ url: g.url, mime: g.mime, name: g.name }));
        // Generated video → display only (not fed back to the model).
        const video = result.video?.map((g) => ({ url: g.url, mime: g.mime, name: g.name }));
        bus.emit("tool:result", { sessionId: sid, toolCallId: call.id, output, images, video });
        if (images?.length) fedImages.push(...images);
      }
      // Feed any generated images back as a hidden user turn so a vision agent
      // can inspect its own output (tool-role images aren't sent to the model —
      // see toChatMessages). Guardrail: only when the model declares image input
      // — otherwise the endpoint would reject the turn. Then open a fresh
      // assistant message and loop.
      if (fedImages.length && cfg.input?.image !== false) {
        bus.emit("imageFeedback", { sessionId: sid, images: fedImages });
      }
      bus.emit("assistant:open", { sessionId: sid });
    }
  } catch (e) {
    // A user Stop aborts the controller → the stream throws here; that's a clean
    // stop, not an error.
    if (!controller.signal.aborted) {
      errored = true;
      bus.emit("turn:error", { sessionId: sid, message: (e as Error).message });
    }
  } finally {
    inflight.delete(sid);
    bus.emit("message:done", { sessionId: sid, text: finalText, thinking: finalThinking, errored, firstExchange, autoName, cfg, userText });
    bus.emit("turn:end", { sessionId: sid, errored });
  }
}

export async function send(
  text: string,
  cfg: ModelConfig,
  opts: { images?: ImageRef[]; video?: ImageRef[]; files?: FileAttachment[]; autoName?: boolean; validate?: Validate } = {},
): Promise<void> {
  const t = text.trim();
  const sid = getActiveId();
  // Per-session guard: only block if THIS session is already streaming. Allow a
  // message with no text as long as there's at least one attachment.
  if ((!t && !opts.images?.length && !opts.video?.length && !opts.files?.length) || getStreamingIds().has(sid) || isFull(cfg)) return;
  await runTurn(sid, cfg, t, opts);
}

// Run a stored agent: spin up a session whose system message IS the agent's
// system MD, then send the user MD (with any attached images/files). No
// auto-naming — the agent's name is the title. Safe to fire while other
// sessions stream.
export function runAgent(
  agent: { name: string; system: string; user: string },
  cfg: ModelConfig,
  opts: { images?: ImageRef[]; video?: ImageRef[]; files?: FileAttachment[]; validate?: Validate } = {},
): void {
  createSession({ title: agent.name, system: agent.system });
  void send(agent.user, cfg, { ...opts, autoName: false });
}
