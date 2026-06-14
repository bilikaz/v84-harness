// Pure session-meta shapes for the sessions domain — the index shape and the in/out coercions. The durable IO
// (key shapes, media blobs) lives in the StorageEngine (core/storage/engine.ts); this stays storage-agnostic.

import type { Message, Session } from "./types.ts";

export type SessionMeta = Omit<Session, "messages" | "loaded">;
export interface SessionsIndex {
  activeId: string;
  sessions: SessionMeta[];
}

export function toMeta(s: Session): SessionMeta {
  const { messages: _messages, loaded: _loaded, ...meta } = s;
  return meta;
}

// Coerce a persisted (possibly older-shape) session into the current model, so upgrades don't break existing data.
export function normalize(s: Partial<Session> & { messages?: Partial<Message>[] }): Session {
  return {
    id: s.id ?? crypto.randomUUID(),
    title: s.title ?? "",
    system: s.system ?? "",
    workspaceId: s.workspaceId ?? null,
    agentId: s.agentId,
    parentId: s.parentId,
    tools: Array.isArray(s.tools) ? s.tools : [],
    usedTokens: s.usedTokens,
    unread: s.unread,
    bytes: s.bytes,
    messages: (s.messages ?? []).map((m, i) => ({
      id: m.id ?? `m${i}`,
      role: m.role === "assistant" ? "assistant" : m.role === "tool" ? "tool" : "user",
      text: m.text ?? "",
      thinking: m.thinking,
      images: m.images,
      video: m.video,
      files: m.files,
      toolCalls: m.toolCalls,
      toolCallId: m.toolCallId,
      childSessionIds: m.childSessionIds,
      summary: m.summary,
      hidden: m.hidden,
    })),
  };
}
