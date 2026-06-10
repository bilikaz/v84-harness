import { sessionBus as bus } from "./events.ts";
import {
  appendToLast,
  getActiveId,
  markUnread,
  notify,
  persistSession,
  pushAssistant,
  pushHeal,
  pushMediaFeedback,
  pushToolResult,
  pushTurn,
  resetLast,
  addChildRun,
  setLastToolCalls,
  setStreaming,
  setUsage,
} from "./store.ts";

// Services — each subscribes to the event types it cares about and updates the
// store. Imported for its side effects (registration) by ./index.ts. Add a
// behavior = subscribe here; the driver doesn't change.
//
// `bus.on` returns an unsubscribe fn; we collect them and tear down on HMR so a
// hot reload doesn't leave the OLD handlers registered alongside the new ones
// (the bus registry is a module singleton that survives HMR) — that duplication
// is what makes every streamed token / message appear twice in dev.
const offs: Array<() => void> = [
  // Transcript — build the message log from the stream.
  bus.on("turn:start", (e) => pushTurn(e.sessionId, e.text, e.images, e.files, e.video)),
  bus.on("text", (e) => appendToLast(e.sessionId, e.delta, "text")),
  bus.on("thinking", (e) => appendToLast(e.sessionId, e.delta, "thinking")),
  bus.on("turn:error", (e) => appendToLast(e.sessionId, `⚠️ ${e.message}`, "text")),

  // Tool loop — attach the model's tool calls, append each result, then open a
  // fresh assistant message for the next model turn.
  bus.on("tool:calls", (e) => setLastToolCalls(e.sessionId, e.calls)),
  bus.on("tool:result", (e) => pushToolResult(e.sessionId, e.toolCallId, e.output, e.images, e.video, e.childSessionIds)),
  bus.on("tool:child", (e) => addChildRun(e.toolCallId, e.childSessionId)),
  bus.on("assistant:open", (e) => pushAssistant(e.sessionId)),
  bus.on("heal", (e) => pushHeal(e.sessionId, e.correction)),
  bus.on("stream:retry", (e) => resetLast(e.sessionId)),
  bus.on("mediaFeedback", (e) => pushMediaFeedback(e.sessionId, e.images, e.video)),

  // Usage meter — the latest request's input + output IS the current context
  // occupancy (input already includes the whole history), so set, don't add.
  bus.on("usage", (e) => setUsage(e.sessionId, (e.usage.inputTokens ?? 0) + (e.usage.outputTokens ?? 0))),

  // Streaming state + persistence + unread. Persistence happens at COMPLETION
  // only (turn:end, ADR-0020) and writes only the turn's session (ADR-0021) —
  // never at turn:start, never per delta. A crash mid-turn loses just that
  // in-flight turn.
  bus.on("turn:start", (e) => {
    setStreaming(e.sessionId, true);
    notify();
  }),
  bus.on("turn:end", (e) => {
    setStreaming(e.sessionId, false);
    // Finished while the user was looking elsewhere → unread (green dot).
    if (e.sessionId !== getActiveId()) markUnread(e.sessionId);
    persistSession(e.sessionId); // writes THIS session's rows + the index — nothing else
    notify();
  }),
];

if (import.meta.hot) import.meta.hot.dispose(() => offs.forEach((off) => off()));

// Auto-naming is its own self-contained service — see ./naming.ts.
