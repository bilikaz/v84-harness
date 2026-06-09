// Harness domain model. Lives here for now; as each section lands (sessions,
// tools, runner) these types move to that section's module. No seed/mock data —
// the store starts from persistence or a single fresh session.

import type { ToolCall } from "../providers/types.ts";

export type { ToolCall };

export type StepStatus = "done" | "running" | "queued";
export type Role = "user" | "assistant" | "tool";

export interface Step {
  name: string;
  status: StepStatus;
}

// An attached image. `url` is a `data:` URL (local attachment) or an http(s) URL.
export interface ImageRef {
  url: string;
  mime?: string;
  name?: string;
}

// A non-image file attached to a user message. Its `text` is read at attach
// time and folded into the content the model sees (see toChatMessages); the
// bubble just shows a chip with the name.
export interface FileAttachment {
  name: string;
  text: string;
  bytes?: number; // original size (text may be truncated)
}

export interface Message {
  id: string;
  role: Role;
  text: string; // raw content — the answer, or a tool result (file/page content)
  thinking?: string; // reasoning stream (assistant); not resubmitted
  images?: ImageRef[]; // image attachments (user) — sent as multimodal parts
  files?: FileAttachment[]; // non-image attachments (user) — folded into content
  toolCalls?: ToolCall[]; // assistant: tools the model asked to call
  toolCallId?: string; // tool: which call this result answers
  summary?: boolean; // a compaction summary — hidden in the UI, resent to the model as a user message
  hidden?: boolean; // injected by the engine (e.g. a heal correction) — sent to the model, skipped in the UI
}

// A tool available to a session. Execution is a later feature — this is just
// the structure the session carries (which tools are enabled).
export interface Tool {
  id: string;
  name: string;
  enabled: boolean;
}

export interface Session {
  id: string;
  title: string;
  system: string; // system message for the whole session
  workspaceId?: string | null; // the workspace this session works in (null = pure chat, no tools/folder)
  tools: Tool[]; // tools enabled for this session
  messages: Message[]; // the conversation, resubmitted each turn
  steps: Step[]; // progress DAG (rendered in the right panel)
  // running totals / flags
  usedTokens?: number; // cumulative input + output tokens
  unread?: boolean; // finished output not yet opened → green dot
}
