// The Electron bridge contract — the shape of `window.harness` plus the IPC
// channel names that main, preload, and renderer all agree on. This is NOT
// host-agnostic (it describes the main↔renderer wire), so it lives outside
// `core`. It RE-EXPORTS the domain types it ferries (owned by core/tools) so
// callers have a single import for everything bridge-related.

import type { ToolSchema, ToolCallRequest, ToolResult, ToolCtx, MediaProviderConfig } from "./core/tools/shared.ts";

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
  };
  media: {
    // Runs in main (no CORS) — lists models at the endpoint, used as a connection test.
    models(cfg: MediaProviderConfig): Promise<MediaModelsResult>;
  };
}

// IPC channel names — one source of truth for main + preload.
export const IPC = {
  pickFolder: "harness:pickFolder",
  toolsSchemas: "harness:tools:schemas",
  toolsExec: "harness:tools:exec",
  mediaModels: "harness:media:models",
} as const;
