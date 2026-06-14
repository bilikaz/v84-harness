// Native right-click menu for media (Copy Image, Save Image/Video).

import { saveDataUrl } from "./saveDataUrl.ts";

type Electron = typeof import("electron");
type BrowserWindow = InstanceType<Electron["BrowserWindow"]>;

export function registerContextMenu(electron: Electron, win: BrowserWindow): void {
  const { Menu, dialog } = electron;

  win.webContents.on("context-menu", (_e, params) => {
    const items: Electron.MenuItemConstructorOptions[] = [];

    if (params.mediaType === "image") {
      items.push(
        { label: "Copy Image", click: () => win.webContents.copyImageAt(params.x, params.y) },
        { label: "Save Image…", click: () => void saveDataUrl(dialog, params.srcURL) },
      );
    } else if (params.mediaType === "video") {
      items.push({ label: "Save Video…", click: () => void saveDataUrl(dialog, params.srcURL) });
    }

    if (params.editFlags.canCopy) items.push({ label: "Copy", role: "copy" });
    if (params.isEditable) {
      if (params.editFlags.canCut) items.unshift({ label: "Cut", role: "cut" });
      if (params.editFlags.canPaste) items.push({ label: "Paste", role: "paste" });
    }

    if (!items.length) return;
    Menu.buildFromTemplate(items).popup({ window: win });
  });
}
