// Chat domain vocabulary — Session, Message, attachments.

import type { ToolCallRequest } from "../../llm/types.ts";

export type { ToolCallRequest };

export type Role = "user" | "assistant" | "tool";

export type { MediaRef } from "../tools/types.ts";
import type { MediaRef } from "../tools/types.ts";

export interface FileAttachment {
  name: string;
  text: string;
  bytes?: number;
}

export interface Message {
  id: string;
  role: Role;
  text: string;
  thinking?: string;
  images?: MediaRef[];
  video?: MediaRef[];
  files?: FileAttachment[];
  toolCalls?: ToolCallRequest[];
  toolCallId?: string;
  childSessionIds?: string[];
  summary?: boolean;
  hidden?: boolean;
}

export interface Tool {
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
  tools: Tool[];
  messages: Message[];
  usedTokens?: number;
  unread?: boolean;
  bytes?: number;
  loaded?: boolean;
}
