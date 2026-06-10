// The chat domain vocabulary — Session, Message, attachments — defined by its
// producer (the sessions feature) per conventions/types-placement.md. UI code
// reaches these via the lib/types.ts shim or the sessions barrel.

import type { ToolCall } from "../../providers/types.ts";

export type { ToolCall };

export type StepStatus = "done" | "running" | "queued";
export type Role = "user" | "assistant" | "tool";

export interface Step {
  name: string;
  status: StepStatus;
}

// A media attachment, kind-agnostic (image/video today, audio when it arrives —
// `mime` says what it is). `url` is a `data:` URL (local) or an http(s) URL.
// `id` is stamped the first time the ref is persisted — it keys the media blob
// in the durable tier so the bytes are written once, not on every persist (and
// messages sharing the ref object — e.g. the media-feedback turn — share the blob).
export interface MediaRef {
  url: string;
  mime?: string;
  name?: string;
  id?: string;
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
  images?: MediaRef[]; // image attachments — sent as multimodal parts (user/hidden turns)
  video?: MediaRef[]; // video attachments — sent as video parts when the model declares video input
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
  usedTokens?: number; // context occupancy: latest request's input + output tokens
  unread?: boolean; // finished output not yet opened → green dot
  bytes?: number; // approximate persisted footprint (messages + media) — set on persist/load
  loaded?: boolean; // false until this session's messages are read from the durable tier (lazy)
}
