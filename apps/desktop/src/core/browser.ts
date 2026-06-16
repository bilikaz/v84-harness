// The browser-window fleet (the fetch feature) — reactive runtime state over the host's
// WebContentsView manager (ctx.api.browser, electron only). Transient: live windows don't
// survive a restart, and the durable trail of what was fetched is the forwarded message in
// the session transcript, not this store.
//
// Lifecycle mirrors the agent fleet: active (shown overlay) → inactive (live, minimized) →
// closed (renderer freed; the record stays as a tombstone, never a silent gap).

import { Consumer } from "./storage/consumer.ts";
import { cap } from "./tools/base.ts";
import type { Ctx } from "./ctx.ts";
import type { BrowserWindowContent, BrowserWindowInfo, ViewBounds } from "./host.ts";

export type WindowState = "active" | "inactive" | "closed";
export type SeededBy = "user" | "agent";

export interface FleetWindow {
  id: string;
  url: string;
  title: string;
  seededBy: SeededBy; // human-seeded windows are sticky under eviction (a login can't be re-established)
  state: WindowState;
  updatedAt: number;
}

interface FleetState {
  windows: FleetWindow[];
  viewingId: string | null; // the window currently surfaced as the full-content overlay
}

class BrowserFleetStore extends Consumer<FleetState> {
  constructor(ctx: Ctx) {
    super(ctx, null, { windows: [], viewingId: null });
  }

  // The host capability — absent in the browser host, so every command degrades to a no-op there.
  private get host() {
    return this.ctx.api?.browser;
  }

  available(): boolean {
    return !!this.host;
  }

  async open(url: string, seededBy: SeededBy = "user"): Promise<string | null> {
    const host = this.host;
    if (!host) return null;
    const id = await host.open(url);
    if (!id) return null;
    const win: FleetWindow = { id, url, title: url, seededBy, state: "inactive", updatedAt: Date.now() };
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

  async close(id: string): Promise<void> {
    const host = this.host;
    if (!host) return;
    await host.close(id);
    this.commit({
      windows: this.state.windows.map((w) => (w.id === id ? { ...w, state: "closed" } : w)),
      viewingId: this.state.viewingId === id ? null : this.state.viewingId,
    });
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

  async navigate(id: string, url: string): Promise<void> {
    const host = this.host;
    if (!host) return;
    await host.navigate(id, url);
    this.patch(id, (w) => ({ ...w, url, updatedAt: Date.now() }));
  }

  getContent(id: string): Promise<BrowserWindowContent | null> {
    return this.host?.get(id) ?? Promise.resolve(null);
  }

  // Pull live truth from main and reconcile: refresh url/title/updatedAt, and tombstone any
  // record main no longer knows (a window that died on its own — navigation crash, etc.).
  async refresh(): Promise<BrowserWindowInfo[]> {
    const host = this.host;
    if (!host) return [];
    const live = await host.active();
    const byId = new Map(live.map((w) => [w.id, w]));
    this.setWindows(
      this.state.windows.map((w) => {
        if (w.state === "closed") return w;
        const info = byId.get(w.id);
        if (!info) return { ...w, state: "closed" };
        return { ...w, url: info.url, title: info.title || w.title, updatedAt: info.updatedAt, state: info.active ? "active" : "inactive" };
      }),
    );
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

// Build a forward: a hidden context message (the window snapshot at send time, so the
// reference survives the window closing) + the visible comment that references it. The UI
// passes these to ctx.sessions.send(text, { context }). Null if the window is already gone.
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
