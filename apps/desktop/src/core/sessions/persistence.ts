// Granular durable persistence for the sessions domain — owns the key shapes
// and the IO. Throws on storage failure except media blob writes, which degrade
// per-blob (a quota-dead blob must not lose the text).

import type { Storage } from "../../lib/storage/index.ts";
import { rootLog } from "../../lib/logger/index.ts";
import { errorMessage } from "../../lib/errors.ts";
import type { MediaRef, Message, Session } from "./types.ts";

const log = rootLog.child("session.persistence");

export const INDEX_KEY = "v84-harness:sessions:index";
export const msgsKey = (sid: string): string => `v84-harness:sessions:msgs:${sid}`;
export const mediaPrefix = (sid: string): string => `v84-harness:media:${sid}:`;
const mediaKey = (sid: string, id: string): string => mediaPrefix(sid) + id;
// The stored stand-in for a media URL; the blob lives under its own key.
const MEDIA_REF = "media:";

export type SessionMeta = Omit<Session, "messages" | "loaded">;
export interface SessionsIndex {
  activeId: string;
  sessions: SessionMeta[];
}

export function toMeta(s: Session): SessionMeta {
  const { messages: _messages, loaded: _loaded, ...meta } = s;
  return meta;
}

// Coerce a persisted (possibly older-shape) session into the current model, so
// upgrades don't break existing data.
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

export async function loadIndex(storage: Storage): Promise<SessionsIndex | null> {
  const raw = await storage.get(INDEX_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as SessionsIndex;
  return parsed.sessions?.length ? parsed : null;
}

export async function saveIndex(storage: Storage, index: SessionsIndex): Promise<void> {
  await storage.set(INDEX_KEY, JSON.stringify(index));
}

// Persist one session's messages. Each media ref gets an `id` stamped IN PLACE
// on first persist — the stamp is what marks "blob already written", so refs
// shared between messages get one blob. Returns the approximate persisted
// footprint (messages json + live blobs).
export async function saveMessages(storage: Storage, sid: string, messages: Message[]): Promise<number> {
  const liveIds = new Set<string>();
  let mediaBytes = 0;

  const storeRef = async (ref: MediaRef): Promise<MediaRef> => {
    if (!ref.url.startsWith("data:")) return ref; // http(s) URL — store as-is
    if (!ref.id) {
      const id = crypto.randomUUID();
      try {
        await storage.set(mediaKey(sid, id), ref.url);
        ref.id = id; // stamped only on success, so a failed write retries next persist
      } catch (e) {
        log.warn("media_write_failed", { sid, bytes: ref.url.length, error: errorMessage(e) });
        return ref; // keep the data URL inline as a last resort (may itself fail on quota)
      }
    }
    liveIds.add(ref.id);
    mediaBytes += ref.url.length;
    return { ...ref, url: MEDIA_REF + ref.id };
  };

  const stored: Message[] = [];
  for (const m of messages) {
    const images = m.images && (await Promise.all(m.images.map(storeRef)));
    const video = m.video && (await Promise.all(m.video.map(storeRef)));
    stored.push({ ...m, images, video });
  }

  const json = JSON.stringify(stored);
  await storage.set(msgsKey(sid), json);

  // GC blobs no longer referenced by any stored message of this session.
  const existing = await storage.keys(mediaPrefix(sid));
  await Promise.all(
    existing.filter((k) => !liveIds.has(k.slice(mediaPrefix(sid).length))).map((k) => storage.del(k)),
  );

  return json.length + mediaBytes;
}

// A missing blob (failed write in a past run) degrades to an empty URL — the
// transcript text always survives.
export async function loadMessages(storage: Storage, sid: string): Promise<Message[] | null> {
  const raw = await storage.get(msgsKey(sid));
  if (!raw) return null;
  const messages = (JSON.parse(raw) as Message[]).map((m) => ({ ...m }));

  const inflate = async (ref: MediaRef): Promise<MediaRef> => {
    if (!ref.url.startsWith(MEDIA_REF)) return ref;
    const id = ref.url.slice(MEDIA_REF.length);
    const blob = await storage.get(mediaKey(sid, id));
    if (blob === null) log.warn("media_blob_missing", { sid, id });
    return { ...ref, id, url: blob ?? "" };
  };
  for (const m of messages) {
    if (m.images) m.images = await Promise.all(m.images.map(inflate));
    if (m.video) m.video = await Promise.all(m.video.map(inflate));
  }
  return messages;
}

export async function deleteSessionData(storage: Storage, sid: string): Promise<void> {
  await storage.del(msgsKey(sid));
  const blobs = await storage.keys(mediaPrefix(sid));
  await Promise.all(blobs.map((k) => storage.del(k)));
}
