import type { ChatMessage, ModelConfig } from "../../providers/types.ts";
import type { FileAttachment, ImageRef, Message, Session, ToolCall } from "./types.ts";
import i18n from "../../lib/i18n.ts";
import { pt } from "../../lib/prompts.ts";
import { detectStorage, IdbStorage, type Storage } from "../../lib/storage/index.ts";
import { createListeners } from "../../lib/store.ts";
import { errorMessage } from "../../lib/errors.ts";
import { rootLog } from "../../lib/logger/index.ts";

// Session store — the single source of truth for multi-session state (sidebar
// list, chat view, right-panel progress). Plain external store; React binds via
// ./hooks.ts. Persisted to localStorage for now; swaps to SQLite via the
// core/IPC layer later (same surface, different backend).
//
// This module owns STATE + the operations that change it. The turn loop lives
// in ./driver.ts and the bus reactions in ./listeners.ts — they call in here.
const KEY = "v84-harness:sessions";
const log = rootLog.child("session.store");

// The durable tier — selected once (SQLite > IDB > localStorage, ADR-0017);
// localStorage below stays the synchronous first-paint cache regardless.
const storageReady = detectStorage();

// Build a fresh session. Used for "new session" and the empty-state.
function makeSession(init: { title?: string; system?: string; workspaceId?: string | null } = {}): Session {
  return {
    id: crypto.randomUUID(),
    title: init.title ?? i18n.t("sidebar.newSession"),
    system: init.system ?? pt("defaultChat.system"),
    workspaceId: init.workspaceId ?? null,
    tools: [],
    steps: [],
    messages: [],
  };
}

// Coerce a persisted (possibly older-shape) session into the current model, so
// upgrades don't break existing localStorage data.
function normalize(s: Partial<Session> & { messages?: Partial<Message>[] }): Session {
  return {
    id: s.id ?? crypto.randomUUID(),
    title: s.title ?? "",
    system: s.system ?? "",
    workspaceId: s.workspaceId ?? null,
    tools: Array.isArray(s.tools) ? s.tools : [],
    steps: Array.isArray(s.steps) ? s.steps : [],
    usedTokens: s.usedTokens,
    unread: s.unread,
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
      summary: m.summary,
      hidden: m.hidden,
    })),
  };
}

function load(): { sessions: Session[]; activeId: string } {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { sessions: Partial<Session>[]; activeId: string };
      if (parsed.sessions?.length) {
        const list = parsed.sessions.map(normalize);
        const activeId = list.some((s) => s.id === parsed.activeId) ? parsed.activeId : list[0].id;
        return { sessions: list, activeId };
      }
    }
  } catch {
    /* fall through to a fresh session */
  }
  const s = makeSession();
  return { sessions: [s], activeId: s.id };
}

const initial = load();
let sessions: Session[] = initial.sessions;
let activeId: string = initial.activeId;
// Sessions currently receiving a stream — multiple at once (per-session, not
// global). A fresh Set on every change so useSyncExternalStore re-renders.
let streamingIds: Set<string> = new Set();
// Sessions currently being summarized/compacted (separate from streaming so the
// UI can show a distinct "summarizing" state).
let compactingIds: Set<string> = new Set();
// False until the async IndexedDB hydration below finishes. The first paint uses
// localStorage (instant, but may lag on large image data); flips true once IDB
// has replaced the in-memory state. Consumers can gate on useHydrated() to avoid
// the brief stale flash if they need to.
let hydrated = false;

// Reserve kept free below the model's context window: "full" triggers at
// contextLength − this, leaving headroom for the response (and for the summary
// the auto-compaction generates).
export const CONTEXT_RESERVE = 50_000;

const reg = createListeners();
export const notify = reg.notify;
export const subscribe = reg.subscribe;
export function persist(): void {
  const data = JSON.stringify({ sessions, activeId });
  // localStorage is a fast cache for the instant first paint, but it's capped at
  // ~5 MB — image data-URLs may not fit, and that's fine.
  try {
    localStorage.setItem(KEY, data);
  } catch {
    /* quota / private mode — the durable tier below is the source of truth */
  }
  // The durable tier holds the FULL state (large quota), so images survive a
  // reload.
  void storageReady
    .then((s) => s.set(KEY, data))
    .catch((e) => log.warn("persist_failed", { hint: "state (incl. images) may not survive a reload", error: errorMessage(e) }));
}

// On a desktop build's first run with SQLite, the durable tier is empty while
// the previous runs' data sits in IndexedDB — copy it over once (the legacy-
// key migration recipe, applied across backends).
async function migrateFromIdb(target: Storage): Promise<string | null> {
  if (target.name === "idb") return null; // idb IS the selected tier
  try {
    const legacy = await IdbStorage.create();
    const raw = await legacy.get(KEY);
    if (raw) {
      await target.set(KEY, raw);
      log.info("migrated", { from: "idb", to: target.name });
    }
    return raw;
  } catch {
    return null; // no IndexedDB here — nothing to migrate
  }
}

// Hydrate from the durable tier — the authoritative store. localStorage
// (loaded above) gives an instant first paint but may be missing images that
// didn't fit; the durable tier replaces it once read. On the first run the
// tier is empty, so seed it from whatever localStorage had (migration).
void (async () => {
  try {
    const storage = await storageReady;
    const raw = (await storage.get(KEY)) ?? (await migrateFromIdb(storage));
    if (raw) {
      const parsed = JSON.parse(raw) as { sessions: Partial<Session>[]; activeId: string };
      if (parsed.sessions?.length) {
        sessions = parsed.sessions.map(normalize);
        activeId = sessions.some((s) => s.id === parsed.activeId) ? parsed.activeId : sessions[0].id;
        return;
      }
    }
    await storage.set(KEY, JSON.stringify({ sessions, activeId }));
  } catch (e) {
    // Don't lose data silently: if the durable tier is unavailable we stay on
    // the localStorage-loaded state, which may be stale/missing images.
    log.warn("hydrate_failed", {
      hint: "falling back to localStorage; recent large data (e.g. images) may be missing",
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
  persist();
  notify();
}

// Create an empty session, switch to it, return its id.
export function createSession(init: { title?: string; system?: string; workspaceId?: string | null } = {}): string {
  const s = makeSession(init);
  sessions = [s, ...sessions];
  activeId = s.id;
  persist();
  notify();
  return s.id;
}

export function newSession(): void {
  createSession();
}

export function renameSession(id: string, title: string): void {
  const t = title.trim();
  sessions = sessions.map((s) => (s.id === id ? { ...s, title: t || s.title } : s));
  persist();
  notify();
}

export function deleteSession(id: string): void {
  sessions = sessions.filter((s) => s.id !== id);
  if (activeId === id) activeId = sessions[0]?.id ?? "";
  if (sessions.length === 0) {
    createSession(); // never leave the user with zero sessions
    return;
  }
  persist();
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

export function pushTurn(sid: string, userText: string, images?: ImageRef[], files?: FileAttachment[], video?: ImageRef[]): void {
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
export function pushToolResult(sid: string, toolCallId: string, output: string, images?: ImageRef[], video?: ImageRef[]): void {
  const msg: Message = { id: crypto.randomUUID(), role: "tool", text: output, toolCallId, images, video };
  sessions = sessions.map((s) => (s.id === sid ? { ...s, messages: [...s.messages, msg] } : s));
  notify();
}

// Feed tool-produced media (generated or loaded) back to the model as a hidden
// user turn (skipped in the UI — it already shows in the tool card; this just
// lets a vision agent see it on its next turn).
export function pushMediaFeedback(sid: string, images?: ImageRef[], video?: ImageRef[]): void {
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
  persist();
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
  persist();
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
