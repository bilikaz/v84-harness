// The browser-window fleet (the fetch feature) — reactive runtime state over the host's
// WebContentsView manager (ctx.api.browser, electron only). Transient: live windows don't
// survive a restart, and the durable trail of what was fetched is the agent's Browser/BrowserContent
// tool calls in the session transcript, not this store.
//
// Windows are OWNED by the session that opened them (ownerSessionId): agent tools see only their own
// session's windows (no cross-agent races), while the user's right-rail panel is a god-view over all of
// them. Closing a window REMOVES its record — no tombstones pile up here; the closed-window history lives
// in the transcript. Lifecycle: active (shown overlay) → inactive (live, minimized) → closed (record gone).

import { Consumer } from "./storage/consumer.ts";
import { cap } from "./tools/base.ts";
import { getAppConfig } from "./config/app.ts";
import type { Ctx } from "./ctx.ts";
import type { BrowserWindowContent, BrowserWindowInfo, BrowserWindowUpdate, ViewBounds } from "./host.ts";

export type WindowState = "active" | "inactive";

export interface FleetWindow {
  id: string; // the host key (UUID) — internal; the UI + tool-card link use this
  url: string;
  title: string;
  ownerSessionId: string; // the session that opened it — scopes agent visibility + session-close cleanup
  alias: string; // the short per-session id the AGENT uses (1, 2, 3…) — random UUIDs are hallucination bait
  state: WindowState;
  loading: boolean; // a page load is in flight (grey dot); false once it settles (green dot)
  updatedAt: number;
}

interface FleetState {
  windows: FleetWindow[];
  viewingId: string | null; // the window currently surfaced as the full-content overlay
}

class BrowserFleetStore extends Consumer<FleetState> {
  // id → callbacks waiting on a load to finish (the Browser tool awaits these via whenLoaded).
  private readonly loadWaiters = new Map<string, Array<() => void>>();
  // id → tail of the window's serialized op chain (withWindow). A step's tool calls run concurrently
  // (engine Promise.all), so without this a read can hit a window mid-navigation.
  private readonly locks = new Map<string, Promise<unknown>>();
  // sessionId → last per-session window number. Monotonic, never reused — "browser 2" always means the
  // same window for the life of the session, even after earlier ones close.
  private readonly aliasSeq = new Map<string, number>();

  constructor(ctx: Ctx) {
    super(ctx, null, { windows: [], viewingId: null });
  }

  // Subscribe to the host's load-state pushes. Called from init() once ctx.api is installed (the store is
  // built before that). No-op on the web host (no fleet).
  bindHostEvents(): void {
    this.host?.onEvent((id, update) => this.applyUpdate(id, update));
  }

  // The host capability — absent in the browser host, so every command degrades to a no-op there.
  private get host() {
    return this.ctx.api?.browser;
  }

  available(): boolean {
    return !!this.host;
  }

  // Open a new window owned by the given session. Agents open via the Browser tool (ec.sessionId).
  async open(url: string, ownerSessionId: string): Promise<string | null> {
    const host = this.host;
    if (!host) return null;
    // Reserve the alias synchronously, BEFORE yielding on host.open — two concurrent opens for the same
    // owner would otherwise both read the same seq and collide on one alias. A failed open below just
    // burns the number, which is fine: aliases are monotonic and never reused, gaps are harmless.
    const n = (this.aliasSeq.get(ownerSessionId) ?? 0) + 1;
    this.aliasSeq.set(ownerSessionId, n);
    const id = await host.open(url, getAppConfig().browser.settleMs, getAppConfig().browser.graceMs);
    if (!id) return null;
    const win: FleetWindow = { id, url, title: url, ownerSessionId, alias: String(n), state: "inactive", loading: true, updatedAt: Date.now() };
    this.setWindows([...this.state.windows, win]);
    return id;
  }

  async show(id: string, bounds: ViewBounds): Promise<void> {
    const host = this.host;
    if (!host) return;
    await host.show(id, bounds);
    this.patch(id, (w) => ({ ...w, state: "active" }), true);
  }

  async hide(): Promise<void> {
    const host = this.host;
    if (!host) return;
    await host.hide();
    this.setWindows(this.state.windows.map((w) => (w.state === "active" ? { ...w, state: "inactive" } : w)));
  }

  // Closing REMOVES the record — no tombstone. The god-view panel and ActiveBrowsers stay live-only.
  async close(id: string): Promise<void> {
    const host = this.host;
    if (!host) return;
    await host.close(id);
    this.resolveLoad(id); // anything awaiting its load stops waiting — it's gone
    this.commit({
      windows: this.state.windows.filter((w) => w.id !== id),
      viewingId: this.state.viewingId === id ? null : this.state.viewingId,
    });
  }

  // Session-close cleanup: a deleted session's windows have no owner left to drive them.
  async closeForSession(sid: string): Promise<void> {
    for (const w of this.state.windows.filter((w) => w.ownerSessionId === sid)) await this.close(w.id);
    this.aliasSeq.delete(sid); // the session is gone — drop its alias counter (no window will reference it again)
  }

  // Surface a window as the overlay (the overlay component then reports its bounds to show()).
  view(id: string): void {
    this.commit({ ...this.state, viewingId: id });
  }

  // Collapse the overlay back to the chat; the window stays live (just minimized).
  async unview(): Promise<void> {
    await this.host?.hide();
    this.commit({ ...this.state, viewingId: null });
  }

  useViewingId = (): string | null => this.useSelect((s) => s.viewingId);

  // Serialize ops on one window so they chain instead of overlapping: Browser holds it across
  // navigate → whenLoaded → read, so a concurrent BrowserContent on the same window waits for the page
  // to be ready rather than racing the load. The map entry is dropped once nothing is queued behind it.
  async withWindow<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const run = prev.then(() => fn(), () => fn());
    const tail = run.then(() => {}, () => {});
    this.locks.set(id, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(id) === tail) this.locks.delete(id);
    }
  }

  async navigate(id: string, url: string): Promise<void> {
    const host = this.host;
    if (!host) return;
    // Mark loading up front so whenLoaded waits for THIS navigation to settle, not a stale state.
    this.patch(id, (w) => ({ ...w, url, loading: true, updatedAt: Date.now() }));
    await host.navigate(id, url, getAppConfig().browser.settleMs, getAppConfig().browser.graceMs);
  }

  getContent(id: string): Promise<BrowserWindowContent | null> {
    return this.host?.get(id) ?? Promise.resolve(null);
  }

  // PNG screenshots of the page (data URLs, top + lower sections), for BrowserContent (vision) and
  // BrowserDescribe (imageRec). Empty if the view is gone/blank.
  capturePage(id: string): Promise<string[]> {
    return this.host?.capturePage(id, getAppConfig().browser.shots) ?? Promise.resolve([]);
  }

  // Host push on any window change: keep url/title/dot current (so the god-view tracks navigation), and
  // release any whenLoaded waiters once a load settles.
  applyUpdate(id: string, update: BrowserWindowUpdate): void {
    if (!this.record(id)) return;
    this.patch(id, (w) => ({ ...w, url: update.url || w.url, title: update.title || w.title, loading: update.loading, updatedAt: Date.now() }));
    if (!update.loading) this.resolveLoad(id);
  }

  // Resolve once the window's current load settles (or it's gone, or after a safety timeout) — the Browser
  // tool awaits this so it can return only when the page is actually ready to read.
  whenLoaded(id: string, timeoutMs = 20000): Promise<void> {
    const w = this.record(id);
    if (!w || !w.loading) return Promise.resolve();
    return new Promise((resolve) => {
      const waiters = this.loadWaiters.get(id) ?? [];
      let done = false;
      const fire = (): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(fire, timeoutMs);
      waiters.push(fire);
      this.loadWaiters.set(id, waiters);
    });
  }

  private resolveLoad(id: string): void {
    const waiters = this.loadWaiters.get(id);
    if (!waiters) return;
    this.loadWaiters.delete(id);
    for (const fire of waiters) fire();
  }

  // The stored record for one host id (UUID) — used internally + by the tool-card link.
  record(id: string): FleetWindow | undefined {
    return this.state.windows.find((w) => w.id === id);
  }

  // Resolve a session's short alias (1, 2, …) to its window. Lenient — strips quotes/spaces the model may
  // echo (e.g. '"2 "') so a small formatting quirk doesn't read as "no such window".
  recordByAlias(sid: string, alias: string): FleetWindow | undefined {
    const a = alias.replace(/['"\s]/g, "");
    return this.state.windows.find((w) => w.ownerSessionId === sid && w.alias === a);
  }

  // Live windows owned by one session — the agent-scoped view (ActiveBrowsers).
  windowsForSession(sid: string): FleetWindow[] {
    return this.state.windows.filter((w) => w.ownerSessionId === sid);
  }

  // Pull live truth from main and reconcile: refresh url/title/updatedAt, and DROP any record main no
  // longer knows (a window that died on its own — navigation crash, user close). No tombstone is kept.
  async refresh(): Promise<BrowserWindowInfo[]> {
    const host = this.host;
    if (!host) return [];
    const live = await host.active();
    const byId = new Map(live.map((w) => [w.id, w]));
    const windows = this.state.windows
      .filter((w) => byId.has(w.id))
      .map((w) => {
        const info = byId.get(w.id)!;
        return { ...w, url: info.url, title: info.title || w.title, loading: info.loading, updatedAt: info.updatedAt, state: (info.active ? "active" : "inactive") as WindowState };
      });
    const viewingId = this.state.viewingId && byId.has(this.state.viewingId) ? this.state.viewingId : null;
    this.commit({ windows, viewingId });
    return live;
  }

  // Replace just the window list, preserving viewingId.
  private setWindows(windows: FleetWindow[]): void {
    this.commit({ ...this.state, windows });
  }

  private patch(id: string, fn: (w: FleetWindow) => FleetWindow, deactivateOthers = false): void {
    this.setWindows(
      this.state.windows.map((w) => {
        if (w.id === id) return fn(w);
        if (deactivateOthers && w.state === "active") return { ...w, state: "inactive" };
        return w;
      }),
    );
  }

  useWindows = (): FleetWindow[] => this.useSelect((s) => s.windows);
}

let store: BrowserFleetStore;

export function initBrowser(ctx: Ctx): BrowserFleetStore {
  store = new BrowserFleetStore(ctx);
  return store;
}

export const browserFleet = (): BrowserFleetStore => store;
export const useFleetWindows = (): FleetWindow[] => store.useWindows();
export const useViewingId = (): string | null => store.useViewingId();

// Build a forward: a hidden context message (the window snapshot at send time, so the reference survives
// the window closing) + the visible comment that references it. The overlay routes these to the OWNING
// session via ctx.sessions.sendTo, so the agent that opened the window picks up the user's manual step.
// Null if the window is already gone.
export async function buildForward(id: string, comment: string): Promise<{ text: string; context: string } | null> {
  const content = await store.getContent(id);
  if (!content) return null;
  const context = cap(
    `Forwarded browser window — the user is asking about this page.\n` +
      `window id: ${id}\ntitle: ${content.title}\nurl: ${content.url}\n\n${content.text}`,
  );
  const text = `**regarding window id:** ${id}${comment.trim() ? `\n\n${comment.trim()}` : ""}`;
  return { text, context };
}
