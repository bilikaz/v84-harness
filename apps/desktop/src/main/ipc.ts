// Registers the main-side handlers behind the `window.harness` bridge. Main is
// the trust boundary: it owns the dialog + the tool dispatcher and never trusts
// the renderer/model. The `electron` module is passed in (index.ts already
// loaded it via createRequire) to avoid a second require.

import { writeFile } from "node:fs/promises";

import { IPC, type ToolCallRequest, type ToolCtx, type MediaProviderConfig, type MediaModelsResult } from "../bridge.ts";
import { execTool, TOOL_SCHEMAS } from "../core/tools/index.ts";

type Electron = typeof import("electron");

export function registerIpc(electron: Electron): void {
  const { ipcMain, dialog } = electron;

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

  // List the media endpoint's models from main (no CORS) — used as a connection
  // test + to populate the model picker. Never throws; returns {ok:false} on error.
  ipcMain.handle(IPC.mediaModels, async (_e: unknown, cfg: MediaProviderConfig): Promise<MediaModelsResult> => {
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
      return { ok: false, models: [], error: (e as Error).message };
    }
  });

  // Save a data-URL image to disk via a native Save dialog. Returns the path
  // written, or null if the user cancelled / the input wasn't a data URL.
  ipcMain.handle(IPC.saveImage, async (_e: unknown, dataUrl: string): Promise<string | null> => {
    const m = /^data:(image\/[\w.+-]+);base64,(.*)$/s.exec(dataUrl);
    if (!m) return null;
    const [, mime, b64] = m;
    const ext = mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : (mime.split("/")[1] || "png");
    const res = await dialog.showSaveDialog({
      defaultPath: `generated.${ext}`,
      filters: [{ name: "Image", extensions: [ext] }],
    });
    if (res.canceled || !res.filePath) return null;
    await writeFile(res.filePath, Buffer.from(b64, "base64"));
    return res.filePath;
  });
}
