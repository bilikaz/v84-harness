// Registers the main-side handlers behind the `window.harness` bridge. Main is
// the trust boundary: it owns the dialog + the tool dispatcher and never trusts
// the renderer/model. The `electron` module is passed in (index.ts already
// loaded it via createRequire) to avoid a second require.

import { IPC, type ToolCallRequest, type ToolCtx } from "../bridge.ts";
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
}
