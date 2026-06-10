# ADR-0001: Dual-target build — pure web Vite and Electron from one renderer

Status: accepted
Date: 2026-06-10 (documented retroactively)

## Context

The app needs Electron for filesystem tools, native dialogs, and CORS-free media
endpoints, but day-to-day UI development is much faster in a plain browser with
Vite HMR. Maintaining two renderers, or making the renderer assume Electron, would
either duplicate work or break browser-based development.

## Decision

One renderer, two targets:

- `pnpm dev` runs the renderer standalone under plain Vite (`vite.config.ts`),
  with a dev proxy for LLM endpoints. `window.harness` is absent.
- `pnpm dev:electron` / `build:electron` run electron-vite
  (`electron.vite.config.ts`), which wraps three Vite builds: main process,
  preload (ESM `.mjs`), and the renderer reusing the same web config.

Desktop capability is a runtime question, answered only through `lib/harness.ts`:

- `harness` — the typed bridge or `undefined`
- `isElectron()` — boolean gate for optional features
- `requireHarness()` — throws loudly for features that cannot degrade

Features must degrade gracefully in web mode (e.g. browser download instead of a
native save dialog) or be hidden/gated.

## Consequences

- UI work iterates in the browser with no Electron startup cost.
- Every desktop feature needs an explicit web-mode answer (fallback, gate, or
  loud error) — this is a feature, not overhead: it keeps the trust boundary visible.
- Web mode is a development/degraded mode; production is the desktop app. Web-only
  fallbacks (e.g. `window.prompt` for a folder path) are acceptable as dev
  conveniences but should be marked as such.
- The repo carries two Vite configs; the electron one must keep reusing the web
  config for the renderer rather than forking it.
