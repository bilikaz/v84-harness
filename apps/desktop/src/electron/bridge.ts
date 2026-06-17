// The Electron bridge contract — the shape of `window.harness` plus the IPC channel names.

import type { ToolSpec, ToolCallRequest, ToolResult, WireConfig, ToolFilterParams, ToolFilterResult } from "../core/tools/types.ts";
import type { MediaModelsResult, MediaEndpoint, BrowserWindowInfo, BrowserWindowContent, ViewBounds } from "../core/host.ts";

export type { ToolSpec, ToolCallRequest, ToolResult, WireConfig, ToolFilterParams, ToolFilterResult };
export type { MediaModelsResult, MediaEndpoint, BrowserWindowInfo, BrowserWindowContent, ViewBounds };

export interface ElectronApi {
  isElectron: true;
  pickFolder(): Promise<string | null>;
  tools: {
    // The wire carries the config snapshot main seeds its Ctx from; the cwd rides on the call.
    filter(wire: WireConfig, params?: ToolFilterParams): Promise<ToolFilterResult>;
    exec(call: ToolCallRequest, wire: WireConfig): Promise<ToolResult>;
    // Resolving says the cancel was DELIVERED, not that the tool has exited.
    cancel(callId: string): Promise<void>;
  };
  media: {
    // Runs in main (no CORS).
    models(cfg: MediaEndpoint): Promise<MediaModelsResult>;
  };
  // Local per-entity SQLite store (main process). The renderer's sqliteRepos proxies StorageRepos
  // calls through exec(); available() is false if node:sqlite couldn't open (→ IndexedDB fallback).
  storage: {
    available(): Promise<boolean>;
    exec(repo: string, method: string, args: unknown[]): Promise<unknown>;
  };
  // Plugin services — a plugin's main-side service.ts `rpc` methods, invoked by its renderer UI (connect/
  // test/disconnect/status). Separate from the tool registry: these are host/UI operations, never agent tools.
  plugins: {
    invoke(slug: string, method: string, args: unknown[]): Promise<unknown>;
    // Subscribe to a plugin service's pushed events (main→renderer). Returns an unsubscribe fn.
    onEvent(cb: (slug: string, type: string, payload: unknown) => void): () => void;
  };
  // The managed browser-window fleet (the fetch feature) — WebContentsViews owned in main.
  browser: {
    open(url: string): Promise<string>;
    navigate(id: string, url: string): Promise<void>;
    get(id: string): Promise<BrowserWindowContent | null>;
    active(): Promise<BrowserWindowInfo[]>;
    show(id: string, bounds: ViewBounds): Promise<void>;
    hide(): Promise<void>;
    close(id: string): Promise<void>;
  };
  // Resolves to the written path, or null if cancelled. suggestedName pre-fills the dialog.
  saveImage(dataUrl: string, suggestedName?: string): Promise<string | null>;
  saveVideo(dataUrl: string, suggestedName?: string): Promise<string | null>;
}

export const IPC = {
  pickFolder: "harness:pickFolder",
  toolsFilter: "harness:tools:filter",
  toolsExec: "harness:tools:exec",
  toolsCancel: "harness:tools:cancel",
  mediaModels: "harness:media:models",
  browserOpen: "harness:browser:open",
  browserNavigate: "harness:browser:navigate",
  browserGet: "harness:browser:get",
  browserActive: "harness:browser:active",
  browserShow: "harness:browser:show",
  browserHide: "harness:browser:hide",
  browserClose: "harness:browser:close",
  saveImage: "harness:saveImage",
  saveVideo: "harness:saveVideo",
  storageAvailable: "harness:storage:available",
  storageExec: "harness:storage:exec",
  pluginInvoke: "harness:plugin:invoke",
  pluginEvent: "harness:plugin:event",
} as const;


declare global {
  interface Window {
    api?: ElectronApi;
  }
}

export const api: ElectronApi | undefined =
  typeof window !== "undefined" ? window.api : undefined;

export function isElectron(): boolean {
  return api?.isElectron === true;
}

