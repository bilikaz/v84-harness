// Native right-click menu for media. On an image: Copy Image (to the OS
// clipboard) + Save Image…; on a video: Save Video…. Copy/paste is often
// quicker than save-then-attach, so this complements the in-renderer save
// buttons. Lives in main because the clipboard + Save dialog are main-only.

import { saveDataUrl } from "./saveMedia.ts";

type Electron = typeof import("electron");
type BrowserWindow = InstanceType<Electron["BrowserWindow"]>;

export function registerContextMenu(electron: Electron, win: BrowserWindow): void {
  const { Menu, dialog } = electron;

  win.webContents.on("context-menu", (_e, params) => {
    const items: Electron.MenuItemConstructorOptions[] = [];

    if (params.mediaType === "image") {
      items.push(
        // copyImageAt operates on the painted pixels, so it works on our
        // `data:` URLs without round-tripping the base64 anywhere.
        { label: "Copy Image", click: () => win.webContents.copyImageAt(params.x, params.y) },
        { label: "Save Image…", click: () => void saveDataUrl(dialog, params.srcURL) },
      );
    } else if (params.mediaType === "video") {
      // OSes have no real "copy video" clipboard concept — offer save only.
      items.push({ label: "Save Video…", click: () => void saveDataUrl(dialog, params.srcURL) });
    }

    // Standard editing actions when there's text selected or an editable field.
    if (params.editFlags.canCopy) items.push({ label: "Copy", role: "copy" });
    if (params.isEditable) {
      if (params.editFlags.canCut) items.unshift({ label: "Cut", role: "cut" });
      if (params.editFlags.canPaste) items.push({ label: "Paste", role: "paste" });
    }

    if (!items.length) return;
    Menu.buildFromTemplate(items).popup({ window: win });
  });
}
