# ADR-0002: Typed IPC bridge with a single channel constant and `HarnessApi`

Status: accepted
Date: 2026-06-10 (documented retroactively)

## Context

Electron IPC is stringly-typed by default: ad-hoc channel names and untyped
`invoke` payloads drift silently between main, preload, and renderer. The renderer
must also never see raw `ipcRenderer`.

## Decision

`src/bridge.ts` is the single IPC contract:

- The `IPC` const object holds every channel name, colon-namespaced
  (`harness:tools:exec`). No string literals at `ipcMain.handle` /
  `ipcRenderer.invoke` call sites.
- The `HarnessApi` interface types the entire bridge surface. Preload implements
  it (`const api: HarnessApi = …`) and exposes it via
  `contextBridge.exposeInMainWorld("harness", api)` with `contextIsolation: true`.
- Handlers never let exceptions cross IPC: they return result objects with an
  `ok`/`error` field, or `null` for cancelled/failed pick-and-save operations.

Adding a channel means touching exactly three places, all type-checked against
the same interface: `bridge.ts` (channel + API type), `preload/index.ts`
(wrapper), `main/ipc.ts` (handler).

## Consequences

- Channel/payload drift is a compile error, not a runtime hang.
- The renderer depends only on `HarnessApi`, so web mode type-checks identically.
- `sandbox: false` is required to load the ESM preload; the preload stays minimal
  (typed wrappers only) to keep that surface small.
- There is no runtime handshake validating that main registered every handler; a
  missing handler hangs the invoke. Acceptable while the surface is 6 channels —
  revisit if it grows.
