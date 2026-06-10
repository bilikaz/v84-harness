import type { ChatMessage, ModelConfig } from "../../providers/types.ts";
import type { FileAttachment, MediaRef, Message, Session, ToolCall } from "./types.ts";
import i18n from "../../lib/i18n.ts";
import { pt } from "../../lib/prompts.ts";
import { detectStorage, IdbStorage } from "../../lib/storage/index.ts";
import { createListeners } from "../../lib/store.ts";
import { errorMessage } from "../../lib/errors.ts";
import { rootLog } from "../../lib/logger/index.ts";
import {
  deleteSessionData,
  loadIndex,
  loadMessages,
  normalize,
  saveIndex,
  saveMessages,
  toMeta,
  type SessionsIndex,
} from "./persistence.ts";

// Session store — the single source of truth for multi-session state (sidebar
// list, chat view, right-panel progress). Plain external store; React binds via
// ./hooks.ts.
//
// Persistence is GRANULAR (see ./persistence.ts): the index (metas + activeId)
// and each session's messages are separate keys, media blobs separate again —
// a write costs what changed, never the whole profile. Boot reads the index +
// the active session; other sessions lazy-load on first open (ensureLoaded).
//
// This module owns STATE + the operations that change it. The turn loop lives
// in ./driver.ts and the bus reactions in ./listeners.ts — they call in here.
const log = rootLog.child("session.store");

// The durable tier — selected once (SQLite > IDB > localStorage, ADR-0017).
const storageReady = detectStorage();

// Build a fresh session. Used for "new session" and the empty-state. `loaded`
// is true: a session born in memory has nothing to lazy-load.
function makeSession(init: { title?: string; system?: string; workspaceId?: string | null } = {}): Session {
  return {
    id: crypto.randomUUID(),
    title: init.title ?? i18n.t("sidebar.newSession"),
    system: init.system ?? pt("defaultChat.system"),
    workspaceId: init.workspaceId ?? null,
    tools: [],
    steps: [],
    messages: [],
    loaded: true,
  };
}

// Until hydration completes the store holds one fresh placeholder session —
// there is no synchronous cache anymore (the old localStorage first-paint
// cache was permanently stale for big profiles and cost a sync multi-MB write
// per persist; a one-frame skeleton behind useHydrated() replaces it).
const placeholder = makeSession();
let sessions: Session[] = [placeholder];
let activeId: string = placeholder.id;
// Sessions currently receiving a stream — multiple at once (per-session, not
// global). A fresh Set on every change so useSyncExternalStore re-renders.
let streamingIds: Set<string> = new Set();
// Sessions currently being summarized/compacted (separate from streaming so the
// UI can show a distinct "summarizing" state).
let compactingIds: Set<string> = new Set();
// False until the async durable-tier hydration below finishes. Consumers gate
// on useHydrated() to show a skeleton instead of the placeholder session.
let hydrated = false;

// Reserve kept free below the model's context window: "full" triggers at
// contextLength − this, leaving headroom for the response (and for the summary
// the auto-compaction generates).
export const CONTEXT_RESERVE = 50_000;

const reg = createListeners();
export const notify = reg.notify;
export const subscribe = reg.subscribe;
// ── Persistence (granular — see ./persistence.ts) ───────────────────────────

function currentIndex(): SessionsIndex {
  return { activeId, sessions: sessions.map(toMeta) };
}

// Write the small index (metas + activeId). Fire-and-forget: persistence
// failures are warnings, never UI errors.
export function persistIndex(): void {
  void storageReady
    .then((s) => saveIndex(s, currentIndex()))
    .catch((e) => log.warn("persist_failed", { what: "index", error: errorMessage(e) }));
}

// Write one session's messages (media extracted to blobs) + the index. Cost is
// proportional to THAT session's text — never the whole profile (ADR-0021).
export function persistSession(sid: string): void {
  void storageReady
    .then(async (storage) => {
      const session = getSession(sid);
      if (!session || session.loaded === false) return; // never clobber rows with an unloaded shell
      const bytes = await saveMessages(storage, sid, session.messages);
      sessions = sessions.map((s) => (s.id === sid ? { ...s, bytes } : s));
      await saveIndex(storage, currentIndex());
      notify(); // footprint shown in Settings → Storage
    })
    .catch((e) => log.warn("persist_failed", { what: "session", sid, error: errorMessage(e) }));
}

// Lazy-load a session's messages on first open. In-flight loads are shared so
// a double-click doesn't read twice.
const loading = new Map<string, Promise<void>>();
export function ensureLoaded(sid: string): Promise<void> {
  const session = getSession(sid);
  if (!session || session.loaded !== false) return Promise.resolve();
  let p = loading.get(sid);
  if (!p) {
    p = (async () => {
      const storage = await storageReady;
      const messages = (await loadMessages(storage, sid)) ?? [];
      sessions = sessions.map((s) => (s.id === sid ? { ...s, messages, loaded: true } : s));
      notify();
    })()
      .catch((e) => {
        log.warn("load_failed", { sid, error: errorMessage(e) });
        // Mark loaded anyway — an empty transcript beats a load loop.
        sessions = sessions.map((s) => (s.id === sid ? { ...s, loaded: true } : s));
        notify();
      })
      .finally(() => loading.delete(sid));
    loading.set(sid, p);
  }
  return p;
}

// Cross-tier import: a desktop build's first run with SQLite while previous
// runs' data sits in IndexedDB — copy every domain key over once.
async function importFromIdb(target: { name: string; set(k: string, v: string): Promise<void> }): Promise<boolean> {
  if (target.name === "idb") return false; // idb IS the selected tier
  try {
    const legacy = await IdbStorage.create();
    const keys = await legacy.keys("v84-harness:");
    for (const k of keys) {
      const v = await legacy.get(k);
      if (v !== null) await target.set(k, v);
    }
    if (keys.length) log.info("imported", { from: "idb", keys: keys.length });
    return keys.length > 0;
  } catch {
    return false; // no IndexedDB here — nothing to import
  }
}

// Hydrate from the durable tier — the authoritative store. Reads the INDEX and
// the ACTIVE session's messages only; everything else lazy-loads via
// ensureLoaded. Falls back through: granular index → cross-tier IDB import →
// fresh.
void (async () => {
  try {
    const storage = await storageReady;
    let index = await loadIndex(storage);
    if (!index && (await importFromIdb(storage))) {
      index = await loadIndex(storage);
    }
    if (index) {
      sessions = index.sessions.map((meta) => ({ ...normalize(meta), loaded: false }));
      activeId = sessions.some((s) => s.id === index.activeId) ? index.activeId : sessions[0].id;
      await ensureLoaded(activeId); // active transcript is part of first paint
    } else {
      await saveIndex(storage, currentIndex()); // first run — seed the index
    }
  } catch (e) {
    log.warn("hydrate_failed", {
      hint: "starting from an empty profile; durable data is intact and retried next launch",
      error: errorMessage(e),
    });
  } finally {
    hydrated = true;
    notify(); // re-render with the durable-tier state and flip useHydrated()
  }
})();

// ── Selectors ────────────────────────────────────────────────────────────────
export function getSessions(): Session[] {
  return sessions;
}
export function getActiveId(): string {
  return activeId;
}
// True once IndexedDB hydration has completed (success or fallback).
export function getHydrated(): boolean {
  return hydrated;
}
export function getActive(): Session {
  return sessions.find((s) => s.id === activeId) ?? sessions[0];
}
export function getSession(id: string): Session | undefined {
  return sessions.find((s) => s.id === id);
}
// Sessions belonging to a workspace (null = the "no workspace / chat" group).
export function getSessionsForWorkspace(workspaceId: string | null): Session[] {
  return sessions.filter((s) => (s.workspaceId ?? null) === workspaceId);
}
export function getStreamingIds(): ReadonlySet<string> {
  return streamingIds;
}
export function getStreaming(): boolean {
  return streamingIds.has(activeId);
}

export function setStreaming(sid: string, on: boolean): void {
  streamingIds = new Set(streamingIds);
  if (on) streamingIds.add(sid);
  else streamingIds.delete(sid);
}

export function getCompactingIds(): ReadonlySet<string> {
  return compactingIds;
}
export function getCompacting(): boolean {
  return compactingIds.has(activeId);
}
export function setCompacting(sid: string, on: boolean): void {
  compactingIds = new Set(compactingIds);
  if (on) compactingIds.add(sid);
  else compactingIds.delete(sid);
}

// ── Commands (user-facing state changes) ─────────────────────────────────────
export function setActive(id: string): void {
  activeId = id;
  // Opening a session marks it read (dot goes transparent).
  sessions = sessions.map((s) => (s.id === id && s.unread ? { ...s, unread: false } : s));
  void ensureLoaded(id); // lazy-load its messages on first open
  persistIndex();
  notify();
}

// Create an empty session, switch to it, return its id.
export function createSession(init: { title?: string; system?: string; workspaceId?: string | null } = {}): string {
  const s = makeSession(init);
  sessions = [s, ...sessions];
  activeId = s.id;
  persistIndex();
  notify();
  return s.id;
}

export function newSession(): void {
  createSession();
}

export function renameSession(id: string, title: string): void {
  const t = title.trim();
  sessions = sessions.map((s) => (s.id === id ? { ...s, title: t || s.title } : s));
  persistIndex();
  notify();
}

export function deleteSession(id: string): void {
  sessions = sessions.filter((s) => s.id !== id);
  if (activeId === id) activeId = sessions[0]?.id ?? "";
  // Drop the session's rows + media blobs from the durable tier.
  void storageReady
    .then((s) => deleteSessionData(s, id))
    .catch((e) => log.warn("delete_failed", { sid: id, error: errorMessage(e) }));
  if (sessions.length === 0) {
    createSession(); // never leave the user with zero sessions (persists the index)
    return;
  }
  if (activeId) void ensureLoaded(activeId);
  persistIndex();
  notify();
}

// ── Mutators (called by the driver's listeners) ──────────────────────────────
export function appendToLast(sid: string, delta: string, field: "text" | "thinking" = "text"): void {
  sessions = sessions.map((s) => {
    if (s.id !== sid) return s;
    const messages = s.messages.slice();
    const i = messages.length - 1;
    const cur = messages[i];
    messages[i] = { ...cur, [field]: (cur[field] ?? "") + delta };
    return { ...s, messages };
  });
  notify();
}

export function pushTurn(sid: string, userText: string, images?: MediaRef[], files?: FileAttachment[], video?: MediaRef[]): void {
  const userMsg: Message = { id: crypto.randomUUID(), role: "user", text: userText, images, video, files };
  const assistantMsg: Message = { id: crypto.randomUUID(), role: "assistant", text: "" };
  sessions = sessions.map((s) =>
    s.id === sid ? { ...s, messages: [...s.messages, userMsg, assistantMsg] } : s,
  );
  notify();
}

// Inject a heal correction: a hidden user message (skipped in the UI, sent to
// the model) carrying the validation error, then a fresh assistant placeholder
// for the retry. Mirrors a turn without showing the churn in the transcript.
export function pushHeal(sid: string, correction: string): void {
  const userMsg: Message = { id: crypto.randomUUID(), role: "user", text: correction, hidden: true };
  const assistantMsg: Message = { id: crypto.randomUUID(), role: "assistant", text: "" };
  sessions = sessions.map((s) =>
    s.id === sid ? { ...s, messages: [...s.messages, userMsg, assistantMsg] } : s,
  );
  notify();
}

// Attach tool calls to the most recent assistant message (the one just streamed).
export function setLastToolCalls(sid: string, calls: ToolCall[]): void {
  sessions = sessions.map((s) => {
    if (s.id !== sid) return s;
    const messages = s.messages.slice();
    const i = messages.length - 1;
    messages[i] = { ...messages[i], toolCalls: calls };
    return { ...s, messages };
  });
  notify();
}

// Append a tool-result message answering a specific call. `images` are shown in
// the tool card (display only — toChatMessages drops tool-role images).
export function pushToolResult(sid: string, toolCallId: string, output: string, images?: MediaRef[], video?: MediaRef[]): void {
  const msg: Message = { id: crypto.randomUUID(), role: "tool", text: output, toolCallId, images, video };
  sessions = sessions.map((s) => (s.id === sid ? { ...s, messages: [...s.messages, msg] } : s));
  notify();
}

// Feed tool-produced media (generated or loaded) back to the model as a hidden
// user turn (skipped in the UI — it already shows in the tool card; this just
// lets a vision agent see it on its next turn).
export function pushMediaFeedback(sid: string, images?: MediaRef[], video?: MediaRef[]): void {
  const msg: Message = {
    id: crypto.randomUUID(),
    role: "user",
    text: "Media attached above for your review.",
    images,
    video,
    hidden: true,
  };
  sessions = sessions.map((s) => (s.id === sid ? { ...s, messages: [...s.messages, msg] } : s));
  notify();
}

// Wipe the streaming assistant placeholder after a mid-step transport retry —
// the request is re-sent from scratch, so partial text/thinking/calls must go.
export function resetLast(sid: string): void {
  sessions = sessions.map((s) => {
    if (s.id !== sid) return s;
    const messages = s.messages.slice();
    const i = messages.length - 1;
    messages[i] = { ...messages[i], text: "", thinking: undefined, toolCalls: undefined };
    return { ...s, messages };
  });
  notify();
}

// Open a fresh empty assistant message for the next model turn in the loop.
export function pushAssistant(sid: string): void {
  const msg: Message = { id: crypto.randomUUID(), role: "assistant", text: "" };
  sessions = sessions.map((s) => (s.id === sid ? { ...s, messages: [...s.messages, msg] } : s));
  notify();
}

// Context occupancy is a SNAPSHOT, not a running sum: each request's input
// tokens already count the whole conversation, so the latest report alone says
// what the window holds. Summing reports would re-count the history once per
// tool-loop step and blow past the window after a few tool calls.
export function setUsage(sid: string, tokens: number): void {
  if (!tokens) return;
  sessions = sessions.map((s) => (s.id === sid ? { ...s, usedTokens: tokens } : s));
  notify();
}

export function markUnread(sid: string): void {
  sessions = sessions.map((s) => (s.id === sid ? { ...s, unread: true } : s));
  notify();
}

export function setTitle(id: string, title: string): void {
  sessions = sessions.map((s) => (s.id === id ? { ...s, title } : s));
  persistIndex();
  notify();
}

// The usable token budget = context window − the reserve (headroom for the
// response). 0 when the window is unknown. Tiny windows fall back to the full
// window so they aren't permanently "full".
export function contextLimit(cfg: ModelConfig): number {
  if (!cfg.contextLength) return 0;
  // Reserve at least 10% of the window — never let the user starve the headroom.
  const min = Math.floor(cfg.contextLength * 0.1);
  const reserve = Math.max(cfg.contextReserve ?? CONTEXT_RESERVE, min);
  return cfg.contextLength > reserve ? cfg.contextLength - reserve : cfg.contextLength;
}

// True once the session has consumed its usable budget — the composer disables
// and auto-compaction kicks in to summarize + free the context.
export function isFull(cfg: ModelConfig, session: Session = getActive()): boolean {
  const limit = contextLimit(cfg);
  return limit > 0 && (session.usedTokens ?? 0) >= limit;
}

// Replace the whole transcript with a single summary message (auto-compaction):
// the model keeps the summary as context, the rest is dropped, token count reset.
export function replaceWithSummary(sid: string, summary: string, usedTokens = 0): void {
  sessions = sessions.map((s) =>
    s.id === sid
      ? { ...s, messages: [{ id: crypto.randomUUID(), role: "user", text: summary, summary: true }], usedTokens }
      : s,
  );
  persistSession(sid); // rewrites the rows; orphaned media blobs are GC'd there
  notify();
}

// Fold attached files into the content the model sees — the bubble shows just
// chips, but the model gets the file text in a labeled code block.
function withFiles(text: string, files?: FileAttachment[]): string {
  if (!files?.length) return text;
  const blocks = files.map((f) => `Attached file: ${f.name}\n\`\`\`\n${f.text}\n\`\`\``).join("\n\n");
  return text ? `${text}\n\n${blocks}` : blocks;
}

// Map stored messages to the provider-agnostic conversation we resubmit. Drops
// empty placeholders (the trailing assistant) and thinking (not resent).
export function toChatMessages(messages: Message[]): ChatMessage[] {
  return messages
    .filter((m) => m.text || m.images?.length || m.video?.length || m.files?.length || m.toolCalls?.length || m.role === "tool")
    .map((m) => ({
      role: m.role,
      content: m.summary
        ? `Summary of the earlier conversation (older messages were compacted to save context):\n\n${m.text}`
        : withFiles(m.text, m.files),
      // Tool-role images/video are display-only (shown in the tool card) — many
      // chat APIs reject media on a tool message, so they're never sent. Vision
      // feedback goes through the hidden user turn (pushMediaFeedback) instead.
      // User-uploaded images/video ARE sent so the model can review them.
      images: m.role === "tool" ? undefined : m.images?.map((im) => ({ url: im.url, mime: im.mime })),
      video: m.role === "tool" ? undefined : m.video?.map((v) => ({ url: v.url, mime: v.mime })),
      toolCalls: m.toolCalls,
      toolCallId: m.toolCallId,
    }));
}
