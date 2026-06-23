import { scope } from "../../lib/bus.ts";
import type { ErrorKind, StreamUsage, ToolCallRequest } from "../../llm/types.ts";
import type { FileAttachment, Image, Video } from "./types.ts";

// The session domain's events, registered on the bus via declaration merging.

export interface TurnStart {
  sessionId: string;
  text: string;
  images?: Image[];
  videos?: Video[];
  files?: FileAttachment[];
}
export interface TextDelta {
  sessionId: string;
  delta: string;
}
export interface ThinkingDelta {
  sessionId: string;
  delta: string;
}
export interface ThinkingDone {
  sessionId: string;
}
export interface UsageReport {
  sessionId: string;
  usage: StreamUsage;
}
export interface TurnError {
  sessionId: string;
  message: string;
  kind?: ErrorKind; // why it failed — drives roster status + resume guidance (default "other" when absent)
}
// Re-open a stalled turn to continue from its existing history — no new user message (see store.resumeTail).
export interface TurnResume {
  sessionId: string;
}
// Synthetic delivery (async sub-agents): fabricate an assistant getAgentContent call + its result into the
// parent's history, then a fresh assistant placeholder, so the model wakes having "received" the result.
export interface TurnDeliver {
  sessionId: string;
  call: ToolCallRequest;
  output: string;
  childSessionIds?: string[];
}
export interface MessageDone {
  sessionId: string;
  text: string;
  thinking: string;
  errored: boolean;
  firstExchange: boolean;
  autoName: boolean;
  userText: string;
}
export interface TurnEnd {
  sessionId: string;
  errored: boolean;
  aborted: boolean; // user-stopped / cascade-aborted — a child's aborted turn is NOT delivered to its parent
}
export interface ToolCalls {
  sessionId: string;
  calls: ToolCallRequest[];
}
// `childSessionIds` are display-only — the model gets the answer text, never session ids.
export interface ToolResultEvent {
  sessionId: string;
  toolCallId: string;
  output: string;
  images?: Image[];
  videos?: Video[];
  childSessionIds?: string[];
  browserWindowId?: string; // a window this call opened/navigated, for the tool-card link
}
// One event per child; a multi-run call emits several with the same toolCallId.
export interface ToolChild {
  sessionId: string;
  toolCallId: string;
  childSessionId: string;
}
export interface MediaFeedback {
  sessionId: string;
  images?: Image[];
  videos?: Video[];
}
export interface AssistantOpen {
  sessionId: string;
}
export interface Heal {
  sessionId: string;
  correction: string;
}
export interface ForwardContext {
  sessionId: string;
  text: string;
}
// The step is being re-sent from scratch — wipe the partial output off the streaming placeholder.
export interface StreamRetry {
  sessionId: string;
  message: string;
}

declare module "../../lib/bus.ts" {
  interface BusEvents {
    "session:turn:start": TurnStart;
    "session:turn:resume": TurnResume;
    "session:turn:deliver": TurnDeliver;
    "session:text": TextDelta;
    "session:thinking": ThinkingDelta;
    "session:thinking:done": ThinkingDone;
    "session:usage": UsageReport;
    "session:turn:error": TurnError;
    "session:message:done": MessageDone;
    "session:turn:end": TurnEnd;
    "session:tool:calls": ToolCalls;
    "session:tool:result": ToolResultEvent;
    "session:tool:child": ToolChild;
    "session:assistant:open": AssistantOpen;
    "session:heal": Heal;
    "session:context": ForwardContext;
    "session:stream:retry": StreamRetry;
    "session:mediaFeedback": MediaFeedback;
  }
}

// Emit/on with sub-events ("turn:start", "text", …); the "session:" prefix is applied for you.
export const sessionBus = scope("session");
