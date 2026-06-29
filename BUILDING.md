# Building desktop packages

Packaging the Electron desktop app (Windows `.exe`, macOS `.dmg`) with
electron-builder. For day-to-day development see the **Quick start** in
[README.md](README.md).

```bash
pnpm dist:win    # package on a Windows host
pnpm dist:mac    # package on a macOS host
```

Each OS must be packaged **on its own host** — code-signing and installer creation
are platform-specific and can't be cross-built from WSL/Linux.

## Windows

Run packaging on a **Windows host** (cross-building from WSL needs Wine; Windows is
the supported path). In **PowerShell**:

```powershell
node -v                                       # Node >= 24 required
corepack enable
corepack prepare pnpm@10.33.0 --activate
# If PowerShell blocks the pnpm script:
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
pnpm install                                  # downloads the Electron binary
pnpm --filter @v84-harness/desktop dist:win
```

Output → `apps/desktop/release/`: a **portable** single-file `.exe` and an **NSIS
installer**.

- **Build scripts must be allowed.** pnpm 10 skips dependency build scripts by
  default; `package.json` whitelists `electron`/`electron-builder`/`esbuild` via
  `pnpm.onlyBuiltDependencies`. If a checkout already installed, run
  `pnpm rebuild electron` (or `pnpm approve-builds`) to fetch the binary.
- **No native rebuild** — `build.npmRebuild: false` (no native modules).
- **Code-signing extraction needs symlink privilege** — enable **Developer Mode** or
  run the build in an **Administrator** PowerShell. Clear a corrupt cache with
  `Remove-Item -Recurse -Force "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign"`.
- Artifacts are **unsigned** — SmartScreen shows "unknown publisher" on first run
  (*More info → Run anyway*). Real signing needs a certificate.

## macOS

Run packaging on a **macOS host** — dmg creation and code-signing are macOS-only and
cannot be cross-built from WSL/Linux. Apple Silicon or Intel both work.

```bash
node -v                                       # Node >= 24 required
corepack enable
corepack prepare pnpm@10.33.0 --activate
pnpm install                                  # downloads the Electron binary
pnpm --filter @v84-harness/desktop dist:mac
```

Output → `apps/desktop/release/`: a **`.dmg`** for each architecture (`-arm64` and
`-x64` in the filename). The `.icns` is generated from `build/icon.png` (512×512).

- **No native rebuild** — `build.npmRebuild: false` (no native modules), so the
  cross-arch (arm64 + x64) build is safe from one host.
- **Builds are unsigned** (`mac.identity: null`) — electron-builder ad-hoc signs so
  the app launches locally, but Gatekeeper blocks it on other Macs with *"app is
  damaged and can't be opened"*. To open: **right-click → Open** (then *Open* in the
  dialog), or strip the quarantine flag once:

  ```bash
  xattr -cr "/Applications/V84 Harness.app"
  ```

- **Real distribution needs a Developer ID certificate + notarization** (Apple
  Developer account). When that's set up, drop `identity: null`, add
  `hardenedRuntime: true` + an entitlements file, and pass notarytool credentials via
  env — not wired up yet.
