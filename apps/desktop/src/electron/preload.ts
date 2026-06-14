// Preload bridge — the only channel between renderer (untrusted) and main (trust boundary); contextIsolation exposes exactly `window.harness`, nothing else.

// Load `electron` (CJS) via createRequire — named/default ESM imports of it are unreliable under an ESM preload.

import { createRequire } from "node:module";

import { IPC, type ElectronApi, type ToolCallRequest, type WireConfig, type ToolFilterParams, type MediaEndpoint } from "./bridge.ts";

const { contextBridge, ipcRenderer } = createRequire(import.meta.url)("electron") as typeof import("electron");

const api: ElectronApi = {
  isElectron: true,
  pickFolder: () => ipcRenderer.invoke(IPC.pickFolder),
  tools: {
    // The wire is plain JSON (the config snapshot); main wraps it into its own Ctx and mints the signal/client.
    filter: (wire: WireConfig, params?: ToolFilterParams) => ipcRenderer.invoke(IPC.toolsFilter, wire, params),
    exec: (call: ToolCallRequest, wire: WireConfig) => ipcRenderer.invoke(IPC.toolsExec, call, wire),
    cancel: (callId: string) => ipcRenderer.invoke(IPC.toolsCancel, callId),
  },
  media: {
    models: (cfg: MediaEndpoint) => ipcRenderer.invoke(IPC.mediaModels, cfg),
  },
  storage: {
    available: () => ipcRenderer.invoke(IPC.storageAvailable),
    get: (key: string) => ipcRenderer.invoke(IPC.storageGet, key),
    set: (key: string, value: string) => ipcRenderer.invoke(IPC.storageSet, key, value),
    del: (key: string) => ipcRenderer.invoke(IPC.storageDel, key),
    keys: (prefix: string) => ipcRenderer.invoke(IPC.storageKeys, prefix),
  },
  saveImage: (dataUrl: string, suggestedName?: string) => ipcRenderer.invoke(IPC.saveImage, dataUrl, suggestedName),
  saveVideo: (dataUrl: string, suggestedName?: string) => ipcRenderer.invoke(IPC.saveVideo, dataUrl, suggestedName),
};

contextBridge.exposeInMainWorld("api", api);
