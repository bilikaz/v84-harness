// The Electron bridge contract — the shape of `window.harness` plus the IPC channel names.

import type { ToolSpec, ToolCallRequest, ToolResult, WireConfig, ToolFilterParams, ToolFilterResult } from "../core/tools/types.ts";
import type { MediaModelsResult, MediaEndpoint } from "../core/host.ts";

export type { ToolSpec, ToolCallRequest, ToolResult, WireConfig, ToolFilterParams, ToolFilterResult };
export type { MediaModelsResult, MediaEndpoint };

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
  storage: {
    available(): Promise<boolean>;
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    del(key: string): Promise<void>;
    keys(prefix: string): Promise<string[]>;
  };
  // Resolves to the written path, or null if cancelled.
  saveImage(dataUrl: string): Promise<string | null>;
  // Resolves to the written path, or null if cancelled.
  saveVideo(dataUrl: string): Promise<string | null>;
}

export const IPC = {
  pickFolder: "harness:pickFolder",
  toolsFilter: "harness:tools:filter",
  toolsExec: "harness:tools:exec",
  toolsCancel: "harness:tools:cancel",
  mediaModels: "harness:media:models",
  saveImage: "harness:saveImage",
  saveVideo: "harness:saveVideo",
  storageAvailable: "harness:storage:available",
  storageGet: "harness:storage:get",
  storageSet: "harness:storage:set",
  storageDel: "harness:storage:del",
  storageKeys: "harness:storage:keys",
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

