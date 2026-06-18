import { sessionBus as bus } from "./events.ts";
import {
  appendToLast,
  getActiveId,
  markUnread,
  notify,
  persistSession,
  pushAssistant,
  pushContext,
  pushHeal,
  pushMediaFeedback,
  pushToolResult,
  pushTurn,
  resetLast,
  resumeTail,
  addChildRun,
  setErrorKind,
  setLastToolCalls,
  setStreaming,
  setUsage,
} from "./store.ts";

// Tear down on HMR so a hot reload doesn't leave OLD handlers registered
// alongside the new ones (the bus registry is a module singleton that survives
// HMR) — that duplication is what doubles every streamed token in dev.
const offs: Array<() => void> = [
  bus.on("turn:start", (e) => pushTurn(e.sessionId, e.text, e.images, e.files, e.videos)),
  bus.on("text", (e) => appendToLast(e.sessionId, e.delta, "text")),
  bus.on("thinking", (e) => appendToLast(e.sessionId, e.delta, "thinking")),
  bus.on("turn:error", (e) => {
    appendToLast(e.sessionId, `⚠️ ${e.message}`, "text");
    setErrorKind(e.sessionId, e.kind ?? "other"); // feeds the roster status + resume guidance
  }),
  bus.on("turn:resume", (e) => {
    resumeTail(e.sessionId); // drop the errored ⚠️ tail, open a fresh assistant — no new user message
    setStreaming(e.sessionId, true);
    notify();
  }),

  bus.on("tool:calls", (e) => setLastToolCalls(e.sessionId, e.calls)),
  bus.on("tool:result", (e) => pushToolResult(e.sessionId, e.toolCallId, e.output, e.images, e.videos, e.childSessionIds, e.browserWindowId)),
  bus.on("tool:child", (e) => addChildRun(e.toolCallId, e.childSessionId)),
  bus.on("assistant:open", (e) => pushAssistant(e.sessionId)),
  bus.on("heal", (e) => pushHeal(e.sessionId, e.correction)),
  bus.on("context", (e) => pushContext(e.sessionId, e.text)),
  bus.on("stream:retry", (e) => resetLast(e.sessionId)),
  bus.on("mediaFeedback", (e) => pushMediaFeedback(e.sessionId, e.images, e.videos)),

  // The latest request's input + output IS the current context occupancy (input
  // already includes the whole history), so set, don't add.
  bus.on("usage", (e) => setUsage(e.sessionId, (e.usage.inputTokens ?? 0) + (e.usage.outputTokens ?? 0))),

  bus.on("turn:start", (e) => {
    setErrorKind(e.sessionId, undefined); // a fresh turn clears any prior failure state
    setStreaming(e.sessionId, true);
    notify();
  }),
  bus.on("turn:end", (e) => {
    setStreaming(e.sessionId, false);
    if (e.sessionId !== getActiveId()) markUnread(e.sessionId);
    persistSession(e.sessionId);
    notify();
  }),
];

if (import.meta.hot) import.meta.hot.dispose(() => offs.forEach((off) => off()));
