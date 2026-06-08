import type { ModelConfig, ToolSpec } from "../../providers/index.ts";
import type { ToolCall } from "../../providers/types.ts";
import { streamModel } from "../../providers/index.ts";
import { dlog } from "../../providers/debug.ts";
import type { FileAttachment, ImageRef } from "../../lib/types.ts";
import { harness } from "../../lib/harness.ts";
import { requestApproval } from "../approvals.ts";
import { getWorkspace, type Workspace } from "../workspaces.ts";
import type { ToolName } from "../tools/shared.ts";
import { sessionBus as bus } from "./events.ts";
import { createSession, getActiveId, getSession, getStreamingIds, isFull, toChatMessages } from "./store.ts";

// The turn loop: drives the model stream and PUBLISHES events; the listeners
// (./listeners.ts) react and update the store. When the session is bound to a
// workspace (and we're in Electron), the model is given the workspace's enabled
// tools and the turn becomes a multi-step loop: stream → run tool calls → feed
// results back → stream again, until the model answers without calling a tool.

const MAX_STEPS = 50; // runaway guard for the tool loop

// The tool schemas to advertise: the dispatcher's full set, filtered to the
// tools this workspace enables (mode !== 0).
async function advertisedTools(ws: Workspace): Promise<ToolSpec[]> {
  if (!harness) return [];
  const schemas = await harness.tools.schemas();
  return schemas.filter((s) => (ws.tools[s.function.name as ToolName] ?? 0) !== 0) as ToolSpec[];
}

async function runTurn(
  sid: string,
  cfg: ModelConfig,
  userText: string,
  opts: { images?: ImageRef[]; files?: FileAttachment[]; autoName?: boolean },
): Promise<void> {
  const firstExchange = (getSession(sid)?.messages.length ?? 0) === 0;
  const autoName = opts.autoName !== false;

  // turn:start appends the user + assistant placeholder; then we read history.
  bus.emit("turn:start", { sessionId: sid, text: userText, images: opts.images, files: opts.files });

  const ws = getWorkspace(getSession(sid)?.workspaceId);
  const toolCtx = ws && ws.root && harness ? { cwd: ws.root } : null;
  const toolSpecs = ws && toolCtx ? await advertisedTools(ws) : [];
  dlog("turn", { workspace: ws?.name ?? null, electron: !!harness, tools: toolSpecs.map((t) => t.function.name) });

  let finalText = "";
  let finalThinking = "";
  let errored = false;

  const controller = new AbortController();
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
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
      if (errored) break;

      // No tool calls (or no tools available) → the model is done.
      if (!calls.length || !toolCtx || !ws) break;

      // Attach the calls to the assistant message, then run each.
      bus.emit("tool:calls", { sessionId: sid, calls });
      for (const call of calls) {
        const mode = ws.tools[call.name as ToolName] ?? 0;
        if (mode === 0) {
          bus.emit("tool:result", { sessionId: sid, toolCallId: call.id, output: `tool "${call.name}" is disabled in this workspace.` });
          continue;
        }
        if (mode === 1 && !(await requestApproval(sid, call))) {
          bus.emit("tool:result", { sessionId: sid, toolCallId: call.id, output: `the user denied the ${call.name} call.` });
          continue;
        }
        let output: string;
        try {
          output = (await harness!.tools.exec(call, toolCtx)).output;
        } catch (e) {
          output = `tool execution failed: ${(e as Error).message}`;
        }
        bus.emit("tool:result", { sessionId: sid, toolCallId: call.id, output });
      }
      // Open a fresh assistant message and loop for the next model turn.
      bus.emit("assistant:open", { sessionId: sid });
    }
  } catch (e) {
    errored = true;
    bus.emit("turn:error", { sessionId: sid, message: (e as Error).message });
  } finally {
    bus.emit("message:done", { sessionId: sid, text: finalText, thinking: finalThinking, errored, firstExchange, autoName, cfg, userText });
    bus.emit("turn:end", { sessionId: sid, errored });
  }
}

export async function send(
  text: string,
  cfg: ModelConfig,
  opts: { images?: ImageRef[]; files?: FileAttachment[]; autoName?: boolean } = {},
): Promise<void> {
  const t = text.trim();
  const sid = getActiveId();
  // Per-session guard: only block if THIS session is already streaming. Allow a
  // message with no text as long as there's at least one image or file.
  if ((!t && !opts.images?.length && !opts.files?.length) || getStreamingIds().has(sid) || isFull(cfg)) return;
  await runTurn(sid, cfg, t, opts);
}

// Run a stored procedure: spin up a session whose system message IS the
// procedure's system MD, then send the user MD. No auto-naming — the
// procedure's name is the title. Safe to fire while other sessions stream.
export function runProcedure(
  proc: { name: string; system: string; user: string },
  cfg: ModelConfig,
): void {
  createSession({ title: proc.name, system: proc.system });
  void send(proc.user, cfg, { autoName: false });
}
