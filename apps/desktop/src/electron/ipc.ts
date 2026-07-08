// Registers the main-side handlers behind the `window.harness` bridge.

import { IPC, type ToolCallRequest, type WireConfig, type ToolFilterParams, type MediaEndpoint, type MediaModelsResult, type ViewBounds } from "./bridge.ts";
import { cancelTool, execTool, toolFilter } from "./tools.ts";
import { invokePluginService } from "./pluginServices.ts";
import { getBrowserFleet } from "./browserFleet.ts";
import { saveDataUrl } from "./saveDataUrl.ts";
import { isWsl, readWindowsClipboardImage } from "./wslClipboard.ts";
import { openSqliteStore, execData } from "./sqliteStore.ts";
import { errorMessage } from "../lib/errors.ts";

type Electron = typeof import("electron");

export function registerIpc(electron: Electron): void {
  const { ipcMain, dialog, app, clipboard } = electron;

  // Local per-entity SQLite store (the electron LOCAL StorageRepos backing).
  const sqliteOk = openSqliteStore(app.getPath("userData"));
  ipcMain.handle(IPC.storageAvailable, () => sqliteOk);
  ipcMain.handle(IPC.storageExec, (_e: unknown, repo: string, method: string, args: unknown[]) => execData(repo, method, args));

  ipcMain.handle(IPC.pickFolder, async () => {
    const res = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
    });
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
  });
  ipcMain.handle(IPC.toolsFilter, (_e: unknown, wire: WireConfig, params?: ToolFilterParams) => toolFilter(wire, params));
  ipcMain.handle(IPC.toolsExec, (_e: unknown, call: ToolCallRequest, wire: WireConfig) => execTool(call, wire));
  ipcMain.handle(IPC.toolsCancel, (_e: unknown, callId: string) => cancelTool(callId));

  ipcMain.handle(IPC.pluginInvoke, (_e: unknown, slug: string, method: string, args: unknown[]) => invokePluginService(slug, method, args));

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

  // Browser fleet — the WebContentsView manager is created with the host window (initBrowserFleet),
  // so resolve it lazily: these handlers register before the window exists, but only fire after.
  ipcMain.handle(IPC.browserOpen, (_e: unknown, url: string, settleMs?: number, graceMs?: number) => getBrowserFleet()?.open(url, settleMs, graceMs) ?? "");
  ipcMain.handle(IPC.browserNavigate, (_e: unknown, id: string, url: string, settleMs?: number, graceMs?: number) => void getBrowserFleet()?.navigate(id, url, settleMs, graceMs));
  ipcMain.handle(IPC.browserGet, (_e: unknown, id: string) => getBrowserFleet()?.get(id) ?? null);
  ipcMain.handle(IPC.browserActive, () => getBrowserFleet()?.active() ?? []);
  ipcMain.handle(IPC.browserShow, (_e: unknown, id: string, bounds: ViewBounds) => void getBrowserFleet()?.show(id, bounds));
  ipcMain.handle(IPC.browserHide, () => void getBrowserFleet()?.hide());
  ipcMain.handle(IPC.browserClose, (_e: unknown, id: string) => void getBrowserFleet()?.close(id));
  ipcMain.handle(IPC.browserCapture, (_e: unknown, id: string, shots?: number) => getBrowserFleet()?.capturePage(id, shots) ?? []);

  ipcMain.handle(IPC.saveImage, (_e: unknown, dataUrl: string, suggestedName?: string) => saveDataUrl(dialog, dataUrl, suggestedName));
  ipcMain.handle(IPC.saveVideo, (_e: unknown, dataUrl: string, suggestedName?: string) => saveDataUrl(dialog, dataUrl, suggestedName));

  // Paste fallback: a screenshot on the OS clipboard can reach the renderer's paste event with neither
  // files nor items (Electron gap) — main's clipboard reads the bitmap (CF_DIB & co.) reliably. Under
  // WSL the Linux clipboard never receives Windows bitmaps at all (WSLg syncs text only), so fall back
  // to reading the WINDOWS clipboard via PowerShell interop.
  ipcMain.handle(IPC.clipboardImage, async () => {
    const img = clipboard.readImage();
    if (!img.isEmpty()) return img.toDataURL();
    return isWsl() ? readWindowsClipboardImage() : null;
  });
}
