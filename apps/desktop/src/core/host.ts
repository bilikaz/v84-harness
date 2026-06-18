// The platform capability surface carried on ctx.api — desktop/runner services the agnostic layers consume
// without knowing the host. Each platform's init() supplies what it can; a method it can't do is simply absent
// (callers gate on presence: ctx.api.pickFolder?.()). Storage and tools have their own ctx surfaces, not this one.

// Connection params for listing a media provider's models (the mediaModels RPC).
export interface MediaEndpoint {
  baseUrl: string;
  apiKey?: string;
}

export interface MediaModelsResult {
  ok: boolean;
  models: string[];
  error?: string;
}

// A managed browser window in the desktop fetch fleet — the agent reads it, the user views/forwards it.
// Electron-only (a WebContentsView over the host window's contentView); absent in the browser host.
export interface BrowserWindowInfo {
  id: string;
  url: string;
  title: string;
  active: boolean; // currently the shown overlay (vs. live-but-minimized); closed windows are absent entirely
  loading: boolean; // a page load is in flight (grey dot); false once it finishes (green dot)
  updatedAt: number; // ms epoch, bumped on navigation / load
}

// A live push from main when a window changes (navigation, title update, load start/stop) — keeps the
// god-view's title/url/dot current instead of frozen at first load.
export interface BrowserWindowUpdate {
  url: string;
  title: string;
  loading: boolean;
}

export interface BrowserWindowContent {
  id: string;
  url: string;
  title: string;
  text: string; // extracted page text
  links: string[]; // absolute hrefs on the page — navigation targets the agent can pick from
  error?: string; // set when the last navigation failed (DNS/refused/etc.) — the page never loaded
}

// Pixel rect (in the host window's content coordinates) the overlay should occupy.
export interface ViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserFleet {
  // Opens a URL in a new (hidden) managed window; resolves to its id. settleMs caps the network-idle wait,
  // graceMs is the extra fixed wait after it settles.
  open(url: string, settleMs?: number, graceMs?: number): Promise<string>;
  // Loads a new URL in an existing window (agent navigation by URL). settleMs/graceMs as in open.
  navigate(id: string, url: string, settleMs?: number, graceMs?: number): Promise<void>;
  // Current url/title/extracted text, or null if the window is gone (closed/unknown).
  get(id: string): Promise<BrowserWindowContent | null>;
  // The live fleet — closed windows are absent, which is the agent's "it's gone" signal.
  active(): Promise<BrowserWindowInfo[]>;
  // Surface a window as the full-content overlay at the given bounds (hides any other shown one).
  show(id: string, bounds: ViewBounds): Promise<void>;
  // Collapse the overlay (the window stays live, just not shown).
  hide(): Promise<void>;
  // Destroy the live view, freeing its renderer (the core fleet drops the record).
  close(id: string): Promise<void>;
  // PNG screenshots of the page as data URLs (top + lower sections, `shots` of them), or [] if the view is
  // gone/blank. Used by BrowserContent (vision agents) and BrowserDescribe (the imageRec model).
  capturePage(id: string, shots?: number): Promise<string[]>;
  // Push window changes (main → renderer) — url/title/loading on navigation, title update, load start/stop —
  // so the god-view stays current and the load dot flips live. Returns an unsubscribe fn.
  onEvent(cb: (id: string, update: BrowserWindowUpdate) => void): () => void;
}

export interface HostApi {
  // Native folder picker; resolves to the chosen path or null. Desktop only — absent in the browser.
  pickFolder?(): Promise<string | null>;
  // Save a data URL. Electron opens a Save dialog (suggestedName pre-fills it) and resolves to the written path,
  // or null if cancelled. The browser can't observe save vs. cancel — it triggers a download and resolves with
  // the filename it used (never null). suggestedName is the default filename.
  saveImage?(dataUrl: string, suggestedName?: string): Promise<string | null>;
  saveVideo?(dataUrl: string, suggestedName?: string): Promise<string | null>;
  // A media provider's model list — electron fetches in main (no CORS), the browser fetches directly.
  mediaModels?(endpoint: MediaEndpoint): Promise<MediaModelsResult>;
  // The managed browser-window fleet (the fetch feature). Desktop only — absent in the browser.
  browser?: BrowserFleet;
  // Invoke a plugin's main-side service method (its service.ts `rpc` surface) — the renderer→main path
  // for plugin UI operations that aren't agent tools. Desktop only — absent in the browser.
  invokePlugin?(slug: string, method: string, args: unknown[]): Promise<unknown>;
  // Subscribe to plugin-service events pushed from main (e.g. live connection state). Returns an
  // unsubscribe fn. Desktop only — absent in the browser.
  onPluginEvent?(cb: (slug: string, type: string, payload: unknown) => void): () => void;
}
