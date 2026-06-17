// Preload bridge — the only channel between renderer (untrusted) and main (trust boundary); contextIsolation exposes exactly `window.harness`, nothing else.

// Load `electron` (CJS) via createRequire — named/default ESM imports of it are unreliable under an ESM preload.

import { createRequire } from "node:module";

import { IPC, type ElectronApi, type ToolCallRequest, type WireConfig, type ToolFilterParams, type MediaEndpoint, type ViewBounds, type BrowserWindowUpdate } from "./bridge.ts";

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
    exec: (repo: string, method: string, args: unknown[]) => ipcRenderer.invoke(IPC.storageExec, repo, method, args),
  },
  plugins: {
    invoke: (slug: string, method: string, args: unknown[]) => ipcRenderer.invoke(IPC.pluginInvoke, slug, method, args),
    onEvent: (cb: (slug: string, type: string, payload: unknown) => void) => {
      const h = (_e: unknown, slug: string, type: string, payload: unknown): void => cb(slug, type, payload);
      ipcRenderer.on(IPC.pluginEvent, h);
      return () => void ipcRenderer.removeListener(IPC.pluginEvent, h);
    },
  },
  browser: {
    open: (url: string) => ipcRenderer.invoke(IPC.browserOpen, url),
    navigate: (id: string, url: string) => ipcRenderer.invoke(IPC.browserNavigate, id, url),
    get: (id: string) => ipcRenderer.invoke(IPC.browserGet, id),
    active: () => ipcRenderer.invoke(IPC.browserActive),
    show: (id: string, bounds: ViewBounds) => ipcRenderer.invoke(IPC.browserShow, id, bounds),
    hide: () => ipcRenderer.invoke(IPC.browserHide),
    close: (id: string) => ipcRenderer.invoke(IPC.browserClose, id),
    capturePage: (id: string) => ipcRenderer.invoke(IPC.browserCapture, id),
    onEvent: (cb: (id: string, update: BrowserWindowUpdate) => void) => {
      const h = (_e: unknown, id: string, update: BrowserWindowUpdate): void => cb(id, update);
      ipcRenderer.on(IPC.browserEvent, h);
      return () => void ipcRenderer.removeListener(IPC.browserEvent, h);
    },
  },
  saveImage: (dataUrl: string, suggestedName?: string) => ipcRenderer.invoke(IPC.saveImage, dataUrl, suggestedName),
  saveVideo: (dataUrl: string, suggestedName?: string) => ipcRenderer.invoke(IPC.saveVideo, dataUrl, suggestedName),
};

contextBridge.exposeInMainWorld("api", api);
