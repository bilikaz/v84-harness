// Chat domain vocabulary — Session, Message, attachments.

import type { ToolCallRequest } from "../../llm/types.ts";
export type { ToolCallRequest };

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
  video?: Video[];
  files?: FileAttachment[];
}

export interface Message {
  id: string;
  role: Role;
  text: string;
  thinking?: string;
  images?: Image[];
  video?: Video[];
  files?: FileAttachment[];
  toolCalls?: ToolCallRequest[];
  toolCallId?: string;
  childSessionIds?: string[];
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
  workspaceId?: string | null;
  agentId?: string;
  parentId?: string;
  tools: SessionTool[];
  messages: Message[];
  usedTokens?: number;
  unread?: boolean;
  bytes?: number;
  loaded?: boolean;
}
