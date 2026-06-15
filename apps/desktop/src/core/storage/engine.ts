// The storage engine carried on ctx.storage — the app's one persistence provider.
// Generic kv (get/set/del/keys + JSON helpers) over a SWAPPABLE backend: a local
// baseline that's always present, with a remote backend toggled on by login
// (connect) and off by logout (disconnect). Consumers (sessions, agents,
// workspaces, services) read/write through this; on a connection change the host
// re-hydrates them — no reload.
//
// NOTE: the session-specific helpers at the bottom are a temporary tenant; they
// move into the sessions consumer next (the engine stays domain-agnostic).
import type { Storage } from "./types.ts";
import type { Image, Video, Message } from "../sessions/types.ts";
import type { SessionsIndex } from "../sessions/persistence.ts";
import { rootLog } from "../../lib/logger/index.ts";
import { errorMessage } from "../../lib/errors.ts";

const log = rootLog.child("storage.engine");

const INDEX_KEY = "v84-harness:sessions:index";
const msgsKey = (sid: string): string => `v84-harness:sessions:msgs:${sid}`;
const mediaPrefix = (sid: string): string => `v84-harness:media:${sid}:`;
const mediaKey = (sid: string, id: string): string => mediaPrefix(sid) + id;
// The stored stand-in for a media URL; the blob lives under its own key.
const MEDIA_REF = "media:";

export class StorageEngine {
  private readonly local: Storage;
  private remote: Storage | null;

  constructor(local: Storage, remote: Storage | null = null) {
    this.local = local;
    this.remote = remote;
  }

  // The active backend: remote when connected, else the local baseline.
  private get backend(): Storage {
    return this.remote ?? this.local;
  }

  get name(): string {
    return this.backend.name;
  }

  get connected(): boolean {
    return this.remote !== null;
  }

  // login/logout flip the backend here; the host then re-hydrates consumers.
  connect(remote: Storage): void {
    this.remote = remote;
  }
  disconnect(): void {
    this.remote = null;
  }

  // ── Generic kv — what consumers use ──────────────────────────────────────
  get(key: string): Promise<string | null> {
    return this.backend.get(key);
  }
  set(key: string, value: string): Promise<void> {
    return this.backend.set(key, value);
  }
  del(key: string): Promise<void> {
    return this.backend.del(key);
  }
  keys(prefix: string): Promise<string[]> {
    return this.backend.keys(prefix);
  }
  async getJSON<T>(key: string): Promise<T | null> {
    const raw = await this.backend.get(key);
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
  setJSON<T>(key: string, value: T): Promise<void> {
    return this.backend.set(key, JSON.stringify(value));
  }

  // ── Sessions (temporary tenant — moving into the sessions consumer) ───────
  async loadIndex(): Promise<SessionsIndex | null> {
    const raw = await this.backend.get(INDEX_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionsIndex;
    return parsed.sessions?.length ? parsed : null;
  }

  async saveIndex(index: SessionsIndex): Promise<void> {
    await this.backend.set(INDEX_KEY, JSON.stringify(index));
  }

  async saveMessages(sid: string, messages: Message[]): Promise<number> {
    const liveIds = new Set<string>();
    let mediaBytes = 0;

    const storeRef = async <T extends Image | Video>(ref: T): Promise<T> => {
      if (!ref.url.startsWith("data:")) return ref; // http(s) URL — store as-is
      if (!ref.id) {
        const id = crypto.randomUUID();
        try {
          await this.backend.set(mediaKey(sid, id), ref.url);
          ref.id = id; // stamped only on success, so a failed write retries next persist
        } catch (e) {
          log.warn("media_write_failed", { sid, bytes: ref.url.length, error: errorMessage(e) });
          return ref; // keep the data URL inline as a last resort (may itself fail on quota)
        }
      }
      liveIds.add(ref.id);
      mediaBytes += ref.url.length;
      return { ...ref, url: MEDIA_REF + ref.id } as T;
    };

    const stored: Message[] = [];
    for (const m of messages) {
      const images = m.images && (await Promise.all(m.images.map(storeRef)));
      const video = m.video && (await Promise.all(m.video.map(storeRef)));
      stored.push({ ...m, images, video });
    }

    const json = JSON.stringify(stored);
    await this.backend.set(msgsKey(sid), json);

    // GC blobs no longer referenced by any stored message of this session.
    const existing = await this.backend.keys(mediaPrefix(sid));
    await Promise.all(
      existing.filter((k) => !liveIds.has(k.slice(mediaPrefix(sid).length))).map((k) => this.backend.del(k)),
    );

    return json.length + mediaBytes;
  }

  async loadMessages(sid: string): Promise<Message[] | null> {
    const raw = await this.backend.get(msgsKey(sid));
    if (!raw) return null;
    const messages = (JSON.parse(raw) as Message[]).map((m) => ({ ...m }));

    const inflate = async <T extends Image | Video>(ref: T): Promise<T> => {
      if (!ref.url.startsWith(MEDIA_REF)) return ref;
      const id = ref.url.slice(MEDIA_REF.length);
      const blob = await this.backend.get(mediaKey(sid, id));
      if (blob === null) log.warn("media_blob_missing", { sid, id });
      return { ...ref, id, url: blob ?? "" } as T;
    };
    for (const m of messages) {
      if (m.images) m.images = await Promise.all(m.images.map(inflate));
      if (m.video) m.video = await Promise.all(m.video.map(inflate));
    }
    return messages;
  }

  async deleteSessionData(sid: string): Promise<void> {
    await this.backend.del(msgsKey(sid));
    const blobs = await this.backend.keys(mediaPrefix(sid));
    await Promise.all(blobs.map((k) => this.backend.del(k)));
  }
}
