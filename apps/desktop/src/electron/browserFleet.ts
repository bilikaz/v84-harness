// Main-process owner of the managed browser windows (the fetch fleet). Each window is a
// WebContentsView attached to the host window's contentView and surfaced as a full-content
// overlay on demand. Live views live here; the core store owns the records + tombstones.
//
// One shared session partition so a login/captcha solved in one window carries to the rest.

import type { BrowserWindowInfo, BrowserWindowContent, BrowserWindowUpdate, ViewBounds } from "../core/host.ts";

type Electron = typeof import("electron");
type BrowserWindow = import("electron").BrowserWindow;
type WebContentsView = import("electron").WebContentsView;

const PARTITION = "persist:scraper";

interface Entry {
  view: WebContentsView;
  updatedAt: number;
  loading: boolean;
}

// Main → renderer window-change push (url/title/loading) so the god-view never goes stale.
export type BrowserEmit = (id: string, update: BrowserWindowUpdate) => void;

export class BrowserFleet {
  private readonly views = new Map<string, Entry>();
  private visibleId: string | null = null;

  constructor(
    private readonly electron: Electron,
    private readonly host: BrowserWindow,
    private readonly emit: BrowserEmit,
  ) {}

  open(url: string): string {
    const { WebContentsView } = this.electron;
    const id = crypto.randomUUID();
    // backgroundThrottling off so an off-screen window the agent reads doesn't stall (the
    // same throttle that froze the renderer poll loops).
    const view = new WebContentsView({
      webPreferences: { partition: PARTITION, backgroundThrottling: false, contextIsolation: true, sandbox: true },
    });
    const wc = view.webContents;
    // Every change pushes the live url/title/loading so the god-view tracks navigation, not just first load.
    wc.on("did-navigate", () => this.touch(id));
    wc.on("did-navigate-in-page", () => this.touch(id));
    wc.on("page-title-updated", () => this.touch(id));
    // Load state drives the dot (and the Browser tool's await): start loading on open, finish on stop.
    wc.on("did-start-loading", () => this.setLoading(id, true));
    wc.on("did-stop-loading", () => this.setLoading(id, false));
    this.host.contentView.addChildView(view);
    view.setVisible(false);
    this.views.set(id, { view, updatedAt: Date.now(), loading: true });
    void wc.loadURL(url);
    return id;
  }

  async capturePage(id: string): Promise<string | null> {
    const entry = this.views.get(id);
    if (!entry) return null;
    const img = await entry.view.webContents.capturePage().catch(() => null);
    return img && !img.isEmpty() ? img.toDataURL() : null;
  }

  async get(id: string): Promise<BrowserWindowContent | null> {
    const entry = this.views.get(id);
    if (!entry) return null;
    const wc = entry.view.webContents;
    const text = (await wc
      .executeJavaScript("document.body ? document.body.innerText : ''", true)
      .catch(() => "")) as string;
    // Absolute hrefs (a.href resolves relative ones), deduped and capped — the agent's navigation targets.
    const links = (await wc
      .executeJavaScript("[...new Set([...document.querySelectorAll('a[href]')].map(a => a.href))].slice(0, 200)", true)
      .catch(() => [])) as string[];
    return { id, url: wc.getURL(), title: wc.getTitle(), text, links };
  }

  navigate(id: string, url: string): void {
    const entry = this.views.get(id);
    if (!entry) return;
    void entry.view.webContents.loadURL(url);
  }

  active(): BrowserWindowInfo[] {
    return [...this.views.entries()].map(([id, entry]) => ({
      id,
      url: entry.view.webContents.getURL(),
      title: entry.view.webContents.getTitle(),
      active: id === this.visibleId,
      loading: entry.loading,
      updatedAt: entry.updatedAt,
    }));
  }

  show(id: string, bounds: ViewBounds): void {
    const entry = this.views.get(id);
    if (!entry) return;
    if (this.visibleId && this.visibleId !== id) this.views.get(this.visibleId)?.view.setVisible(false);
    // The renderer reports CSS-pixel bounds; the host webContents runs zoomed (ZOOM in index.ts),
    // so scale into the window's content DIP by the live zoom factor or the overlay misaligns.
    const z = this.host.webContents.getZoomFactor();
    entry.view.setBounds({
      x: Math.round(bounds.x * z),
      y: Math.round(bounds.y * z),
      width: Math.round(bounds.width * z),
      height: Math.round(bounds.height * z),
    });
    entry.view.setVisible(true);
    this.visibleId = id;
  }

  hide(): void {
    if (!this.visibleId) return;
    this.views.get(this.visibleId)?.view.setVisible(false);
    this.visibleId = null;
  }

  close(id: string): void {
    const entry = this.views.get(id);
    if (!entry) return;
    if (this.visibleId === id) this.visibleId = null;
    this.host.contentView.removeChildView(entry.view);
    entry.view.webContents.close();
    this.views.delete(id);
  }

  private touch(id: string): void {
    const entry = this.views.get(id);
    if (!entry) return;
    entry.updatedAt = Date.now();
    this.push(id);
  }

  private setLoading(id: string, loading: boolean): void {
    const entry = this.views.get(id);
    if (!entry) return;
    entry.loading = loading;
    entry.updatedAt = Date.now();
    this.push(id);
  }

  // Push the window's current url/title/loading to the renderer.
  private push(id: string): void {
    const entry = this.views.get(id);
    if (!entry) return;
    const wc = entry.view.webContents;
    this.emit(id, { url: wc.getURL(), title: wc.getTitle(), loading: entry.loading });
  }
}

// Module singleton — created once the host window exists (initBrowserFleet), resolved
// lazily by the IPC handlers (which are registered before the window is built).
let fleet: BrowserFleet | null = null;

export function initBrowserFleet(electron: Electron, host: BrowserWindow, emit: BrowserEmit): void {
  fleet = new BrowserFleet(electron, host, emit);
}

export function getBrowserFleet(): BrowserFleet | null {
  return fleet;
}
