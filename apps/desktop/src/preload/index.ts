// Preload bridge — the ONLY channel between the renderer (untrusted, runs model
// output) and main (the Node host / trust boundary). Runs with contextIsolation
// on, so the renderer sees exactly what we expose as `window.harness` and
// nothing else — no `require`, no `fs`, no raw `ipcRenderer`.
//
// Load `electron` (CJS) via createRequire — named/default ESM imports of it are
// unreliable under an ESM preload (Node's CJS lexer can't see its exports).

import { createRequire } from "node:module";

import { IPC, type HarnessApi, type ToolCallRequest, type ToolCtx, type MediaProviderConfig } from "../bridge.ts";

const { contextBridge, ipcRenderer } = createRequire(import.meta.url)("electron") as typeof import("electron");

const api: HarnessApi = {
  isElectron: true,
  pickFolder: () => ipcRenderer.invoke(IPC.pickFolder),
  tools: {
    schemas: () => ipcRenderer.invoke(IPC.toolsSchemas),
    // `signal` is process-local and not cloneable — strip it before the wire.
    exec: (call: ToolCallRequest, { signal: _local, ...ctx }: ToolCtx) => ipcRenderer.invoke(IPC.toolsExec, call, ctx),
    cancel: (callId: string) => ipcRenderer.invoke(IPC.toolsCancel, callId),
  },
  media: {
    models: (cfg: MediaProviderConfig) => ipcRenderer.invoke(IPC.mediaModels, cfg),
  },
  storage: {
    available: () => ipcRenderer.invoke(IPC.storageAvailable),
    get: (key: string) => ipcRenderer.invoke(IPC.storageGet, key),
    set: (key: string, value: string) => ipcRenderer.invoke(IPC.storageSet, key, value),
    del: (key: string) => ipcRenderer.invoke(IPC.storageDel, key),
  },
  saveImage: (dataUrl: string) => ipcRenderer.invoke(IPC.saveImage, dataUrl),
  saveVideo: (dataUrl: string) => ipcRenderer.invoke(IPC.saveVideo, dataUrl),
};

contextBridge.exposeInMainWorld("harness", api);
