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
  updatedAt: number; // ms epoch, bumped on navigation / load
}

export interface BrowserWindowContent {
  id: string;
  url: string;
  title: string;
  text: string; // extracted page text
  links: string[]; // absolute hrefs on the page — navigation targets the agent can pick from
}

// Pixel rect (in the host window's content coordinates) the overlay should occupy.
export interface ViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserFleet {
  // Opens a URL in a new (hidden) managed window; resolves to its id.
  open(url: string): Promise<string>;
  // Loads a new URL in an existing window (agent navigation by URL).
  navigate(id: string, url: string): Promise<void>;
  // Current url/title/extracted text, or null if the window is gone (closed/unknown).
  get(id: string): Promise<BrowserWindowContent | null>;
  // The live fleet — closed windows are absent, which is the agent's "it's gone" signal.
  active(): Promise<BrowserWindowInfo[]>;
  // Surface a window as the full-content overlay at the given bounds (hides any other shown one).
  show(id: string, bounds: ViewBounds): Promise<void>;
  // Collapse the overlay (the window stays live, just not shown).
  hide(): Promise<void>;
  // Destroy the live view, freeing its renderer (the fleet record becomes a tombstone in core).
  close(id: string): Promise<void>;
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
}
