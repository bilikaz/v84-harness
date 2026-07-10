// Chat domain vocabulary — Session, Message, attachments.

import type { ErrorKind, ToolCallRequest } from "../../llm/types.ts";
export type { ToolCallRequest, ErrorKind };

export type { Image, Video } from "../../llm/types.ts";
import type { Image, Video } from "../../llm/types.ts";

export type Role = "user" | "assistant" | "tool";

export interface FileAttachment {
  name: string;
  text: string;
  bytes?: number;
}

// A turn's attachment bundle — what the composer collects and the engine sends.
export interface Attachments {
  images?: Image[];
  videos?: Video[];
  files?: FileAttachment[];
}

export interface Message {
  id: string;
  role: Role;
  text: string;
  thinking?: string;
  images?: Image[];
  videos?: Video[];
  files?: FileAttachment[];
  toolCalls?: ToolCallRequest[];
  toolCallId?: string;
  childSessionIds?: string[];
  browserWindowId?: string; // a browser window a Browser call opened/navigated — tool-card link target
  summary?: boolean;
  hidden?: boolean;
  createdAt?: number; // epoch ms at creation (optional — pre-existing messages lack it)
}

export interface SessionTool {
  id: string;
  name: string;
  enabled: boolean;
}

// A session's per-turn CHURNING state — grouped under `session.meta`, the ONE shape stored both locally
// (in the session JSON blob) and remotely (the `meta_data` JSON column). Kept separate from the identity
// columns (container/parent/agent/graph/title/system/tools) that place a session and rarely change, so
// storage never has to remap between local and remote. Add new runtime flags here, never flat on Session.
export interface SessionRuntime {
  // Why the last turn failed, if it did — drives the roster status and the resume guidance (capacity =
  // out-of-memory, not resumable). Cleared when a new turn starts or one succeeds.
  errorKind?: ErrorKind;
  // Wire id of the model that served the latest turn — the runner can lease a different pool model each
  // turn, so this (not the configured head) is what the composer labels as the chat's model.
  lastModel?: string;
  usedTokens?: number;
  unread?: boolean;
  bytes?: number;
  // Sub-agent delivery watermark (children only): false while a turn's result is owed to the parent, true
  // once delivered into the parent's transcript. Durable so a boot can re-deliver the settled-but-
  // undelivered and resume the unfinished. Reset when the child starts a fresh turn.
  delivered?: boolean;
  // Media alias counter ("img-N"/"vid-N") — next number to hand out. Never recomputed from the
  // transcript: renumbering would break references the model (or user) already holds.
  mediaSeq?: number;
  // Graph-run MILESTONE (graph sessions only): the last node boundary the run settled at, written at the
  // same settle cadence as messages. A relaunch (RunState is memory-only) revives the run parked here via
  // `continue`; `dialogSurface` re-binds a live interview sub chat instead of orphaning it. Single-track
  // runs only — a fan-out stage clears it (fan-out revival needs the arrivals store too; nothing fans out
  // yet). Cleared when the run ends.
  graphRun?: { node: string; head: string; input?: unknown; dialogSurface?: string };
  // Persisted WAIT records (loop/records.ts) — "A settled (data stored), B and C still running".
  // On load, settled children replay from here and pending ones re-arm settlement listeners.
  waits?: { id: string; sessionId: string; children: Record<string, { settled: boolean; ok?: boolean; data?: string }> }[];
  // EXTENSION keys live flat next to the core ones: the flow that configures a session patches in
  // whatever its tools (or anything else) need (e.g. comics' `generationJob`), the whole meta is
  // stamped onto every tool call at dispatch (tools run across the bridge and can't reach the store),
  // and each consumer looks for the key it recognizes. Core carries these blindly and never reads
  // them; owners must not collide with the core keys above.
  [ext: string]: unknown;
}

export interface Session {
  id: string;
  title: string;
  system: string;
  containerId: string; // the container (chat/local/remote) this session lives in — never null
  agentId?: string;
  // Stamps a graph run: turns are produced by the owning graph (GraphEngine), not the model — the seam
  // in drive() branches on this. Symmetric to agentId. See core/graph/.
  graphId?: string;
  parentId?: string;
  tools: SessionTool[];
  messages: Message[];
  // Per-turn runtime state (see SessionRuntime) — always present (defaults to {}).
  meta: SessionRuntime;
  loaded?: boolean;
}
