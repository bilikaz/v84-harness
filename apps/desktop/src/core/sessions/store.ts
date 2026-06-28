import type { ChatMessage } from "../../llm/types.ts";
import type { ChatModelSettings } from "../settings.ts";
import type { FileAttachment, Image, Video, Message, Session, ToolCallRequest } from "./types.ts";
import { getAppConfig } from "../config/index.ts";
import i18n from "../../lib/i18n.ts";
import type { StorageEngine } from "../storage/engine.ts";
import type { StorageRepos } from "../storage/types.ts";
import { createListeners } from "../storage/consumer.ts";
import { errorMessage } from "../../lib/errors.ts";
import { rootLog } from "../../lib/logger/index.ts";
import { normalize, toMeta, type SessionMeta } from "./persistence.ts";
import { newId } from "../ids.ts";
import { getActiveContainerId } from "../containers.ts";

// Session store — the single source of truth for multi-session state. Plain
// external store; React binds via ./hooks.ts. Owns STATE + the operations that
// change it.
const log = rootLog.child("session.store");

// The durable tier — the StorageEngine (per-entity repos over the active provider), injected by init()
// after ctx.storage is built. Null before injection; persistence is a no-op until set, hydrate runs once it is.
let data: StorageEngine | null = null;
export function useStorage(e: StorageEngine): void {
  data = e;
}

// agentId stamps an agent run (the agent's output contract then applies to
// every turn); parentId marks a sub-agent run spawned by another session's
// RunAgent call.
export interface SessionInit {
  title?: string;
  system?: string;
  containerId?: string;
  agentId?: string;
  parentId?: string;
}

// `loaded` is true: a session born in memory has nothing to lazy-load. A session always belongs
// to a container; createSession defaults it to the active one.
function makeSession(init: SessionInit = {}): Session {
  return {
    id: newId(),
    title: init.title ?? i18n.t("sidebar.newSession"),
    // No baked default — the engine resolves the base system live each turn (agent → workspace → global
    // setting → built-in default), so a later change to the global/workspace prompt takes effect. Agents
    // still carry their own system here (init.system).
    system: init.system ?? "",
    containerId: init.containerId ?? "",
    agentId: init.agentId,
    parentId: init.parentId,
    tools: [],
    messages: [],
    loaded: true,
  };
}

// Until hydration completes the store holds one fresh placeholder session (no container yet —
// it's never persisted; hydrate() replaces it with real rows or binds it to the active container).
const placeholder = makeSession();
let sessions: Session[] = [placeholder];
let activeId: string = placeholder.id;
// A fresh Set on every change so useSyncExternalStore re-renders.
let streamingIds: Set<string> = new Set();
let compactingIds: Set<string> = new Set();
// Sub-agent children the USER stopped (a pause, not a failure) — distinct from agent-stalled
// (errorKind). Resume ownership follows the stopper: the parent's ResumeAgent won't touch these,
// and getAgentContent treats them as "not done yet" (per the async orchestration design).
let userPausedIds: Set<string> = new Set();
let hydrated = false;

const reg = createListeners();
export const notify = reg.notify;
export const subscribe = reg.subscribe;
// ── Persistence (granular — see ./persistence.ts) ───────────────────────────

// Persist one session's META row, routed by its placement. Per-row — there is no index blob,
// so nothing can overwrite the whole list. Gated on `hydrated` + a real container so the
// pre-hydration placeholder never reaches a backend.
export function persistSessionMeta(sid: string): void {
  if (!data || !hydrated) return;
  const s = getSession(sid);
  if (!s || !s.containerId) return;
  void data.repos().sessions.put(toMeta(s)).catch((e: unknown) => log.warn("persist_failed", { what: "meta", sid, error: errorMessage(e) }));
}

// Media blobs are externalized into the media repo (the message stores a `media:<id>` ref);
// reinflated on load. Keeps message rows light and populates the media table.
const MEDIA_REF = "media:";

async function storeMedia(repos: StorageRepos, sid: string, messageId: string, kind: "image" | "video", ref: Image | Video): Promise<Image | Video> {
  if (!ref.url.startsWith("data:")) return ref; // already a ref or an http url
  if (!ref.id) ref.id = newId(); // stamp the in-memory ref so a re-persist reuses the same row
  await repos.media.put({ id: ref.id, sessionId: sid, messageId, kind, mime: ref.mime ?? "", name: ref.name ?? null, data: ref.url });
  return { ...ref, url: MEDIA_REF + ref.id };
}

async function externalizeMedia(repos: StorageRepos, sid: string, messages: Message[]): Promise<Message[]> {
  const out: Message[] = [];
  for (const m of messages) {
    const images = m.images && (await Promise.all(m.images.map((g) => storeMedia(repos, sid, m.id, "image", g))));
    const videos = m.videos && (await Promise.all(m.videos.map((g) => storeMedia(repos, sid, m.id, "video", g))));
    out.push({ ...m, images, videos });
  }
  return out;
}

async function inflateMedia(repos: StorageRepos, sid: string, messages: Message[]): Promise<Message[]> {
  const blobs = new Map((await repos.media.listBySession(sid)).map((x) => [x.id, x.data]));
  const fix = <T extends Image | Video>(g: T): T => (g.url.startsWith(MEDIA_REF) ? { ...g, url: blobs.get(g.url.slice(MEDIA_REF.length)) ?? "" } : g);
  return messages.map((m) => ({ ...m, images: m.images?.map(fix), videos: m.videos?.map(fix) }));
}

// Persist the session's transcript (media externalized to the media repo) + its meta row.
export function persistSession(sid: string): void {
  if (!data || !hydrated) return;
  void (async () => {
    const session = getSession(sid);
    if (!session || session.loaded === false || !session.containerId) return; // never clobber rows with an unloaded shell / placeholder
    const repos = data!.repos();
    const stored = await externalizeMedia(repos, sid, session.messages);
    await repos.messages.replaceForSession(sid, stored);
    const meta = getSession(sid);
    if (meta) await repos.sessions.put(toMeta(meta));
    notify();
  })().catch((err) => log.warn("persist_failed", { what: "session", sid, error: errorMessage(err) }));
}

// In-flight loads are shared so a double-click doesn't read twice.
const loading = new Map<string, Promise<void>>();
export function ensureLoaded(sid: string): Promise<void> {
  const session = getSession(sid);
  if (!session || session.loaded !== false) return Promise.resolve();
  const repos = data?.repos();
  if (!repos) return Promise.resolve();
  let p = loading.get(sid);
  if (!p) {
    p = (async () => {
      const messages = await inflateMedia(repos, sid, await repos.messages.listBySession(sid));
      sessions = sessions.map((s) => (s.id === sid ? { ...s, messages, loaded: true } : s));
      notify();
    })()
      .catch((err) => {
        log.warn("load_failed", { sid, error: errorMessage(err) });
        // Mark loaded anyway — an empty transcript beats a load loop.
        sessions = sessions.map((s) => (s.id === sid ? { ...s, loaded: true } : s));
        notify();
      })
      .finally(() => loading.delete(sid));
    loading.set(sid, p);
  }
  return p;
}

// Enumerates the session META rows (both realms — no master index), then loads the active
// session's messages; the rest lazy-load via ensureLoaded. Runs AFTER containers hydrate (init
// orchestrates the order) so the active container exists for a fresh profile. On a fresh
// profile it binds one starter session to the active container.
export async function hydrate(): Promise<void> {
  const e = data;
  hydrated = false;
  try {
    if (!e) return;
    // The session metas from the active provider (no master index — the rows ARE the list).
    const metas: SessionMeta[] = await e.repos().sessions.list();
    if (metas.length) {
      sessions = metas.map((meta) => ({ ...normalize(meta), loaded: false }));
      activeId = sessions.some((s) => s.id === activeId) ? activeId : sessions[0].id;
      await ensureLoaded(activeId); // active transcript is part of first paint
    } else {
      const cid = getActiveContainerId();
      const starter = makeSession({ containerId: cid ?? "" });
      sessions = [starter];
      activeId = starter.id;
      if (cid) await e.repos().sessions.put(toMeta(starter)).catch(() => undefined);
    }
  } catch (err) {
    log.warn("hydrate_failed", {
      hint: "starting from an empty profile; durable data is intact and retried next launch",
      error: errorMessage(err),
    });
  } finally {
    hydrated = true;
    notify();
  }
}

// ── Selectors ────────────────────────────────────────────────────────────────
export function getSessions(): Session[] {
  return sessions;
}
export function getActiveId(): string {
  return activeId;
}
export function getHydrated(): boolean {
  return hydrated;
}
export function getActive(): Session {
  return sessions.find((s) => s.id === activeId) ?? sessions[0];
}
export function getSession(id: string): Session | undefined {
  return sessions.find((s) => s.id === id);
}
// Sessions belonging to a container.
export function getSessionsForContainer(containerId: string): Session[] {
  return sessions.filter((s) => s.containerId === containerId);
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
  // Any turn start clears a user pause — the child is running again (resume / new message).
  if (on && userPausedIds.has(sid)) setUserPaused(sid, false);
}

export function getUserPausedIds(): ReadonlySet<string> {
  return userPausedIds;
}
export function setUserPaused(sid: string, on: boolean): void {
  userPausedIds = new Set(userPausedIds);
  if (on) userPausedIds.add(sid);
  else userPausedIds.delete(sid);
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
  const wasUnread = getSession(id)?.unread;
  sessions = sessions.map((s) => (s.id === id && s.unread ? { ...s, unread: false } : s));
  void ensureLoaded(id);
  if (wasUnread) persistSessionMeta(id); // unread flag changed
  notify();
}

// `activate: false` keeps the user where they are (sub-agent runs must not
// steal focus from the parent chat). Defaults the session to the active container.
export function createSession(init: SessionInit = {}, opts: { activate?: boolean } = {}): string {
  const containerId = init.containerId ?? getActiveContainerId() ?? "";
  const s = makeSession({ ...init, containerId });
  // A child gets a stable short handle (#1, #2, …) within its parent, baked into its title in spawn order.
  // The title persists (and shows in the sidebar), so the handle survives reload with no separate field —
  // the roster/AskAgent/ResumeAgent parse it back out (catalog.aliasOf).
  if (init.parentId) s.title = `${s.title} #${sessions.filter((x) => x.parentId === init.parentId).length + 1}`;
  sessions = [s, ...sessions];
  if (opts.activate !== false) activeId = s.id;
  persistSessionMeta(s.id);
  notify();
  return s.id;
}

export function newSession(): void {
  createSession();
}

export function renameSession(id: string, title: string): void {
  const t = title.trim();
  sessions = sessions.map((s) => (s.id === id ? { ...s, title: t || s.title } : s));
  persistSessionMeta(id);
  notify();
}

// Detach the agent from a session, converting it to a plain one. One-way by
// design.
export function unlinkAgent(id: string): void {
  sessions = sessions.map((s) => (s.id === id ? { ...s, agentId: undefined } : s));
  persistSessionMeta(id);
  notify();
}

export function deleteSession(id: string): void {
  const gone = getSession(id);
  sessions = sessions.filter((s) => s.id !== id);
  if (activeId === id) activeId = sessions[0]?.id ?? "";
  // Drop the deleted id from the per-session scratch maps so they don't accumulate dead entries over
  // the app's life. childRuns is keyed by tool-call id, so prune the id from every list and discard
  // any that empty out (a parent's lists empty as its children are deleted in the cascade).
  if (userPausedIds.has(id)) {
    userPausedIds = new Set(userPausedIds);
    userPausedIds.delete(id);
  }
  const prunedRuns: Record<string, string[]> = {};
  for (const [tcId, kids] of Object.entries(childRuns)) {
    const rest = kids.filter((k) => k !== id);
    if (rest.length) prunedRuns[tcId] = rest;
  }
  childRuns = prunedRuns;
  if (id in lastSystem) {
    const { [id]: _gone, ...rest } = lastSystem;
    lastSystem = rest;
  }
  if (data && gone) {
    const repos = data.repos();
    void repos.sessions.remove(id).catch((e: unknown) => log.warn("delete_failed", { sid: id, error: errorMessage(e) }));
    // Offline (local provider) hard-clears the transcript too; connected (remote) the server
    // soft-deletes the session and keeps its messages for restore.
    if (!data.connected) void repos.messages.replaceForSession(id, []);
  }
  if (sessions.length === 0) {
    createSession(); // never leave the user with zero sessions (persists its own meta row)
    return;
  }
  if (activeId) void ensureLoaded(activeId);
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

export function pushTurn(sid: string, userText: string, images?: Image[], files?: FileAttachment[], videos?: Video[]): void {
  const at = Date.now();
  const userMsg: Message = { id: crypto.randomUUID(), role: "user", text: userText, images, videos, files, createdAt: at };
  const assistantMsg: Message = { id: crypto.randomUUID(), role: "assistant", text: "", createdAt: at };
  sessions = sessions.map((s) =>
    s.id === sid ? { ...s, messages: [...s.messages, userMsg, assistantMsg] } : s,
  );
  notify();
}

// A hidden user message (skipped in the UI, sent to the model) carrying the
// validation error, then a fresh assistant placeholder for the retry.
export function pushHeal(sid: string, correction: string): void {
  const at = Date.now();
  const userMsg: Message = { id: crypto.randomUUID(), role: "user", text: correction, hidden: true, createdAt: at };
  const assistantMsg: Message = { id: crypto.randomUUID(), role: "assistant", text: "", createdAt: at };
  sessions = sessions.map((s) =>
    s.id === sid ? { ...s, messages: [...s.messages, userMsg, assistantMsg] } : s,
  );
  notify();
}

// A hidden user message carrying forwarded context (a browser window's snapshot), pushed
// just before the visible comment that references it. Sent to the model, skipped in the UI —
// the durable record of what was forwarded, so the reference survives the window being closed.
export function pushContext(sid: string, text: string): void {
  const msg: Message = { id: crypto.randomUUID(), role: "user", text, hidden: true, createdAt: Date.now() };
  sessions = sessions.map((s) => (s.id === sid ? { ...s, messages: [...s.messages, msg] } : s));
  notify();
}

export function setLastToolCalls(sid: string, calls: ToolCallRequest[]): void {
  sessions = sessions.map((s) => {
    if (s.id !== sid) return s;
    const messages = s.messages.slice();
    const i = messages.length - 1;
    messages[i] = { ...messages[i], toolCalls: calls };
    return { ...s, messages };
  });
  notify();
}

// Scrub a single tool_call (by id) from the assistant message that bears it — for an "erased" engine call
// (a premature getAgentContent): no tool result is appended, and the call is dropped so history looks like
// it never happened. If the assistant message is left empty (no other calls, no text), drop it entirely.
export function removeToolCall(sid: string, callId: string): void {
  sessions = sessions.map((s) => {
    if (s.id !== sid) return s;
    const messages = s.messages.slice();
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (!m.toolCalls?.some((c) => c.id === callId)) continue;
      const toolCalls = m.toolCalls.filter((c) => c.id !== callId);
      if (!toolCalls.length && !m.text && !m.images?.length && !m.videos?.length) messages.splice(i, 1);
      else messages[i] = { ...m, toolCalls: toolCalls.length ? toolCalls : undefined };
      break;
    }
    return { ...s, messages };
  });
  notify();
}

// Append a tool-result message answering a specific call. `images` are shown in
// the tool card (display only — toChatMessages drops tool-role images);
// `childSessionIds` are a RunAgent result's durable links to the runs it spawned.
export function pushToolResult(
  sid: string,
  toolCallId: string,
  output: string,
  images?: Image[],
  videos?: Video[],
  childSessionIds?: string[],
  browserWindowId?: string,
): void {
  const msg: Message = { id: crypto.randomUUID(), role: "tool", text: output, toolCallId, images, videos, childSessionIds, browserWindowId, createdAt: Date.now() };
  sessions = sessions.map((s) => (s.id === sid ? { ...s, messages: [...s.messages, msg] } : s));
  notify();
}

// In-flight RunAgent calls: toolCallId → the child sessions it spawned. The
// LIVE half of the tool-card links (the durable half rides the tool-result
// message). Transient by design — a reload mid-run loses only the links, never
// the child sessions themselves.
let childRuns: Record<string, string[]> = {};
export function addChildRun(toolCallId: string, childSessionId: string): void {
  childRuns = { ...childRuns, [toolCallId]: [...(childRuns[toolCallId] ?? []), childSessionId] };
  notify();
}
export function getChildRuns(): Record<string, string[]> {
  return childRuns;
}

// The FULL system prompt the engine last sent for a session (base + the capability blocks it gated in
// that turn). Transient — captured per turn so the SystemBanner shows what the model actually received,
// not a UI reconstruction. Absent until a session has run a turn; the banner falls back to the base then.
let lastSystem: Record<string, string> = {};
export function setLastSystem(sid: string, system: string): void {
  if (lastSystem[sid] === system) return; // unchanged across steps — skip the re-render
  lastSystem = { ...lastSystem, [sid]: system };
  notify();
}
export function getLastSystem(sid: string): string | undefined {
  return lastSystem[sid];
}

// Feed tool-produced media back to the model as a hidden user turn (skipped in
// the UI — it already shows in the tool card; this lets a vision agent see it).
export function pushMediaFeedback(sid: string, images?: Image[], videos?: Video[]): void {
  const msg: Message = {
    id: crypto.randomUUID(),
    role: "user",
    text: "Media attached above for your review.",
    images,
    videos,
    hidden: true,
    createdAt: Date.now(),
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

export function pushAssistant(sid: string): void {
  const msg: Message = { id: crypto.randomUUID(), role: "assistant", text: "", createdAt: Date.now() };
  sessions = sessions.map((s) => (s.id === sid ? { ...s, messages: [...s.messages, msg] } : s));
  notify();
}

// Stamp (or clear) why a session's last turn failed — feeds the roster status and resume guidance.
export function setErrorKind(sid: string, kind: Session["errorKind"]): void {
  sessions = sessions.map((s) => (s.id === sid ? { ...s, errorKind: kind } : s));
  notify();
}

// Open a RESUME turn: drop the trailing errored assistant message (the "⚠️ …" one) so the history ends at
// the already-gathered tool results, then push a fresh assistant to stream into. The model continues from
// where it stalled — no new user message, so it finishes the task instead of answering a re-prompt.
export function resumeTail(sid: string): void {
  sessions = sessions.map((s) => {
    if (s.id !== sid) return s;
    const messages = s.messages.slice();
    if (messages[messages.length - 1]?.role === "assistant") messages.pop();
    messages.push({ id: crypto.randomUUID(), role: "assistant", text: "", createdAt: Date.now() });
    return { ...s, messages, errorKind: undefined };
  });
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

// The model that served the latest turn — persisted via meta (turn:end), shown by the composer.
export function setLastModel(sid: string, model: string): void {
  sessions = sessions.map((s) => (s.id === sid ? { ...s, lastModel: model } : s));
  notify();
}

export function markUnread(sid: string): void {
  sessions = sessions.map((s) => (s.id === sid ? { ...s, unread: true } : s));
  notify();
}

export function setTitle(id: string, title: string): void {
  sessions = sessions.map((s) => (s.id === id ? { ...s, title } : s));
  persistSessionMeta(id);
  notify();
}

// The usable token budget = context window − the reserve (headroom for the
// response). 0 when the window is unknown. Tiny windows fall back to the full
// window so they aren't permanently "full".
export function contextLimit(cfg: ChatModelSettings): number {
  if (!cfg.model.contextLength) return 0;
  const { contextReserve, reserveMinFraction } = getAppConfig().session;
  // Reserve at least the configured fraction of the window — never let the
  // user starve the headroom.
  const min = Math.floor(cfg.model.contextLength * reserveMinFraction);
  const reserve = Math.max(cfg.contextReserve ?? contextReserve, min);
  return cfg.model.contextLength > reserve ? cfg.model.contextLength - reserve : cfg.model.contextLength;
}

export function isFull(cfg: ChatModelSettings, session: Session = getActive()): boolean {
  const limit = contextLimit(cfg);
  return limit > 0 && (session.usedTokens ?? 0) >= limit;
}

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

// Media resend window — a resend policy only; the transcript and UI keep
// everything. Bounded BOTH by count (image tokens / prefill time) and by
// payload bytes (request body / proxy limits). COUNT is the binding budget
// (images are pixel-fitted at the door, ADR-0027); the byte budget is a loose
// backstop against what the resizer can't shrink (GIFs, video).
export const MAX_LIVE_MEDIA = 10;
export const MAX_LIVE_MEDIA_BYTES = 50 * 1024 * 1024; // data-URL length as the measure

// Decide, newest-first, how many of each message's media items stay live. An
// item must fit BOTH remaining budgets — except the very newest item, which is
// always sent: the model must never be blind to the media it was just given.
// Tool-role media never counts — it isn't resubmitted at all.
function mediaWindow(messages: Message[]): Map<string, { images: number; video: number }> {
  const keep = new Map<string, { images: number; video: number }>();
  let count = MAX_LIVE_MEDIA;
  let bytes = MAX_LIVE_MEDIA_BYTES;
  let newest = true;
  // Prefix take: stop at the first item that doesn't fit, so the kept count
  // maps onto slice(0, n) in toChatMessages — never a gappy selection.
  const takeWhileFits = (items: (Image | Video)[] | undefined): number => {
    let n = 0;
    for (const item of items ?? []) {
      if (!newest && (count < 1 || item.url.length > bytes)) break;
      newest = false;
      count -= 1;
      bytes -= item.url.length;
      n += 1;
    }
    return n;
  };
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "tool" || (!m.images?.length && !m.videos?.length)) continue;
    // Within a message, video first (rarer and deliberate), then images.
    const video = takeWhileFits(m.videos);
    const images = takeWhileFits(m.images);
    keep.set(m.id, { images, video });
  }
  return keep;
}

// The stub that replaces windowed-out media — names what was here and how to
// get it back, so it degrades to one extra Load call instead of silent amnesia.
function droppedNote(dropped: (Image | Video)[]): string {
  const names = dropped.map((d) => d.name || "unnamed").join(", ");
  return `[${dropped.length} media item(s) shown here earlier were removed from the context to save space: ${names}. Use ImageLoad/VideoLoad to view one again if needed.]`;
}

function hiddenNote(hidden: (Image | Video)[]): string {
  const names = hidden.map((d) => d.name || "unnamed").join(", ");
  return `[${hidden.length} media item(s) in this message are not shown — the current model does not accept that input type: ${names}.]`;
}

// Drops empty placeholders (the trailing assistant) and thinking (not resent);
// media outside the resend window is swapped for a text stub.
//
// `input` is the CURRENT model's declared inputs — checked at send time, every
// turn, because the model can change mid-session: history media a text-only
// model can't take is withheld (with a note) instead of letting the endpoint
// 400 the whole turn. Image assumed on unless declared off, video only when
// declared on. Callers that omit `input` (tests) get everything.
export function toChatMessages(messages: Message[], input?: NonNullable<ChatModelSettings["input"]>): ChatMessage[] {
  const allowImage = input ? input.image !== false : true;
  const allowVideo = input ? input.video === true : true;
  const window = mediaWindow(messages);
  return messages
    .filter((m) => m.text || m.images?.length || m.videos?.length || m.files?.length || m.toolCalls?.length || m.role === "tool")
    .map((m) => {
      const keep = window.get(m.id) ?? { images: 0, video: 0 };
      const imgAll = m.role === "tool" ? [] : (m.images ?? []);
      const vidAll = m.role === "tool" ? [] : (m.videos ?? []);
      const images = allowImage ? imgAll.slice(0, keep.images) : [];
      const video = allowVideo ? vidAll.slice(0, keep.video) : [];
      // Capability-hidden media gets its own note (the whole modality is
      // invisible to this model); the window note covers only what the model
      // COULD see but was trimmed for space.
      const dropped = [...(allowImage ? imgAll.slice(keep.images) : []), ...(allowVideo ? vidAll.slice(keep.video) : [])];
      const hidden = [...(allowImage ? [] : imgAll), ...(allowVideo ? [] : vidAll)];
      let content = m.summary
        ? `Summary of the earlier conversation (older messages were compacted to save context):\n\n${m.text}`
        : withFiles(m.text, m.files);
      if (dropped.length) content = content ? `${content}\n\n${droppedNote(dropped)}` : droppedNote(dropped);
      if (hidden.length) content = content ? `${content}\n\n${hiddenNote(hidden)}` : hiddenNote(hidden);
      return {
        role: m.role,
        content,
        // Tool-role images/video are display-only — many chat APIs reject media
        // on a tool message, so they're never sent. Vision feedback goes through
        // the hidden user turn (pushMediaFeedback) instead.
        images: images?.length ? images.map((im) => ({ url: im.url, mime: im.mime })) : undefined,
        videos: video?.length ? video.map((v) => ({ url: v.url, mime: v.mime })) : undefined,
        toolCalls: m.toolCalls,
        toolCallId: m.toolCallId,
      };
    });
}
