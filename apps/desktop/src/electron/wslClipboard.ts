// WSLg bridges TEXT between the Windows and Linux clipboards but not bitmaps — an Electron app running
// inside WSL never sees a Windows screenshot through clipboard.readImage(). Dev-environment fallback:
// read the WINDOWS clipboard through PowerShell interop (PNG → base64 on stdout). Irrelevant in packaged
// Windows/mac builds, where the native clipboard read works.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { release } from "node:os";

export function isWsl(): boolean {
  return process.platform === "linux" && release().toLowerCase().includes("microsoft");
}

const PS_FALLBACK = "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";
// -STA: Get-Clipboard needs a single-threaded apartment. One base64 line on stdout, or nothing.
const PS_READ_IMAGE =
  "$img = Get-Clipboard -Format Image; " +
  "if ($img) { $ms = New-Object System.IO.MemoryStream; $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); [Convert]::ToBase64String($ms.ToArray()) }";

export function readWindowsClipboardImage(): Promise<string | null> {
  const exe = existsSync(PS_FALLBACK) ? PS_FALLBACK : "powershell.exe"; // PATH interop may be off — prefer the fixed path
  return new Promise((resolve) => {
    execFile(
      exe,
      ["-NoProfile", "-STA", "-Command", PS_READ_IMAGE],
      { timeout: 10_000, maxBuffer: 128 * 1024 * 1024 },
      (err, stdout) => {
        const b64 = stdout?.trim();
        resolve(!err && b64 ? `data:image/png;base64,${b64}` : null);
      },
    );
  });
}
