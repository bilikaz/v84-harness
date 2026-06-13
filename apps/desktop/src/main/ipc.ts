// Registers the main-side handlers behind the `window.harness` bridge.

import { IPC, type ToolCallRequest, type ToolCtx, type MediaEndpoint, type MediaModelsResult } from "../bridge.ts";
import { cancelTool, execTool, TOOL_SCHEMAS } from "../core/tools/index.ts";
import { saveDataUrl } from "./saveDataUrl.ts";
import { openStorage } from "./storage.ts";
import { errorMessage } from "../lib/errors.ts";

type Electron = typeof import("electron");

export function registerIpc(electron: Electron): void {
  const { ipcMain, dialog, app } = electron;

  const storage = openStorage(app.getPath("userData"));
  ipcMain.handle(IPC.storageAvailable, () => storage.available);
  ipcMain.handle(IPC.storageGet, (_e: unknown, key: string) => storage.get(key));
  ipcMain.handle(IPC.storageSet, (_e: unknown, key: string, value: string) => storage.set(key, value));
  ipcMain.handle(IPC.storageDel, (_e: unknown, key: string) => storage.del(key));
  ipcMain.handle(IPC.storageKeys, (_e: unknown, prefix: string) => storage.keys(prefix));

  ipcMain.handle(IPC.pickFolder, async () => {
    const res = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
    });
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
  });

  ipcMain.handle(IPC.toolsSchemas, async () => TOOL_SCHEMAS);

  ipcMain.handle(IPC.toolsExec, async (_e: unknown, call: ToolCallRequest, ctx: ToolCtx) => {
    return execTool(call, ctx);
  });

  ipcMain.handle(IPC.toolsCancel, (_e: unknown, callId: string) => cancelTool(callId));

  ipcMain.handle(IPC.mediaModels, async (_e: unknown, cfg: MediaEndpoint): Promise<MediaModelsResult> => {
    try {
      if (!cfg?.baseUrl) return { ok: false, models: [], error: "no base URL set" };
      const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/models`, {
        headers: cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {},
      });
      if (!res.ok) return { ok: false, models: [], error: `${res.status} ${res.statusText}` };
      const data = (await res.json()) as { data?: Array<{ id?: string }> };
      const models = (data.data ?? []).map((m) => m.id).filter((id): id is string => !!id);
      return { ok: true, models };
    } catch (e) {
      return { ok: false, models: [], error: errorMessage(e) };
    }
  });

  ipcMain.handle(IPC.saveImage, (_e: unknown, dataUrl: string) => saveDataUrl(dialog, dataUrl));
  ipcMain.handle(IPC.saveVideo, (_e: unknown, dataUrl: string) => saveDataUrl(dialog, dataUrl));
}
