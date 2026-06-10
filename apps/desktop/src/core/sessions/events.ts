import { scope } from "../../lib/bus.ts";
import type { ModelConfig, StreamUsage, ToolCall } from "../../providers/types.ts";
import type { FileAttachment, ImageRef } from "./types.ts";

// The session domain's events. Each "session:<sub>" key has a defined payload
// type — "what is sent for what event". Registered on the bus via declaration
// merging, so bus.emit/on are type-checked against these everywhere. When other
// domains arrive (api, tools, sync) they add their own *:events.ts the same way.

export interface TurnStart {
  sessionId: string;
  text: string;
  images?: ImageRef[];
  video?: ImageRef[];
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
}
export interface MessageDone {
  sessionId: string;
  text: string;
  thinking: string;
  errored: boolean;
  firstExchange: boolean;
  autoName: boolean;
  cfg: ModelConfig;
  userText: string;
}
export interface TurnEnd {
  sessionId: string;
  errored: boolean;
}
// The model asked to call tools → attach them to the current assistant message.
export interface ToolCalls {
  sessionId: string;
  calls: ToolCall[];
}
// A tool returned → append a tool-result message answering that call. `images`
// are media the tool produced (e.g. GenerateImage) — shown in its tool card.
export interface ToolResultEvt {
  sessionId: string;
  toolCallId: string;
  output: string;
  images?: ImageRef[];
  video?: ImageRef[];
}
// Tool-produced media (generated or loaded) fed back as a hidden user turn so
// a vision agent can inspect it. The driver only includes what the model's
// declared input capabilities accept.
export interface MediaFeedback {
  sessionId: string;
  images?: ImageRef[];
  video?: ImageRef[];
}
// Open a fresh assistant message for the next model turn in the loop.
export interface AssistantOpen {
  sessionId: string;
}
// A validation heal fired → inject a hidden correction turn and let the model
// retry into a fresh assistant message.
export interface Heal {
  sessionId: string;
  correction: string;
}
// Transport retry fired mid-step (providers/transport.ts) → the step is being
// re-sent from scratch, so wipe the partial output off the streaming assistant
// placeholder.
export interface StreamRetry {
  sessionId: string;
  message: string;
}

declare module "../../lib/bus.ts" {
  interface BusEvents {
    "session:turn:start": TurnStart;
    "session:text": TextDelta;
    "session:thinking": ThinkingDelta;
    "session:thinking:done": ThinkingDone;
    "session:usage": UsageReport;
    "session:turn:error": TurnError;
    "session:message:done": MessageDone;
    "session:turn:end": TurnEnd;
    "session:tool:calls": ToolCalls;
    "session:tool:result": ToolResultEvt;
    "session:assistant:open": AssistantOpen;
    "session:heal": Heal;
    "session:stream:retry": StreamRetry;
    "session:mediaFeedback": MediaFeedback;
  }
}

// The session-scoped bus: emit/on with sub-events ("turn:start", "text", …);
// the "session:" prefix is applied for you. The driver and listeners use this.
export const sessionBus = scope("session");
