// The Electron bridge contract — the shape of `window.harness` plus the IPC channel names.

import type { ToolSchema, ToolCallRequest, ToolResult, ToolCtx, MediaEndpoint } from "./core/tools/types.ts";

export type { ToolSchema, ToolCallRequest, ToolResult, ToolCtx, MediaEndpoint };

export interface MediaModelsResult {
  ok: boolean;
  models: string[];
  error?: string;
}

export interface HarnessApi {
  isElectron: true;
  pickFolder(): Promise<string | null>;
  tools: {
    schemas(): Promise<ToolSchema[]>;
    exec(call: ToolCallRequest, ctx: ToolCtx): Promise<ToolResult>;
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
  storageKeys: "harness:storage:keys",
} as const;
