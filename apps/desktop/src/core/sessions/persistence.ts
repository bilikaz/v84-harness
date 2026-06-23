// Pure session-meta shapes for the sessions domain — the index shape and the in/out coercions. The durable IO
// (rows, media) lives in the per-entity repos (core/storage/); this stays storage-agnostic.

import type { Message, Session } from "./types.ts";

// Each session is stored as its own row (no master index) — the meta is the row, messages live
// in their own row. The list is enumerated from the meta rows, so nothing can clobber the set.
export type SessionMeta = Omit<Session, "messages" | "loaded">;

export function toMeta(s: Session): SessionMeta {
  const { messages: _messages, loaded: _loaded, ...meta } = s;
  return meta;
}

// Coerce a persisted session row into the current model.
export function normalize(s: Partial<Session> & { messages?: Partial<Message>[] }): Session {
  return {
    id: s.id ?? crypto.randomUUID(),
    title: s.title ?? "",
    system: s.system ?? "",
    containerId: s.containerId ?? "",
    agentId: s.agentId,
    parentId: s.parentId,
    errorKind: s.errorKind,
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
      videos: m.videos,
      files: m.files,
      toolCalls: m.toolCalls,
      toolCallId: m.toolCallId,
      childSessionIds: m.childSessionIds,
      summary: m.summary,
      hidden: m.hidden,
    })),
  };
}
