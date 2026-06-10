// The Electron bridge contract — the shape of `window.harness` plus the IPC
// channel names that main, preload, and renderer all agree on. This is NOT
// host-agnostic (it describes the main↔renderer wire), so it lives outside
// `core`. It RE-EXPORTS the domain types it ferries (owned by core/tools) so
// callers have a single import for everything bridge-related.

import type { ToolSchema, ToolCallRequest, ToolResult, ToolCtx, MediaProviderConfig } from "./core/tools/types.ts";

export type { ToolSchema, ToolCallRequest, ToolResult, ToolCtx, MediaProviderConfig };

// Result of listing a media endpoint's models — doubles as a reachability test.
export interface MediaModelsResult {
  ok: boolean;
  models: string[];
  error?: string;
}

// The surface exposed on `window.harness` in the renderer.
export interface HarnessApi {
  isElectron: true;
  pickFolder(): Promise<string | null>;
  tools: {
    schemas(): Promise<ToolSchema[]>;
    exec(call: ToolCallRequest, ctx: ToolCtx): Promise<ToolResult>;
    // Cancel a running gated call by its call id (an AbortSignal can't cross
    // IPC — main aborts the controller it minted for that call). Resolving says
    // the cancel was DELIVERED, not that the tool has exited.
    cancel(callId: string): Promise<void>;
  };
  media: {
    // Runs in main (no CORS) — lists models at the endpoint, used as a connection test.
    models(cfg: MediaProviderConfig): Promise<MediaModelsResult>;
  };
  // Durable kv storage backed by SQLite in main (see lib/storage/ — the
  // renderer's detectStorage picks this tier when available() is true).
  storage: {
    available(): Promise<boolean>;
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    del(key: string): Promise<void>;
  };
  // Save a data-URL image to disk via a native Save dialog. Resolves to the
  // written path, or null if cancelled.
  saveImage(dataUrl: string): Promise<string | null>;
  // Save a data-URL video to disk via a native Save dialog. Resolves to the
  // written path, or null if cancelled.
  saveVideo(dataUrl: string): Promise<string | null>;
}

// IPC channel names — one source of truth for main + preload.
export const IPC = {
  pickFolder: "harness:pickFolder",
  toolsSchemas: "harness:tools:schemas",
  toolsExec: "harness:tools:exec",
  toolsCancel: "harness:tools:cancel",
  mediaModels: "harness:media:models",
  saveImage: "harness:saveImage",
  saveVideo: "harness:saveVideo",
  storageAvailable: "harness:storage:available",
  storageGet: "harness:storage:get",
  storageSet: "harness:storage:set",
  storageDel: "harness:storage:del",
} as const;
