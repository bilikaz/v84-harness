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

export interface Session {
  id: string;
  title: string;
  system: string;
  containerId: string; // the container (chat/local/remote) this session lives in — never null
  agentId?: string;
  parentId?: string;
  // Why this session's last turn failed, if it did — drives the roster status and the resume guidance
  // (capacity = out-of-memory, not resumable). Cleared when a new turn starts or one succeeds.
  errorKind?: ErrorKind;
  tools: SessionTool[];
  messages: Message[];
  usedTokens?: number;
  unread?: boolean;
  bytes?: number;
  loaded?: boolean;
}
