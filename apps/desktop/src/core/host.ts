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
}
