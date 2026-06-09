import { sessionBus as bus } from "./events.ts";
import {
  addUsage,
  appendToLast,
  getActiveId,
  markUnread,
  notify,
  persist,
  pushAssistant,
  pushHeal,
  pushImageFeedback,
  pushToolResult,
  pushTurn,
  setLastToolCalls,
  setStreaming,
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
  bus.on("tool:result", (e) => pushToolResult(e.sessionId, e.toolCallId, e.output, e.images, e.video)),
  bus.on("assistant:open", (e) => pushAssistant(e.sessionId)),
  bus.on("heal", (e) => pushHeal(e.sessionId, e.correction)),
  bus.on("imageFeedback", (e) => pushImageFeedback(e.sessionId, e.images)),

  // Usage meter — count input + output (normalized to include thinking).
  bus.on("usage", (e) => addUsage(e.sessionId, (e.usage.inputTokens ?? 0) + (e.usage.outputTokens ?? 0))),

  // Streaming state + persistence + unread.
  bus.on("turn:start", (e) => {
    setStreaming(e.sessionId, true);
    persist();
    notify();
  }),
  bus.on("turn:end", (e) => {
    setStreaming(e.sessionId, false);
    // Finished while the user was looking elsewhere → unread (green dot).
    if (e.sessionId !== getActiveId()) markUnread(e.sessionId);
    persist();
    notify();
  }),
];

if (import.meta.hot) import.meta.hot.dispose(() => offs.forEach((off) => off()));

// Auto-naming is its own self-contained service — see ./naming.ts.
