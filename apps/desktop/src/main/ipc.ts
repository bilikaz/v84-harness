// Registers the main-side handlers behind the `window.harness` bridge. Main is
// the trust boundary: it owns the dialog + the tool dispatcher and never trusts
// the renderer/model. The `electron` module is passed in (index.ts already
// loaded it via createRequire) to avoid a second require.

import { IPC, type ToolCallRequest, type ToolCtx, type MediaModelConfig, type MediaModelsResult } from "../bridge.ts";
import { cancelTool, execTool, TOOL_SCHEMAS } from "../core/tools/index.ts";
import { saveDataUrl } from "./saveDataUrl.ts";
import { openStorage } from "./storage.ts";
import { errorMessage } from "../lib/errors.ts";

type Electron = typeof import("electron");

export function registerIpc(electron: Electron): void {
  const { ipcMain, dialog, app } = electron;

  // Durable kv storage (SQLite under userData) — the desktop tier behind the
  // renderer's detectStorage. Fail-soft: available=false → renderer uses IDB.
  const storage = openStorage(app.getPath("userData"));
  ipcMain.handle(IPC.storageAvailable, () => storage.available);
  ipcMain.handle(IPC.storageGet, (_e: unknown, key: string) => storage.get(key));
  ipcMain.handle(IPC.storageSet, (_e: unknown, key: string, value: string) => storage.set(key, value));
  ipcMain.handle(IPC.storageDel, (_e: unknown, key: string) => storage.del(key));
  ipcMain.handle(IPC.storageKeys, (_e: unknown, prefix: string) => storage.keys(prefix));

  // Native folder picker → a session's workspace root.
  ipcMain.handle(IPC.pickFolder, async () => {
    const res = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
    });
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
  });

  // The tools the model may be offered (Phase 2 filters by the workspace's
  // per-tool 0/1/2 policy before advertising).
  ipcMain.handle(IPC.toolsSchemas, async () => TOOL_SCHEMAS);

  // Execute one tool call against the session's workspace cwd.
  ipcMain.handle(IPC.toolsExec, async (_e: unknown, call: ToolCallRequest, ctx: ToolCtx) => {
    return execTool(call, ctx);
  });

  // Cancel a running gated call (user Stop) — aborts the controller execTool
  // minted for that call id; long-running tools (Bash/Grep) react to it.
  ipcMain.handle(IPC.toolsCancel, (_e: unknown, callId: string) => cancelTool(callId));

  // List the media endpoint's models from main (no CORS) — used as a connection
  // test + to populate the model picker. Never throws; returns {ok:false} on error.
  ipcMain.handle(IPC.mediaModels, async (_e: unknown, cfg: MediaModelConfig): Promise<MediaModelsResult> => {
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

  // Save a data-URL image/video to disk via a native Save dialog. Returns the
  // path written, or null if the user cancelled / the input wasn't a data URL.
  ipcMain.handle(IPC.saveImage, (_e: unknown, dataUrl: string) => saveDataUrl(dialog, dataUrl));
  ipcMain.handle(IPC.saveVideo, (_e: unknown, dataUrl: string) => saveDataUrl(dialog, dataUrl));
}
