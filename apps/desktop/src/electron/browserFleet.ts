// Main-process owner of the managed browser windows (the fetch fleet). Each window is a
// WebContentsView attached to the host window's contentView and surfaced as a full-content
// overlay on demand. Live views live here; the core store owns the records + tombstones.
//
// One shared session partition so a login/captcha solved in one window carries to the rest.
//
// Each window keeps a CDP session (debugger) attached: Network events drive a network-idle settle (a
// JS-rich page fetches its content AFTER document load, so "loaded" = document done + network quiet),
// and Page.captureScreenshot renders the page even while the view is hidden/0×0 (a background window).

import type { BrowserWindowInfo, BrowserWindowContent, BrowserWindowUpdate, ViewBounds } from "../core/host.ts";

type Electron = typeof import("electron");
type BrowserWindow = import("electron").BrowserWindow;
type WebContentsView = import("electron").WebContentsView;
type Debugger = import("electron").Debugger;

const PARTITION = "persist:scraper";
const SETTLE_DEFAULT = 5000; // fallback network-idle cap if the caller passes none
const GRACE_DEFAULT = 2000; // fallback post-settle grace if the caller passes none
const QUIET_MS = 500; // network must stay idle this long after document load to count as settled
const SHOTS_DEFAULT = 2;
const READ_TIMEOUT = 4000; // ceiling for a single read op (executeJavaScript / CDP command)

interface Entry {
  view: WebContentsView;
  updatedAt: number;
  loading: boolean;
  debug: boolean; // CDP attached + Network tracked (false if the debugger couldn't attach)
  inflight: Set<string>; // in-flight CDP request ids — empty ⇒ network idle
  settleMs: number; // network-idle cap for the current load
  graceMs: number; // extra fixed wait after the network settles (late images, etc.)
  error?: string; // last navigation's failure reason (DNS/refused/…), cleared when a new load starts
  quietTimer?: ReturnType<typeof setTimeout>;
  capTimer?: ReturnType<typeof setTimeout>;
  graceTimer?: ReturnType<typeof setTimeout>;
}

// Main → renderer window-change push (url/title/loading) so the god-view never goes stale.
export type BrowserEmit = (id: string, update: BrowserWindowUpdate) => void;

export class BrowserFleet {
  private readonly views = new Map<string, Entry>();
  private visibleId: string | null = null;
  private shotHost: BrowserWindow | null = null; // WIN: invisible parent that gives background views a real surface to capture

  // WIN: a hidden/0×0 WebContentsView has no surface, and fromSurface:false renders surfacelessly only on
  // Linux — on Windows it reads the host window's surface (the app UI) or nothing. So during capture we
  // reparent the background view into this off-screen, fully-transparent, no-taskbar window: Windows still
  // composites it (real pixels), but the user never sees it. Created lazily, reused for the app's lifetime.
  private ensureShotHost(): BrowserWindow | null {
    if (this.shotHost && !this.shotHost.isDestroyed()) return this.shotHost;
    try {
      const { BrowserWindow } = this.electron;
      const w = new BrowserWindow({ width: 1280, height: 800, frame: false, skipTaskbar: true, show: false });
      w.setOpacity(0); // invisible before it ever paints
      w.setPosition(-32000, -32000); // and parked off every monitor, belt-and-suspenders
      w.showInactive(); // shown (so it composites a surface) without stealing focus
      this.shotHost = w;
      return w;
    } catch {
      return null;
    }
  }

  constructor(
    private readonly electron: Electron,
    private readonly host: BrowserWindow,
    private readonly emit: BrowserEmit,
  ) {}

  async open(url: string, settleMs = SETTLE_DEFAULT, graceMs = GRACE_DEFAULT): Promise<string> {
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
    // Load state drives the dot + the Browser tool's await: start on load, finish once the network settles.
    wc.on("did-start-loading", () => this.onLoadStart(id));
    wc.on("did-stop-loading", () => this.onLoadStop(id));
    // A dead host (DNS failure, refused) may never fire did-stop-loading — treat a main-frame failure as a
    // load end so the settle resolves instead of hanging until whenLoaded's timeout. -3 is ABORTED (a normal
    // cancel/redirect), not a failure.
    wc.on("did-fail-load", (_e, errorCode, desc, _url, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return; // -3 ABORTED is a normal cancel/redirect
      const entry = this.views.get(id);
      if (entry) entry.error = failureReason(desc);
      this.onLoadStop(id);
    });
    this.host.contentView.addChildView(view);
    view.setVisible(false);
    const entry: Entry = { view, updatedAt: Date.now(), loading: true, debug: false, inflight: new Set(), settleMs, graceMs };
    this.views.set(id, entry);
    // Attach + start listening BEFORE loadURL so Network tracking sees the requests. The enable commands
    // are fire-and-forget: a fresh WebContentsView has no renderer until loadURL, so AWAITING them here
    // would deadlock (they only resolve once the renderer exists, which loadURL below creates).
    entry.debug = this.attachDebug(id, wc.debugger);
    void wc.loadURL(url);
    return id;
  }

  navigate(id: string, url: string, settleMs = SETTLE_DEFAULT, graceMs = GRACE_DEFAULT): void {
    const entry = this.views.get(id);
    if (!entry) return;
    entry.settleMs = settleMs; // did-start-loading resets the idle tracking for this navigation
    entry.graceMs = graceMs;
    void entry.view.webContents.loadURL(url);
  }

  // PNG screenshots down the page (top + lower sections, `shots` of them) as data URLs, or [] if gone/blank.
  // CDP renders the page even when the view is hidden/0×0; lower sections come from scrolling the document
  // and shooting each stop (a `clip` offset is IGNORED under fromSurface:false — see ADR-0054). Reuses the
  // window's persistent debugger; attaches ad-hoc only if it has none.
  async capturePage(id: string, shots = SHOTS_DEFAULT): Promise<string[]> {
    const entry = this.views.get(id);
    if (!entry) return []; // genuinely closed
    const wc = entry.view.webContents;
    const dbg = wc.debugger;
    let adhoc = false;
    let overrode = false;
    // WIN: a background view (not the visible overlay) has no usable surface on the host window. Move it into
    // the off-screen invisible shotHost and give it real bounds so Windows composites it, then move it back.
    const shot = process.platform === "win32" && this.visibleId !== id ? this.ensureShotHost() : null;
    try {
      // Reparent inside the try so a throw here is caught (degrades to nativeShot) and the finally still restores.
      if (shot) {
        this.host.contentView.removeChildView(entry.view);
        shot.contentView.addChildView(entry.view);
        entry.view.setBounds({ x: 0, y: 0, width: 1280, height: 800 });
        entry.view.setVisible(true);
      }
      if (!dbg.isAttached()) {
        try {
          dbg.attach("1.3");
          adhoc = true;
        } catch {
          /* DevTools owns it — fall through to native */
        }
      }
      if (!dbg.isAttached()) return await this.nativeShot(wc);
      await this.cmd(dbg, "Page.enable");
      const b = entry.view.getBounds();
      if (!b.width || !b.height) {
        // Never-shown window has no viewport; impose one so there is something to lay out and capture.
        await this.cmd(dbg, "Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 0, mobile: false });
        overrode = true;
      }
      const m = (await this.cmd(dbg, "Page.getLayoutMetrics")) as {
        cssLayoutViewport?: { clientHeight: number };
        cssContentSize?: { height: number };
      };
      const vh = Math.round(m.cssLayoutViewport?.clientHeight || (overrode ? 800 : b.height) || 800);
      const ch = Math.round(m.cssContentSize?.height || vh);
      const offsets = shotOffsets(vh, ch, Math.max(1, shots));
      // Scroll the document and capture the viewport at each stop — fromSurface:false renders the renderer's
      // current (scrolled) view, so this is what actually moves down the page (a clip offset is ignored).
      // `|| 0` coerces a non-numeric JS result to a usable offset; the timeout fallback is already 0.
      const origY = (await withTimeout(wc.executeJavaScript("window.scrollY", true) as Promise<number>, READ_TIMEOUT, 0)) || 0;
      const out: string[] = [];
      for (let i = 0; i < offsets.length; i++) {
        await withTimeout(wc.executeJavaScript(`window.scrollTo(0, ${offsets[i]})`, true) as Promise<unknown>, READ_TIMEOUT, undefined);
        const data = await this.shoot(dbg, i === 0, offsets[i] > 0); // retry first (paint gap); let scrolls paint
        if (data) out.push(`data:image/png;base64,${data}`);
      }
      if (offsets.length > 1) await withTimeout(wc.executeJavaScript(`window.scrollTo(0, ${origY})`, true) as Promise<unknown>, READ_TIMEOUT, undefined); // restore
      return out.length ? out : await this.nativeShot(wc);
    } catch {
      return await this.nativeShot(wc);
    } finally {
      if (overrode) await this.cmd(dbg, "Emulation.clearDeviceMetricsOverride");
      if (shot) {
        // Two independent steps: a failed detach (e.g. it was never added) must not skip the re-add to host.
        try {
          shot.contentView.removeChildView(entry.view);
        } catch {
          /* may never have been added to the shot host */
        }
        try {
          this.host.contentView.addChildView(entry.view);
          entry.view.setVisible(false);
          entry.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        } catch {
          /* view/window may have closed mid-capture — nothing to restore */
        }
      }
      if (adhoc && dbg.isAttached()) {
        try {
          dbg.detach();
        } catch {
          /* already gone */
        }
      }
    }
  }

  async get(id: string): Promise<BrowserWindowContent | null> {
    const entry = this.views.get(id);
    if (!entry) return null;
    const wc = entry.view.webContents;
    // executeJavaScript can hang forever on a page stuck mid-navigation (DNS fail / dead host) — bound both,
    // and run them together so a dead host pays one timeout, not two in series.
    const [text, links] = await Promise.all([
      withTimeout(wc.executeJavaScript("document.body ? document.body.innerText : ''", true) as Promise<string>, READ_TIMEOUT, ""),
      // Absolute hrefs (a.href resolves relative ones), deduped and capped — the agent's navigation targets.
      withTimeout(wc.executeJavaScript("[...new Set([...document.querySelectorAll('a[href]')].map(a => a.href))].slice(0, 200)", true) as Promise<string[]>, READ_TIMEOUT, []),
    ]);
    return { id, url: wc.getURL(), title: wc.getTitle(), text, links, error: entry.error };
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
    this.clearSettle(entry);
    const dbg = entry.view.webContents.debugger;
    if (dbg.isAttached()) {
      try {
        dbg.detach();
      } catch {
        /* already gone */
      }
    }
    if (this.visibleId === id) this.visibleId = null;
    this.host.contentView.removeChildView(entry.view);
    entry.view.webContents.close();
    this.views.delete(id);
  }

  // Attach the CDP session and start tracking in-flight requests (for network-idle). Best-effort: returns
  // false if the debugger can't attach (e.g. DevTools already owns this webContents). The enable commands
  // are fired without awaiting — they apply once the renderer exists (created by the caller's loadURL).
  private attachDebug(id: string, dbg: Debugger): boolean {
    try {
      if (!dbg.isAttached()) dbg.attach("1.3");
    } catch {
      return false;
    }
    dbg.on("message", (_e, method, params: { requestId?: string; redirectResponse?: unknown }) => {
      const entry = this.views.get(id);
      if (!entry || !params?.requestId) return;
      if (method === "Network.requestWillBeSent") {
        if (params.redirectResponse) return; // a redirect continuation reuses the id — not a new request
        entry.inflight.add(params.requestId);
        if (entry.quietTimer) {
          clearTimeout(entry.quietTimer); // network busy again — restart the quiet window
          entry.quietTimer = undefined;
        }
      } else if (method === "Network.loadingFinished" || method === "Network.loadingFailed") {
        entry.inflight.delete(params.requestId);
        this.onMaybeIdle(id);
      }
    });
    void dbg.sendCommand("Page.enable").catch(() => {});
    void dbg.sendCommand("Network.enable").catch(() => {});
    return true;
  }

  private onLoadStart(id: string): void {
    const entry = this.views.get(id);
    if (!entry) return;
    this.clearSettle(entry);
    entry.inflight.clear();
    entry.error = undefined; // a fresh navigation clears the prior failure
    this.setLoading(id, true);
  }

  private onLoadStop(id: string): void {
    const entry = this.views.get(id);
    if (!entry) return;
    if (!entry.debug) {
      this.beginGrace(id); // no network tracking — fall back to document-complete, then the grace
      return;
    }
    // Document done, but JS-rich pages fetch content now. Hold loading until the network goes quiet
    // (QUIET_MS with nothing in flight) or the cap elapses, whichever comes first.
    this.clearSettle(entry);
    entry.capTimer = setTimeout(() => this.finishSettle(id), entry.settleMs);
    this.onMaybeIdle(id); // already quiet? start the quiet window now
  }

  private onMaybeIdle(id: string): void {
    const entry = this.views.get(id);
    if (!entry || !entry.loading || !entry.capTimer) return; // only during the settle phase
    if (entry.inflight.size > 0 || entry.quietTimer) return;
    entry.quietTimer = setTimeout(() => this.finishSettle(id), QUIET_MS);
  }

  // Network settled — now a flat grace (late assets, especially images, often land in this window) before
  // the page counts as loaded. A new navigation cancels it via clearSettle.
  private finishSettle(id: string): void {
    const entry = this.views.get(id);
    if (!entry) return;
    this.clearSettle(entry);
    this.beginGrace(id);
  }

  private beginGrace(id: string): void {
    const entry = this.views.get(id);
    if (!entry) return;
    if (entry.graceMs <= 0) {
      this.setLoading(id, false);
      return;
    }
    entry.graceTimer = setTimeout(() => {
      const e = this.views.get(id);
      if (!e) return;
      e.graceTimer = undefined;
      this.setLoading(id, false);
    }, entry.graceMs);
  }

  private clearSettle(entry: Entry): void {
    if (entry.quietTimer) {
      clearTimeout(entry.quietTimer);
      entry.quietTimer = undefined;
    }
    if (entry.capTimer) {
      clearTimeout(entry.capTimer);
      entry.capTimer = undefined;
    }
    if (entry.graceTimer) {
      clearTimeout(entry.graceTimer);
      entry.graceTimer = undefined;
    }
  }

  // A CDP command, never-throw and time-bounded — a hung renderer (dead host) would otherwise hang forever.
  private cmd(dbg: Debugger, method: string, params?: object): Promise<Record<string, unknown>> {
    return withTimeout(dbg.sendCommand(method, params).catch(() => ({})) as Promise<Record<string, unknown>>, READ_TIMEOUT, {});
  }

  // One screenshot of the current (scrolled) viewport. Retries the first band — a client-rendered page can
  // paint a beat after load, so the initial capture can come back empty. `scrolled` waits a beat first so the
  // scroll has painted before the shot.
  private async shoot(dbg: Debugger, retry: boolean, scrolled: boolean): Promise<string | undefined> {
    if (scrolled) await new Promise((r) => setTimeout(r, 150));
    const attempts = retry ? 4 : 1;
    for (let a = 0; a < attempts; a++) {
      if (a) await new Promise((r) => setTimeout(r, 200));
      const r = (await withTimeout(
        dbg.sendCommand("Page.captureScreenshot", { format: "png", fromSurface: false }).catch(() => ({ data: undefined })),
        READ_TIMEOUT,
        { data: undefined, timedOut: true },
      )) as { data?: string; timedOut?: boolean };
      if (r.data) return r.data;
      if (r.timedOut) break; // hung renderer (dead host) — retrying just burns another timeout
    }
    return undefined;
  }

  private async nativeShot(wc: import("electron").WebContents): Promise<string[]> {
    const img = await wc.capturePage().catch(() => null);
    return img && !img.isEmpty() ? [img.toDataURL()] : [];
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

// Resolve with `fallback` if `p` doesn't settle within ms. A page stuck in a never-completing navigation
// (DNS failure, hung connection) has no live frame, so executeJavaScript / CDP commands can hang FOREVER —
// never resolving, so .catch can't save them. This is the hard ceiling that keeps a read from hanging.
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let done = false;
    const settle = (v: T): void => {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve(v);
    };
    const t = setTimeout(() => settle(fallback), ms);
    p.then(settle, () => settle(fallback));
  });
}

// A human-readable reason from Chromium's net error description (e.g. "ERR_NAME_NOT_RESOLVED"), so the
// agent is told the page failed rather than puzzling over a blank read.
function failureReason(desc: string): string {
  if (/NAME_NOT_RESOLVED|ADDRESS_UNREACHABLE/.test(desc)) return "the host could not be resolved — the domain may not exist or is offline";
  if (/CONNECTION_REFUSED|CONNECTION_CLOSED|CONNECTION_RESET|CONNECTION_FAILED/.test(desc)) return "the connection was refused";
  if (/TIMED_OUT/.test(desc)) return "the connection timed out";
  if (/CERT_|SSL/.test(desc)) return "the site's security certificate could not be verified";
  return desc ? `the page failed to load (${desc})` : "the page failed to load";
}

// Screenshot y-offsets down the page: the top, then ~one viewport lower each shot (slight overlap so the
// seam isn't lost), capped at the page bottom. A barely-scrollable page is just the top.
function shotOffsets(vh: number, ch: number, shots: number): number[] {
  const maxY = Math.max(0, ch - vh);
  const offsets = [0];
  if (maxY <= vh * 0.3 || shots <= 1) return offsets;
  const step = Math.round(vh * 0.9);
  for (let i = 1; i < shots; i++) {
    const y = Math.min(i * step, maxY);
    offsets.push(y);
    if (y >= maxY) break; // reached the bottom — no point repeating it
  }
  return offsets;
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
