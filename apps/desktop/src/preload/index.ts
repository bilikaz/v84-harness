// Preload bridge — the only channel between renderer (untrusted) and main (trust boundary); contextIsolation exposes exactly `window.harness`, nothing else.

// Load `electron` (CJS) via createRequire — named/default ESM imports of it are unreliable under an ESM preload.

import { createRequire } from "node:module";

import { IPC, type HarnessApi, type ToolCallRequest, type ToolWire, type MediaEndpoint } from "../bridge.ts";

const { contextBridge, ipcRenderer } = createRequire(import.meta.url)("electron") as typeof import("electron");

const api: HarnessApi = {
  isElectron: true,
  pickFolder: () => ipcRenderer.invoke(IPC.pickFolder),
  tools: {
    schemas: (wire: ToolWire) => ipcRenderer.invoke(IPC.toolsSchemas, wire),
    descriptors: () => ipcRenderer.invoke(IPC.toolsDescriptors),
    // The wire is plain JSON (cwd + config); main wraps it into its own Ctx and mints the signal/client.
    exec: (call: ToolCallRequest, wire: ToolWire) => ipcRenderer.invoke(IPC.toolsExec, call, wire),
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
  saveImage: (dataUrl: string) => ipcRenderer.invoke(IPC.saveImage, dataUrl),
  saveVideo: (dataUrl: string) => ipcRenderer.invoke(IPC.saveVideo, dataUrl),
};

contextBridge.exposeInMainWorld("harness", api);
