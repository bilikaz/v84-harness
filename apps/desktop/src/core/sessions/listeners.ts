import { sessionBus as bus } from "./events.ts";
import {
  appendToLast,
  commitMessages,
  getActiveId,
  markLastNeverPersist,
  markUnread,
  notify,
  pushAssistant,
  pushContext,
  pushHeal,
  pushMediaFeedback,
  pushToolResult,
  pushTurn,
  resetLast,
  resumeTail,
  addChildRun,
  setDelivered,
  setErrorKind,
  setLastModel,
  setLastToolCalls,
  setStreaming,
  setUsage,
} from "./store.ts";

// Tear down on HMR so a hot reload doesn't leave OLD handlers registered
// alongside the new ones (the bus registry is a module singleton that survives
// HMR) — that duplication is what doubles every streamed token in dev.
const offs: Array<() => void> = [
  // turn:start lands the user message — commit it at once, so a crash before any response still keeps it.
  bus.on("turn:start", (e) => {
    pushTurn(e.sessionId, e.text, e.images, e.files, e.videos);
    commitMessages(e.sessionId);
  }),
  bus.on("text", (e) => appendToLast(e.sessionId, e.delta, "text")), // streaming — not committed mid-flight
  bus.on("thinking", (e) => appendToLast(e.sessionId, e.delta, "thinking")),
  bus.on("turn:error", (e) => {
    appendToLast(e.sessionId, `⚠️ ${e.message}`, "text");
    setErrorKind(e.sessionId, e.kind ?? "other"); // feeds the roster status + resume guidance
    markLastNeverPersist(e.sessionId); // the ⚠️ tail is not a proper message — never commit it
  }),
  bus.on("turn:resume", (e) => {
    resumeTail(e.sessionId); // drop the errored ⚠️ tail, open a fresh assistant — no new user message
    setDelivered(e.sessionId, false); // a child being resumed owes its parent a fresh result again
    setStreaming(e.sessionId, true);
    notify();
  }),
  bus.on("turn:deliver", (e) => {
    // Fabricate the synthetic getAgentContent exchange: assistant(tool_call) → tool(result) → empty
    // assistant placeholder for the model's continuation. Then stream into that placeholder.
    setErrorKind(e.sessionId, undefined);
    pushAssistant(e.sessionId);
    setLastToolCalls(e.sessionId, [e.call]);
    pushToolResult(e.sessionId, e.call.id, e.output, undefined, undefined, e.childSessionIds);
    pushAssistant(e.sessionId);
    setStreaming(e.sessionId, true);
    commitMessages(e.sessionId); // the real getAgentContent call + result land here — durable now
    notify();
  }),

  bus.on("tool:calls", (e) => setLastToolCalls(e.sessionId, e.calls)), // committed once the exchange completes (tool:result)
  // tool:result completes the exchange (or one call of a multi-call step) — commit the assistant + all
  // its results together (commitMessages holds an exchange until every call has a result, so a crash
  // never leaves a dangling tool_call). An async RunAgent ack lands here too — the spawn is durable now.
  bus.on("tool:result", (e) => {
    pushToolResult(e.sessionId, e.toolCallId, e.output, e.images, e.videos, e.childSessionIds, e.browserWindowId);
    commitMessages(e.sessionId);
  }),
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
    setDelivered(e.sessionId, false); // a child running a fresh turn owes its parent a new result
    setStreaming(e.sessionId, true);
    notify();
  }),
  bus.on("message:done", (e) => {
    if (e.model) setLastModel(e.sessionId, e.model); // committed by the turn:end commitMessages below
  }),
  bus.on("turn:end", (e) => {
    setStreaming(e.sessionId, false);
    if (e.sessionId !== getActiveId()) markUnread(e.sessionId);
    // A clean turn commits its final answer (the trailing message); an errored/aborted turn has no
    // proper final message — flag the partial/⚠️ tail so a later turn's commit never sweeps it.
    if (!e.errored && !e.aborted) commitMessages(e.sessionId);
    else markLastNeverPersist(e.sessionId);
    notify();
  }),
];

if (import.meta.hot) import.meta.hot.dispose(() => offs.forEach((off) => off()));
